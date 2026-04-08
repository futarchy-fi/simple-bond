// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SimpleBond v4
 * @notice Truth-machine bond contract (Robin Hanson design).
 *
 *         A poster creates a bond asserting a claim, locking tokens and naming
 *         a judge. Anyone can challenge by depositing the challenge amount.
 *         Challenges form a FIFO queue.
 *
 *         NEW in v4:
 *           - Judge Registry: judges must register before being named on a bond.
 *           - Per-token Minimum Fee: judges set a minimum fee per token.
 *           - Bond Rejection: judges can reject a specific bond, refunding all parties.
 *           - Deregistering doesn't affect existing bonds.
 *
 *         Carried from v3:
 *           - Poster can CONCEDE after a challenge.
 *           - Acceptance delay before judge can rule.
 *           - Challengers attach metadata to challenges.
 *           - Judge can waive part or all of their fee when ruling.
 */
contract SimpleBondV4 {
    using SafeERC20 for IERC20;

    // --- Data Structures --------------------------------------------------

    struct Challenge {
        address challenger;
        uint8   status;   // 0=pending, 1=won, 2=lost, 3=refunded
        string  metadata; // challenger's reasoning
    }

    struct Bond {
        address poster;
        address judge;
        address token;
        uint256 bondAmount;
        uint256 challengeAmount;
        uint256 judgeFee;          // max fee per ruling (judge can charge less)
        uint256 deadline;          // challenges accepted before this timestamp
        uint256 acceptanceDelay;   // seconds after challenge before judge can rule
        uint256 rulingBuffer;      // seconds judge has to rule after window opens
        string  metadata;          // claim description
        bool    settled;
        bool    conceded;          // poster publicly conceded the claim
        uint256 currentChallenge;  // index into challenges array
        uint256 lastChallengeTime; // timestamp of most recent challenge
    }

    struct JudgeInfo {
        bool registered;
    }

    uint256 public nextBondId;
    mapping(uint256 => Bond) public bonds;
    mapping(uint256 => Challenge[]) public challenges;
    mapping(address => JudgeInfo) public judges;
    /// @notice Per-token minimum fee: judgeMinFees[judge][token] = minFee
    mapping(address => mapping(address => uint256)) public judgeMinFees;

    // --- Events -----------------------------------------------------------

    event BondCreated(
        uint256 indexed bondId,
        address indexed poster,
        address indexed judge,
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        uint256 deadline,
        uint256 acceptanceDelay,
        uint256 rulingBuffer,
        string  metadata
    );

    event Challenged(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        string  metadata
    );

    /// @notice Emitted when the poster publicly concedes the claim is wrong.
    event ClaimConceded(
        uint256 indexed bondId,
        address indexed poster,
        string  metadata
    );

    event RuledForChallenger(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        uint256 feeCharged
    );

    event RuledForPoster(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        uint256 feeCharged
    );

    event ChallengeRefunded(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger
    );

    event BondWithdrawn(uint256 indexed bondId);
    event BondTimedOut(uint256 indexed bondId);

    // Judge Registry events
    event JudgeRegistered(address indexed judge);
    event JudgeDeregistered(address indexed judge);
    event JudgeFeeUpdated(address indexed judge, address indexed token, uint256 newMinFee);
    event BondRejectedByJudge(uint256 indexed bondId, address indexed judge);

    // --- Judge Registry ---------------------------------------------------

    /**
     * @notice Register as a judge. Anyone can register.
     *         After registering, set per-token minimum fees with setJudgeFee().
     */
    function registerAsJudge() external {
        judges[msg.sender].registered = true;
        emit JudgeRegistered(msg.sender);
    }

    /**
     * @notice Deregister as a judge. Stops future bonds from naming you,
     *         but existing bonds are unaffected — you must still fulfill duty.
     */
    function deregisterAsJudge() external {
        require(judges[msg.sender].registered, "Not registered");
        judges[msg.sender].registered = false;
        emit JudgeDeregistered(msg.sender);
    }

    /**
     * @notice Set minimum fee for a specific token. Must be registered.
     *         Different tokens have different decimals/values, so fees are per-token.
     * @param token   ERC-20 token address
     * @param minFee  Minimum fee per ruling in token units (0 = free)
     */
    function setJudgeFee(address token, uint256 minFee) external {
        require(judges[msg.sender].registered, "Not registered");
        judgeMinFees[msg.sender][token] = minFee;
        emit JudgeFeeUpdated(msg.sender, token, minFee);
    }

    /**
     * @notice Set minimum fees for multiple tokens in one transaction.
     * @param tokens  Array of ERC-20 token addresses
     * @param minFees Array of minimum fees (same length as tokens)
     */
    function setJudgeFees(address[] calldata tokens, uint256[] calldata minFees) external {
        require(judges[msg.sender].registered, "Not registered");
        require(tokens.length == minFees.length, "Length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            judgeMinFees[msg.sender][tokens[i]] = minFees[i];
            emit JudgeFeeUpdated(msg.sender, tokens[i], minFees[i]);
        }
    }

    /**
     * @notice Judge rejects a bond, refunding poster + all challengers.
     *         Like concede but called by the judge. Bond is settled.
     * @param bondId Bond to reject
     */
    function rejectBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.poster != address(0), "Bond does not exist");
        require(!b.settled, "Already settled");
        require(!b.conceded, "Already conceded");
        require(msg.sender == b.judge, "Only judge");

        b.settled = true;

        // Refund poster's bond
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        // Refund all pending challengers
        _refundRemaining(bondId, 0);

        emit BondRejectedByJudge(bondId, msg.sender);
    }

    // --- Bond Creation ----------------------------------------------------

    /**
     * @notice Create a bond asserting a claim. Caller deposits bondAmount.
     * @param token            ERC-20 token to lock (sDAI recommended for yield)
     * @param bondAmount       Amount the poster locks as collateral
     * @param challengeAmount  Amount each challenger must deposit
     * @param judgeFee         Max fee paid to judge per ruling (judge may waive)
     * @param judge            Address authorized to rule on disputes
     * @param deadline         Challenges accepted before this timestamp
     * @param acceptanceDelay  Seconds after a challenge before judge can rule
     * @param rulingBuffer     Seconds judge has to rule once window opens
     * @param _metadata        Claim description / assertion text
     */
    function createBond(
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        address judge,
        uint256 deadline,
        uint256 acceptanceDelay,
        uint256 rulingBuffer,
        string calldata _metadata
    ) external returns (uint256 bondId) {
        require(bondAmount > 0, "Zero bond amount");
        require(challengeAmount > 0, "Zero challenge amount");
        require(judge != address(0), "Zero judge");
        require(deadline > block.timestamp, "Deadline in past");
        require(rulingBuffer > 0, "Zero ruling buffer");
        require(judgeFee <= challengeAmount, "Fee > challenge amount");
        require(judges[judge].registered, "Judge not registered");
        require(judgeFee >= judgeMinFees[judge][token], "Fee below judge minimum");

        bondId = nextBondId++;

        bonds[bondId] = Bond({
            poster: msg.sender,
            judge: judge,
            token: token,
            bondAmount: bondAmount,
            challengeAmount: challengeAmount,
            judgeFee: judgeFee,
            deadline: deadline,
            acceptanceDelay: acceptanceDelay,
            rulingBuffer: rulingBuffer,
            metadata: _metadata,
            settled: false,
            conceded: false,
            currentChallenge: 0,
            lastChallengeTime: 0
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), bondAmount);

        emit BondCreated(
            bondId, msg.sender, judge, token,
            bondAmount, challengeAmount, judgeFee,
            deadline, acceptanceDelay, rulingBuffer,
            _metadata
        );
    }

    // --- Challenge --------------------------------------------------------

    /**
     * @notice Challenge a bond. Caller deposits challengeAmount.
     * @param bondId   Bond to challenge
     * @param _metadata Challenger's reasoning / evidence
     */
    function challenge(uint256 bondId, string calldata _metadata) external {
        Bond storage b = bonds[bondId];
        require(b.poster != address(0), "Bond does not exist");
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(block.timestamp <= b.deadline, "Past deadline");

        uint256 idx = challenges[bondId].length;
        challenges[bondId].push(Challenge({
            challenger: msg.sender,
            status: 0,
            metadata: _metadata
        }));

        b.lastChallengeTime = block.timestamp;

        IERC20(b.token).safeTransferFrom(msg.sender, address(this), b.challengeAmount);

        emit Challenged(bondId, idx, msg.sender, _metadata);
    }

    // --- Poster Concession ------------------------------------------------

    /**
     * @notice Poster publicly concedes the claim is wrong.
     *         All parties are refunded: poster gets bondAmount back,
     *         all pending challengers get challengeAmount back.
     *         Judge is not invoked and receives nothing.
     *
     *         Can only be called while challenges are pending and before
     *         the judge has started ruling (no rulings yet).
     *
     * @param bondId    Bond to concede
     * @param _metadata Poster's concession statement
     */
    function concede(uint256 bondId, string calldata _metadata) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Already conceded");
        require(msg.sender == b.poster, "Only poster");
        require(!_noPendingChallenges(bondId), "No pending challenges");
        require(b.currentChallenge == 0, "Ruling already started");

        b.conceded = true;
        b.settled = true;

        // Refund poster's bond
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        // Refund all pending challengers
        _refundRemaining(bondId, 0);

        emit ClaimConceded(bondId, b.poster, _metadata);
    }

    // --- Judge Rulings ----------------------------------------------------

    /**
     * @notice Judge rules in favor of the current challenger.
     *         Challenger receives bondAmount + challengeAmount - feeCharged.
     *         Judge receives feeCharged. All remaining challengers refunded.
     *         Bond is settled.
     *
     * @param bondId     Bond to rule on
     * @param feeCharged Amount judge charges (0 to judgeFee). Allows fee waiver.
     */
    function ruleForChallenger(uint256 bondId, uint256 feeCharged) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(msg.sender == b.judge, "Only judge");
        require(feeCharged <= b.judgeFee, "Fee exceeds max");
        _requireRulingWindow(bondId);

        uint256 idx = b.currentChallenge;
        require(idx < challenges[bondId].length, "No pending challenge");
        Challenge storage c = challenges[bondId][idx];
        require(c.status == 0, "Challenge not pending");

        c.status = 1; // won
        b.settled = true;

        uint256 pot = b.bondAmount + b.challengeAmount;
        uint256 toChallenger = pot - feeCharged;

        IERC20(b.token).safeTransfer(c.challenger, toChallenger);
        if (feeCharged > 0) {
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }

        emit RuledForChallenger(bondId, idx, c.challenger, feeCharged);

        // Refund remaining pending challengers
        _refundRemaining(bondId, idx + 1);
    }

    /**
     * @notice Judge rules in favor of the poster on the current challenge.
     *         Poster receives challengeAmount - feeCharged.
     *         Judge receives feeCharged. Queue advances.
     *
     * @param bondId     Bond to rule on
     * @param feeCharged Amount judge charges (0 to judgeFee). Allows fee waiver.
     */
    function ruleForPoster(uint256 bondId, uint256 feeCharged) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(msg.sender == b.judge, "Only judge");
        require(feeCharged <= b.judgeFee, "Fee exceeds max");
        _requireRulingWindow(bondId);

        uint256 idx = b.currentChallenge;
        require(idx < challenges[bondId].length, "No pending challenge");
        Challenge storage c = challenges[bondId][idx];
        require(c.status == 0, "Challenge not pending");

        c.status = 2; // lost

        uint256 toPoster = b.challengeAmount - feeCharged;
        IERC20(b.token).safeTransfer(b.poster, toPoster);
        if (feeCharged > 0) {
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }

        emit RuledForPoster(bondId, idx, c.challenger, feeCharged);

        // Advance to next challenge
        b.currentChallenge = idx + 1;
    }

    // --- Poster Withdrawal ------------------------------------------------

    /**
     * @notice Poster withdraws their bond.
     *         Allowed anytime there are no pending challenges (before or after deadline).
     */
    function withdrawBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(msg.sender == b.poster, "Only poster");
        require(_noPendingChallenges(bondId), "Pending challenges");

        b.settled = true;
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        emit BondWithdrawn(bondId);
    }

    // --- Timeout ----------------------------------------------------------

    /**
     * @notice Anyone can call after the ruling deadline if the judge hasn't
     *         finished ruling. Refunds poster's bond and all pending challengers.
     *         Judge gets nothing (punished for inaction).
     */
    function claimTimeout(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(!_noPendingChallenges(bondId), "No pending challenges");

        uint256 rulingEnd = _rulingDeadline(bondId);
        require(block.timestamp > rulingEnd, "Before ruling deadline");

        b.settled = true;

        // Refund poster's bond
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        // Refund all pending challengers
        _refundRemaining(bondId, b.currentChallenge);

        emit BondTimedOut(bondId);
    }

    // --- Views ------------------------------------------------------------

    function getChallengeCount(uint256 bondId) external view returns (uint256) {
        return challenges[bondId].length;
    }

    function getChallenge(uint256 bondId, uint256 index)
        external view returns (address challenger, uint8 status, string memory metadata)
    {
        Challenge storage c = challenges[bondId][index];
        return (c.challenger, c.status, c.metadata);
    }

    /// @notice Returns the judge's minimum fee for a specific token.
    function getJudgeMinFee(address judge, address token) external view returns (uint256) {
        return judgeMinFees[judge][token];
    }

    /**
     * @notice Returns the earliest time the judge can start ruling.
     *         max(deadline, lastChallengeTime + acceptanceDelay)
     */
    function rulingWindowStart(uint256 bondId) public view returns (uint256) {
        Bond storage b = bonds[bondId];
        uint256 afterDeadline = b.deadline;
        uint256 afterAcceptance = b.lastChallengeTime + b.acceptanceDelay;
        return afterDeadline > afterAcceptance ? afterDeadline : afterAcceptance;
    }

    /**
     * @notice Returns the deadline by which the judge must finish ruling.
     */
    function rulingDeadline(uint256 bondId) public view returns (uint256) {
        return _rulingDeadline(bondId);
    }

    // --- Internal ---------------------------------------------------------

    function _requireRulingWindow(uint256 bondId) internal view {
        Bond storage b = bonds[bondId];
        uint256 start = rulingWindowStart(bondId);
        uint256 end = start + b.rulingBuffer;
        require(block.timestamp >= start, "Before ruling window");
        require(block.timestamp <= end, "Past ruling deadline");
    }

    function _rulingDeadline(uint256 bondId) internal view returns (uint256) {
        Bond storage b = bonds[bondId];
        return rulingWindowStart(bondId) + b.rulingBuffer;
    }

    function _noPendingChallenges(uint256 bondId) internal view returns (bool) {
        uint256 len = challenges[bondId].length;
        if (len == 0) return true;
        return bonds[bondId].currentChallenge >= len;
    }

    function _refundRemaining(uint256 bondId, uint256 startIdx) internal {
        Bond storage b = bonds[bondId];
        uint256 len = challenges[bondId].length;
        for (uint256 i = startIdx; i < len; i++) {
            Challenge storage c = challenges[bondId][i];
            if (c.status == 0) {
                c.status = 3; // refunded
                IERC20(b.token).safeTransfer(c.challenger, b.challengeAmount);
                emit ChallengeRefunded(bondId, i, c.challenger);
            }
        }
    }
}
