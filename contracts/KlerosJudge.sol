// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IArbitrator.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ISimpleBondV4
 * @notice Minimal interface for the SimpleBondV4 functions KlerosJudge needs.
 */
interface ISimpleBondV4 {
    function registerAsJudge() external;
    function ruleForChallenger(uint256 bondId, uint256 feeCharged) external;
    function ruleForPoster(uint256 bondId, uint256 feeCharged) external;
    function rejectBond(uint256 bondId) external;
    function rulingWindowStart(uint256 bondId) external view returns (uint256);
    function rulingDeadline(uint256 bondId) external view returns (uint256);
    function getChallenge(uint256 bondId, uint256 index)
        external
        view
        returns (address challenger, uint8 status, string memory metadata);
    function getChallengeCount(uint256 bondId) external view returns (uint256);
}

/**
 * @title KlerosJudge
 * @notice Adapter that registers as a judge in SimpleBondV4 and translates
 *         Kleros rulings into SimpleBondV4 ruling calls.
 *
 *         Flow:
 *         1. Bond is created with this contract as judge
 *         2. After a challenge, poster or challenger calls requestArbitration()
 *         3. Kleros jurors deliberate and call rule()
 *         4. Anyone calls executeRuling() once the ruling window is open
 *
 *         Ruling convention (ERC-792):
 *           0 = Refused to arbitrate → rejectBond (refund all)
 *           1 = Poster wins → ruleForPoster
 *           2 = Challenger wins → ruleForChallenger
 */
contract KlerosJudge is IArbitrable, IEvidence {
    using SafeERC20 for IERC20;

    // --- Constants -----------------------------------------------------------

    uint256 public constant RULING_CHOICES = 2;
    uint256 public constant RULING_POSTER = 1;
    uint256 public constant RULING_CHALLENGER = 2;

    // --- Immutables ----------------------------------------------------------

    IArbitrator public immutable arbitrator;
    ISimpleBondV4 public immutable simpleBond;

    // --- State ---------------------------------------------------------------

    bytes public arbitratorExtraData;
    address public owner;

    enum DisputeStatus { None, Active, Ruled, Executed }

    struct DisputeData {
        uint256 bondId;
        uint256 challengeIndex;
        address requester;
        DisputeStatus status;
        uint256 ruling;
    }

    /// @notice disputeID → DisputeData
    mapping(uint256 => DisputeData) public disputes;

    /// @notice bondId → challengeIndex → disputeID
    mapping(uint256 => mapping(uint256 => uint256)) public bondChallengeToDispute;

    /// @notice bondId → challengeIndex → hasDispute
    mapping(uint256 => mapping(uint256 => bool)) public hasDispute;

    // --- Events --------------------------------------------------------------

    event ArbitrationRequested(
        uint256 indexed bondId,
        uint256 challengeIndex,
        uint256 indexed disputeID,
        address indexed requester
    );

    event RulingExecuted(
        uint256 indexed bondId,
        uint256 indexed disputeID,
        uint256 ruling
    );

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // --- Constructor ---------------------------------------------------------

    /**
     * @param _arbitrator       Kleros arbitrator contract (e.g., KlerosLiquid)
     * @param _simpleBond       SimpleBondV4 contract
     * @param _arbitratorExtraData  Encodes subcourt ID + juror count
     * @param _metaEvidence     IPFS URI to ERC-1497 meta-evidence JSON
     */
    constructor(
        address _arbitrator,
        address _simpleBond,
        bytes memory _arbitratorExtraData,
        string memory _metaEvidence
    ) {
        require(_arbitrator != address(0), "Zero arbitrator");
        require(_simpleBond != address(0), "Zero simpleBond");

        arbitrator = IArbitrator(_arbitrator);
        simpleBond = ISimpleBondV4(_simpleBond);
        arbitratorExtraData = _arbitratorExtraData;
        owner = msg.sender;

        // Register this contract as a judge in SimpleBondV4
        ISimpleBondV4(_simpleBond).registerAsJudge();

        // Emit ERC-1497 MetaEvidence (ID 0)
        emit MetaEvidence(0, _metaEvidence);
    }

    // --- Modifiers -----------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    // --- Core Functions ------------------------------------------------------

    /**
     * @notice Request Kleros arbitration for a challenged bond.
     *         Caller must be the poster or the current challenger.
     *         Must send enough ETH/xDAI to cover arbitration cost.
     * @param bondId The bond with a pending challenge
     * @return disputeID The Kleros dispute ID
     */
    function requestArbitration(uint256 bondId) external payable returns (uint256 disputeID) {
        uint256 currentChallenge = _validateAndGetChallenge(bondId);

        // No duplicate dispute for this challenge
        require(!hasDispute[bondId][currentChallenge], "Dispute already exists");
        require(block.timestamp <= simpleBond.rulingDeadline(bondId), "Bond past ruling deadline");

        // Create Kleros dispute
        uint256 cost = arbitrator.arbitrationCost(arbitratorExtraData);
        require(msg.value >= cost, "Insufficient arbitration fee");

        disputeID = arbitrator.createDispute{value: cost}(
            RULING_CHOICES,
            arbitratorExtraData
        );

        // Store dispute
        disputes[disputeID] = DisputeData({
            bondId: bondId,
            challengeIndex: currentChallenge,
            requester: msg.sender,
            status: DisputeStatus.Active,
            ruling: 0
        });

        bondChallengeToDispute[bondId][currentChallenge] = disputeID;
        hasDispute[bondId][currentChallenge] = true;

        // Refund excess ETH
        if (msg.value > cost) {
            (bool sent, ) = msg.sender.call{value: msg.value - cost}("");
            require(sent, "Refund failed");
        }

        // Emit ERC-1497 events
        uint256 evidenceGroupID = _evidenceGroupID(bondId, currentChallenge);
        emit Dispute(arbitrator, disputeID, 0, evidenceGroupID);
        emit ArbitrationRequested(bondId, currentChallenge, disputeID, msg.sender);

        return disputeID;
    }

    /**
     * @notice Called by Kleros arbitrator to deliver a ruling.
     *         Stores the ruling for later execution.
     * @param _disputeID The Kleros dispute ID
     * @param _ruling    0=refused, 1=poster, 2=challenger
     */
    function rule(uint256 _disputeID, uint256 _ruling) external override {
        require(msg.sender == address(arbitrator), "Only arbitrator");

        DisputeData storage d = disputes[_disputeID];
        require(d.status == DisputeStatus.Active, "Dispute not active");
        require(_ruling <= RULING_CHOICES, "Invalid ruling");

        d.ruling = _ruling;
        d.status = DisputeStatus.Ruled;
    }

    /**
     * @notice Execute a Kleros ruling on SimpleBondV4. Callable by anyone.
     *         Waits for the SimpleBondV4 ruling window to be open.
     * @param _disputeID The Kleros dispute ID to execute
     */
    function executeRuling(uint256 _disputeID) external {
        DisputeData storage d = disputes[_disputeID];
        require(d.status == DisputeStatus.Ruled, "Not yet ruled");

        uint256 bondId = d.bondId;

        // Verify ruling window is open
        uint256 windowStart = simpleBond.rulingWindowStart(bondId);
        require(block.timestamp >= windowStart, "Before ruling window");
        uint256 deadline = simpleBond.rulingDeadline(bondId);
        require(block.timestamp <= deadline, "Past ruling deadline");

        d.status = DisputeStatus.Executed;

        // Get bond's judgeFee for forwarding
        uint256 judgeFee = _getBondJudgeFee(bondId);

        if (d.ruling == RULING_POSTER) {
            simpleBond.ruleForPoster(bondId, judgeFee);
        } else if (d.ruling == RULING_CHALLENGER) {
            simpleBond.ruleForChallenger(bondId, judgeFee);
        } else {
            // ruling == 0 (refused) → reject bond, refund all
            simpleBond.rejectBond(bondId);
        }

        emit RulingExecuted(bondId, _disputeID, d.ruling);
    }

    /**
     * @notice Submit evidence for a dispute. Anyone can submit.
     * @param bondId         The bond ID
     * @param challengeIndex The challenge index
     * @param _evidence      IPFS URI or evidence string
     */
    function submitEvidence(
        uint256 bondId,
        uint256 challengeIndex,
        string calldata _evidence
    ) external {
        require(hasDispute[bondId][challengeIndex], "No dispute for this challenge");

        uint256 dID = bondChallengeToDispute[bondId][challengeIndex];
        DisputeData storage d = disputes[dID];
        require(d.status == DisputeStatus.Active, "Dispute not active");

        uint256 evidenceGroupID = _evidenceGroupID(bondId, challengeIndex);
        emit Evidence(arbitrator, evidenceGroupID, msg.sender, _evidence);
    }

    // --- Owner Functions -----------------------------------------------------

    /**
     * @notice Withdraw accumulated judge fees (ERC-20 tokens sent to this contract).
     * @param token  ERC-20 token to withdraw
     * @param to     Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawFees(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Zero address");
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Update the arbitrator extra data for future disputes.
     *         Does not affect existing disputes.
     * @param _arbitratorExtraData New extra data (subcourt ID + juror count)
     */
    function updateArbitratorExtraData(bytes calldata _arbitratorExtraData) external onlyOwner {
        arbitratorExtraData = _arbitratorExtraData;
    }

    /**
     * @notice Transfer ownership of this adapter.
     * @param newOwner The new owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // --- View Functions ------------------------------------------------------

    /**
     * @notice Returns the current arbitration cost from Kleros.
     * @return cost The arbitration cost in wei
     */
    function getArbitrationCost() external view returns (uint256) {
        return arbitrator.arbitrationCost(arbitratorExtraData);
    }

    // --- Internal ------------------------------------------------------------

    /**
     * @dev Reads a single bond field via staticcall to bonds(bondId).
     *      The bonds() ABI returns 14 values. We decode the full return data
     *      and extract only the words we need by offset, avoiding stack-too-deep.
     *
     *      Field offsets (32 bytes each, but string at index 9 uses an offset pointer):
     *        0=poster, 1=judge, 2=token, 3=bondAmount, 4=challengeAmount,
     *        5=judgeFee, 6=deadline, 7=acceptanceDelay, 8=rulingBuffer,
     *        9=metadata(offset), 10=settled, 11=conceded, 12=currentChallenge,
     *        13=lastChallengeTime
     */
    function _readBondWord(uint256 bondId, uint256 wordIndex) internal view returns (uint256) {
        (bool ok, bytes memory data) = address(simpleBond).staticcall(
            abi.encodeWithSignature("bonds(uint256)", bondId)
        );
        require(ok, "bonds() call failed");
        // Each ABI word is 32 bytes; skip to the desired word
        uint256 value;
        uint256 offset = 32 * wordIndex;
        require(data.length >= offset + 32, "Invalid bond data");
        assembly {
            value := mload(add(add(data, 32), offset))
        }
        return value;
    }

    /**
     * @dev Validates bond state for arbitration request and returns currentChallenge index.
     */
    function _validateAndGetChallenge(uint256 bondId) internal view returns (uint256) {
        address poster = address(uint160(_readBondWord(bondId, 0)));
        address judge  = address(uint160(_readBondWord(bondId, 1)));
        bool settled   = _readBondWord(bondId, 10) != 0;
        bool conceded  = _readBondWord(bondId, 11) != 0;
        uint256 currentChallenge = _readBondWord(bondId, 12);

        require(judge == address(this), "Not judge for this bond");
        require(!settled, "Bond already settled");
        require(!conceded, "Bond conceded");

        uint256 challengeCount = simpleBond.getChallengeCount(bondId);
        require(currentChallenge < challengeCount, "No pending challenge");

        (address challenger, uint8 challengeStatus, ) =
            simpleBond.getChallenge(bondId, currentChallenge);
        require(challengeStatus == 0, "Challenge not pending");

        require(
            msg.sender == poster || msg.sender == challenger,
            "Only poster or challenger"
        );

        return currentChallenge;
    }

    /**
     * @dev Returns the judgeFee for a bond (field index 5).
     */
    function _getBondJudgeFee(uint256 bondId) internal view returns (uint256) {
        return _readBondWord(bondId, 5);
    }

    /**
     * @dev Computes a unique evidence group ID from bondId and challengeIndex.
     */
    function _evidenceGroupID(
        uint256 bondId,
        uint256 challengeIndex
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(bondId, challengeIndex)));
    }
}
