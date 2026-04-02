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
    /**
     * @notice Registers the caller as an available judge.
     */
    function registerAsJudge() external;

    /**
     * @notice Records a ruling in favor of the current challenger.
     * @param bondId The bond to rule on
     * @param feeCharged The judge fee charged for the ruling
     */
    function ruleForChallenger(uint256 bondId, uint256 feeCharged) external;

    /**
     * @notice Records a ruling in favor of the poster.
     * @param bondId The bond to rule on
     * @param feeCharged The judge fee charged for the ruling
     */
    function ruleForPoster(uint256 bondId, uint256 feeCharged) external;

    /**
     * @notice Rejects a bond and unwinds it without a winner.
     * @param bondId The bond to reject
     */
    function rejectBond(uint256 bondId) external;

    /**
     * @notice Returns the earliest timestamp when ruling may begin.
     * @param bondId The bond to inspect
     * @return windowStart The timestamp when the ruling window opens
     */
    function rulingWindowStart(uint256 bondId) external view returns (uint256);

    /**
     * @notice Returns the latest timestamp when ruling is still allowed.
     * @param bondId The bond to inspect
     * @return deadline The timestamp when the ruling window closes
     */
    function rulingDeadline(uint256 bondId) external view returns (uint256);

    /**
     * @notice Returns data for a specific challenge on a bond.
     * @param bondId The bond to inspect
     * @param index The challenge index to read
     * @return challenger The challenger address
     * @return status The challenge status
     * @return metadata The challenge metadata string
     */
    function getChallenge(uint256 bondId, uint256 index)
        external
        view
        returns (address challenger, uint8 status, string memory metadata);

    /**
     * @notice Returns the total number of challenges filed against a bond.
     * @param bondId The bond to inspect
     * @return count The number of recorded challenges
     */
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

    error ZeroArbitratorAddress();
    error ZeroSimpleBondAddress();
    error CallerNotOwner();
    error ZeroWithdrawalRecipient();
    error ZeroNewOwner();
    error DisputeAlreadyExists();
    error BondPastRulingDeadline();
    error InsufficientArbitrationFee();
    error ArbitrationFeeRefundFailed();
    error BondNotJudgedByAdapter();
    error BondAlreadySettled();
    error BondConceded();
    error NoPendingChallenge();
    error ChallengeNotPending();
    error CallerNotPosterOrChallenger();
    error CallerNotArbitrator();
    error DisputeNotActive();
    error InvalidRuling();
    error NoDisputeForChallenge();

    // --- Constants -----------------------------------------------------------

    /// @notice Returns the number of non-zero ruling options Kleros may choose from.
    uint256 public constant RULING_CHOICES = 2;
    /// @notice Returns the ERC-792 ruling value that resolves a dispute in favor of the poster.
    uint256 public constant RULING_POSTER = 1;
    /// @notice Returns the ERC-792 ruling value that resolves a dispute in favor of the challenger.
    uint256 public constant RULING_CHALLENGER = 2;

    // --- Immutables ----------------------------------------------------------

    /// @notice Returns the Kleros arbitrator contract used to create and receive disputes.
    IArbitrator public immutable arbitrator;
    /// @notice Returns the SimpleBondV4 contract this adapter executes rulings against.
    ISimpleBondV4 public immutable simpleBond;

    // --- State ---------------------------------------------------------------

    /// @notice Returns the arbitrator extra data used for future dispute creations.
    bytes public arbitratorExtraData;
    /// @notice Returns the address allowed to administer this adapter.
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
     * @notice Initializes the adapter, registers it as a SimpleBondV4 judge,
     *         and emits the ERC-1497 meta-evidence reference.
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
        if (_arbitrator == address(0)) revert ZeroArbitratorAddress();
        if (_simpleBond == address(0)) revert ZeroSimpleBondAddress();

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
        if (msg.sender != owner) revert CallerNotOwner();
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
        if (hasDispute[bondId][currentChallenge]) revert DisputeAlreadyExists();
        if (block.timestamp > simpleBond.rulingDeadline(bondId)) revert BondPastRulingDeadline();

        // Create Kleros dispute
        uint256 cost = arbitrator.arbitrationCost(arbitratorExtraData);
        if (msg.value < cost) revert InsufficientArbitrationFee();

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
            if (!sent) revert ArbitrationFeeRefundFailed();
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
        if (msg.sender != address(arbitrator)) revert CallerNotArbitrator();

        DisputeData storage d = disputes[_disputeID];
        if (d.status != DisputeStatus.Active) revert DisputeNotActive();
        if (_ruling > RULING_CHOICES) revert InvalidRuling();

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
        if (!hasDispute[bondId][challengeIndex]) revert NoDisputeForChallenge();

        uint256 dID = bondChallengeToDispute[bondId][challengeIndex];
        DisputeData storage d = disputes[dID];
        if (d.status != DisputeStatus.Active) revert DisputeNotActive();

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
        if (to == address(0)) revert ZeroWithdrawalRecipient();
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
        if (newOwner == address(0)) revert ZeroNewOwner();
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

        if (judge != address(this)) revert BondNotJudgedByAdapter();
        if (settled) revert BondAlreadySettled();
        if (conceded) revert BondConceded();

        uint256 challengeCount = simpleBond.getChallengeCount(bondId);
        if (currentChallenge >= challengeCount) revert NoPendingChallenge();

        (address challenger, uint8 challengeStatus, ) =
            simpleBond.getChallenge(bondId, currentChallenge);
        if (challengeStatus != 0) revert ChallengeNotPending();

        if (msg.sender != poster && msg.sender != challenger) {
            revert CallerNotPosterOrChallenger();
        }

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
