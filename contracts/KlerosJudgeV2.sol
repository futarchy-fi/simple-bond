// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IArbitrator.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ISimpleBondV4
 * @notice Minimal interface for the SimpleBondV4 functions KlerosJudgeV2 needs.
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
 * @title KlerosJudgeV2
 * @notice Permissionless Kleros adapter with keeper economics.
 *
 *         Collapses the two-fee structure (SimpleBond judgeFee + xDAI to Kleros)
 *         into one coherent model: the SimpleBond judgeFee is the only fee.
 *         A keeper fronts xDAI to pay Kleros and receives the ERC-20 judgeFee
 *         as compensation when the ruling is executed.
 *
 *         Flow:
 *         1. Bond is created with this contract as judge
 *         2. After a challenge, anyone can pre-fund xDAI via fundBond()
 *         3. Owner has a grace period to trigger arbitration (and earn fees)
 *         4. After grace, anyone can trigger (and earn fees if they pay xDAI)
 *         5. Kleros jurors deliberate and call rule()
 *         6. Anyone calls executeRuling() once the ruling window is open
 *         7. Funder calls claimFee() to receive the ERC-20 judgeFee
 *
 *         Ruling convention (ERC-792):
 *           0 = Refused to arbitrate → rejectBond (refund all, no fee)
 *           1 = Poster wins → ruleForPoster
 *           2 = Challenger wins → ruleForChallenger
 */
contract KlerosJudgeV2 is IArbitrable, IEvidence {
    using SafeERC20 for IERC20;

    // --- Constants -----------------------------------------------------------

    uint256 public constant RULING_CHOICES = 2;
    uint256 public constant RULING_POSTER = 1;
    uint256 public constant RULING_CHALLENGER = 2;

    // --- Immutables ----------------------------------------------------------

    IArbitrator public immutable arbitrator;
    ISimpleBondV4 public immutable simpleBond;
    uint256 public immutable ownerGracePeriod;

    // --- State ---------------------------------------------------------------

    /// @notice Arbitrator extra data (subcourt + juror count). No setter — immutable by design.
    bytes public arbitratorExtraData;

    /// @notice Owner — economic beneficiary only, cannot influence rulings.
    address public owner;

    enum DisputeStatus { None, Active, Ruled, Executed }

    /// @notice Per-bond dispute state, keyed by (bondId, challengeIndex).
    struct BondDispute {
        address funder;          // who paid xDAI → gets the ERC-20 fee
        uint256 xdaiPaid;        // how much xDAI was sent to Kleros
        uint256 disputeId;       // Kleros dispute ID
        DisputeStatus status;    // None, Active, Ruled, Executed
        uint256 ruling;          // 0=refused, 1=poster, 2=challenger
        bool feeClaimed;         // whether funder claimed their ERC-20
    }

    mapping(uint256 => mapping(uint256 => BondDispute)) public bondDisputes;

    /// @notice Pre-funded xDAI per bond (anyone can deposit).
    mapping(uint256 => uint256) public bondXdaiBalance;

    /// @notice Reverse lookup: disputeId → bondId
    mapping(uint256 => uint256) internal _disputeBondId;
    /// @notice Reverse lookup: disputeId → challengeIndex
    mapping(uint256 => uint256) internal _disputeChallengeIndex;

    /// @notice Duplicate prevention: bondId → challengeIndex → hasDispute
    mapping(uint256 => mapping(uint256 => bool)) public hasDispute;

    // --- Events --------------------------------------------------------------

    event ArbitrationTriggered(
        uint256 indexed bondId,
        uint256 challengeIndex,
        uint256 indexed disputeId,
        address indexed funder
    );

    event RulingExecuted(
        uint256 indexed bondId,
        uint256 indexed disputeId,
        uint256 ruling
    );

    event FeeClaimed(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed funder,
        address indexed token,
        uint256 amount
    );

    event BondFunded(uint256 indexed bondId, address indexed depositor, uint256 amount);
    event BondFundingWithdrawn(uint256 indexed bondId, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // --- Constructor ---------------------------------------------------------

    /**
     * @param _arbitrator          Kleros arbitrator contract (e.g., KlerosLiquid)
     * @param _simpleBond          SimpleBondV4 contract
     * @param _arbitratorExtraData Encodes subcourt ID + juror count
     * @param _ownerGracePeriod    Seconds the owner has priority to trigger arbitration
     * @param _metaEvidence        IPFS URI to ERC-1497 meta-evidence JSON
     */
    constructor(
        address _arbitrator,
        address _simpleBond,
        bytes memory _arbitratorExtraData,
        uint256 _ownerGracePeriod,
        string memory _metaEvidence
    ) {
        require(_arbitrator != address(0), "Zero arbitrator");
        require(_simpleBond != address(0), "Zero simpleBond");

        arbitrator = IArbitrator(_arbitrator);
        simpleBond = ISimpleBondV4(_simpleBond);
        ownerGracePeriod = _ownerGracePeriod;
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
     * @notice Pre-deposit xDAI for a bond. Owner gets the fee if this xDAI is used.
     * @param bondId The bond to fund
     */
    function fundBond(uint256 bondId) external payable {
        require(msg.value > 0, "Zero value");
        bondXdaiBalance[bondId] += msg.value;
        emit BondFunded(bondId, msg.sender, msg.value);
    }

    /**
     * @notice Withdraw unused pre-funded xDAI for a bond. Owner only.
     * @param bondId The bond to withdraw from
     */
    function withdrawBondFunding(uint256 bondId) external onlyOwner {
        uint256 bal = bondXdaiBalance[bondId];
        require(bal > 0, "No balance");
        bondXdaiBalance[bondId] = 0;
        (bool sent, ) = owner.call{value: bal}("");
        require(sent, "Transfer failed");
        emit BondFundingWithdrawn(bondId, bal);
    }

    /**
     * @notice Trigger Kleros arbitration for a challenged bond.
     *         During the owner grace period, only the owner can trigger.
     *         After grace, anyone can trigger.
     *
     *         xDAI source priority:
     *         1. Pre-funded balance covers cost → funder = owner
     *         2. msg.value covers cost (no pre-funded) → funder = owner (grace) or msg.sender
     *         3. Pre-funded + msg.value covers cost → funder = owner
     *
     * @param bondId The bond with a pending challenge
     * @return disputeId The Kleros dispute ID
     */
    function triggerArbitration(uint256 bondId) external payable returns (uint256 disputeId) {
        uint256 currentChallenge = _validateAndGetChallenge(bondId);

        // No duplicate dispute for this challenge
        require(!hasDispute[bondId][currentChallenge], "Dispute already exists");

        // Check grace period
        uint256 lastChallengeTime = _readBondWord(bondId, 13);
        bool withinGrace = block.timestamp <= lastChallengeTime + ownerGracePeriod;
        if (withinGrace) {
            require(msg.sender == owner, "Owner grace period active");
        }

        // Determine cost and funding source
        uint256 cost = arbitrator.arbitrationCost(arbitratorExtraData);
        uint256 preFunded = bondXdaiBalance[bondId];

        // Determine funder and how much pre-funded vs msg.value to use
        address funder;
        uint256 preFundedUsed;

        if (preFunded >= cost) {
            // Case 1: pre-funded covers full cost → funder = owner
            funder = owner;
            preFundedUsed = cost;
        } else if (preFunded == 0 && msg.value >= cost) {
            // Case 2: no pre-funded, msg.value covers cost
            funder = withinGrace ? owner : msg.sender;
            preFundedUsed = 0;
        } else if (preFunded > 0 && preFunded + msg.value >= cost) {
            // Case 3: combined → funder = owner (pre-funded contributed)
            funder = owner;
            preFundedUsed = preFunded;
        } else {
            revert("Insufficient funds");
        }

        // Deduct from pre-funded balance
        if (preFundedUsed > 0) {
            bondXdaiBalance[bondId] -= preFundedUsed;
        }

        // Calculate how much of msg.value is actually needed
        uint256 msgValueUsed = cost - preFundedUsed;

        // Create Kleros dispute (sends cost as xDAI to arbitrator)
        disputeId = arbitrator.createDispute{value: cost}(
            RULING_CHOICES,
            arbitratorExtraData
        );

        // Store dispute
        bondDisputes[bondId][currentChallenge] = BondDispute({
            funder: funder,
            xdaiPaid: cost,
            disputeId: disputeId,
            status: DisputeStatus.Active,
            ruling: 0,
            feeClaimed: false
        });

        hasDispute[bondId][currentChallenge] = true;
        _disputeBondId[disputeId] = bondId;
        _disputeChallengeIndex[disputeId] = currentChallenge;

        // Refund excess msg.value
        uint256 refund = msg.value - msgValueUsed;
        if (refund > 0) {
            (bool sent, ) = msg.sender.call{value: refund}("");
            require(sent, "Refund failed");
        }

        // Emit ERC-1497 events
        uint256 evidenceGroupID = _evidenceGroupID(bondId, currentChallenge);
        emit Dispute(arbitrator, disputeId, 0, evidenceGroupID);
        emit ArbitrationTriggered(bondId, currentChallenge, disputeId, funder);

        return disputeId;
    }

    /**
     * @notice Called by Kleros arbitrator to deliver a ruling.
     *         Stores the ruling for later execution.
     * @param _disputeID The Kleros dispute ID
     * @param _ruling    0=refused, 1=poster, 2=challenger
     */
    function rule(uint256 _disputeID, uint256 _ruling) external override {
        require(msg.sender == address(arbitrator), "Only arbitrator");

        uint256 bondId = _disputeBondId[_disputeID];
        uint256 challengeIndex = _disputeChallengeIndex[_disputeID];
        BondDispute storage d = bondDisputes[bondId][challengeIndex];
        require(d.status == DisputeStatus.Active, "Dispute not active");
        require(_ruling <= RULING_CHOICES, "Invalid ruling");

        d.ruling = _ruling;
        d.status = DisputeStatus.Ruled;
    }

    /**
     * @notice Execute a Kleros ruling on SimpleBondV4. Callable by anyone.
     *         Waits for the SimpleBondV4 ruling window to be open.
     * @param bondId         The bond ID
     * @param challengeIndex The challenge index
     */
    function executeRuling(uint256 bondId, uint256 challengeIndex) external {
        BondDispute storage d = bondDisputes[bondId][challengeIndex];
        require(d.status == DisputeStatus.Ruled, "Not yet ruled");

        // Verify ruling window is open
        uint256 windowStart = simpleBond.rulingWindowStart(bondId);
        require(block.timestamp >= windowStart, "Before ruling window");
        uint256 deadline = simpleBond.rulingDeadline(bondId);
        require(block.timestamp <= deadline, "Past ruling deadline");

        d.status = DisputeStatus.Executed;

        // Get bond's judgeFee — full fee passed to SimpleBond
        uint256 judgeFee = _getBondJudgeFee(bondId);

        if (d.ruling == RULING_POSTER) {
            simpleBond.ruleForPoster(bondId, judgeFee);
        } else if (d.ruling == RULING_CHALLENGER) {
            simpleBond.ruleForChallenger(bondId, judgeFee);
        } else {
            // ruling == 0 (refused) → reject bond, refund all
            simpleBond.rejectBond(bondId);
        }

        emit RulingExecuted(bondId, d.disputeId, d.ruling);
    }

    /**
     * @notice Claim the ERC-20 judgeFee after ruling execution.
     *         Only available for rulings 1 (poster) or 2 (challenger) — not refused (0).
     * @param bondId         The bond ID
     * @param challengeIndex The challenge index
     */
    function claimFee(uint256 bondId, uint256 challengeIndex) external {
        BondDispute storage d = bondDisputes[bondId][challengeIndex];
        require(d.status == DisputeStatus.Executed, "Not yet executed");
        require(d.ruling != 0, "Refused ruling, no fee");
        require(!d.feeClaimed, "Already claimed");
        require(msg.sender == d.funder, "Only funder");

        d.feeClaimed = true;

        address token = address(uint160(_readBondWord(bondId, 2)));
        uint256 judgeFee = _getBondJudgeFee(bondId);

        IERC20(token).safeTransfer(d.funder, judgeFee);
        emit FeeClaimed(bondId, challengeIndex, d.funder, token, judgeFee);
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

        BondDispute storage d = bondDisputes[bondId][challengeIndex];
        require(d.status == DisputeStatus.Active, "Dispute not active");

        uint256 evidenceGroupID = _evidenceGroupID(bondId, challengeIndex);
        emit Evidence(arbitrator, evidenceGroupID, msg.sender, _evidence);
    }

    // --- Owner Functions -----------------------------------------------------

    /**
     * @notice Transfer ownership. Economic rights only — cannot influence rulings.
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

    /**
     * @notice Returns the full dispute state for a bond challenge.
     */
    function getBondDispute(
        uint256 bondId,
        uint256 challengeIndex
    ) external view returns (
        address funder,
        uint256 xdaiPaid,
        uint256 disputeId,
        DisputeStatus status,
        uint256 ruling,
        bool feeClaimed
    ) {
        BondDispute storage d = bondDisputes[bondId][challengeIndex];
        return (d.funder, d.xdaiPaid, d.disputeId, d.status, d.ruling, d.feeClaimed);
    }

    /**
     * @notice Check if the owner grace period is still active for a bond.
     * @param bondId The bond ID
     * @return True if within grace period
     */
    function isWithinGracePeriod(uint256 bondId) external view returns (bool) {
        uint256 lastChallengeTime = _readBondWord(bondId, 13);
        return block.timestamp <= lastChallengeTime + ownerGracePeriod;
    }

    // --- Internal ------------------------------------------------------------

    /**
     * @dev Reads a single bond field via staticcall to bonds(bondId).
     *      Field offsets (32 bytes each):
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
        uint256 value;
        uint256 offset = 32 * wordIndex;
        require(data.length >= offset + 32, "Invalid bond data");
        assembly {
            value := mload(add(add(data, 32), offset))
        }
        return value;
    }

    /**
     * @dev Validates bond state for arbitration and returns currentChallenge index.
     *      Unlike V1, does NOT restrict to poster/challenger — anyone can trigger.
     */
    function _validateAndGetChallenge(uint256 bondId) internal view returns (uint256) {
        address judge  = address(uint160(_readBondWord(bondId, 1)));
        bool settled   = _readBondWord(bondId, 10) != 0;
        bool conceded  = _readBondWord(bondId, 11) != 0;
        uint256 currentChallenge = _readBondWord(bondId, 12);

        require(judge == address(this), "Not judge for this bond");
        require(!settled, "Bond already settled");
        require(!conceded, "Bond conceded");

        uint256 challengeCount = simpleBond.getChallengeCount(bondId);
        require(currentChallenge < challengeCount, "No pending challenge");

        (, uint8 challengeStatus, ) =
            simpleBond.getChallenge(bondId, currentChallenge);
        require(challengeStatus == 0, "Challenge not pending");

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
