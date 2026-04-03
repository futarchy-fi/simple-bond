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

    uint8 private constant BOND_RESOLVED_FOR_POSTER = 1;
    uint8 private constant BOND_RESOLVED_FOR_CHALLENGER = 2;

    error InsufficientChallengeAmount(uint256 challengeAmount, uint256 judgeFee);

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

    event BondCreated(
        uint256 indexed bondId,
        address indexed poster,
        address token,
        uint256 amount
    );

    event Challenged(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        string  metadata
    );

    event BondChallenged(
        uint256 indexed bondId,
        address indexed challenger,
        uint256 amount
    );

    /// @notice Emitted when the poster publicly concedes the claim is wrong.
    event ClaimConceded(
        uint256 indexed bondId,
        address indexed poster,
        string  metadata
    );

    event BondConceded(uint256 indexed bondId);

    /// @notice verdict: 1 = poster won, 2 = challenger won.
    event BondResolved(uint256 indexed bondId, uint8 verdict);

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
        require(judges[msg.sender].registered, "Caller is not a registered judge");
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
        require(judges[msg.sender].registered, "Caller is not a registered judge");
        require(token != address(0), "Token address cannot be zero");
        judgeMinFees[msg.sender][token] = minFee;
        emit JudgeFeeUpdated(msg.sender, token, minFee);
    }

    /**
     * @notice Set minimum fees for multiple tokens in one transaction.
     * @param tokens  Array of ERC-20 token addresses
     * @param minFees Array of minimum fees (same length as tokens)
     */
    function setJudgeFees(address[] calldata tokens, uint256[] calldata minFees) external {
        require(judges[msg.sender].registered, "Caller is not a registered judge");
        require(tokens.length == minFees.length, "Token and minimum fee array lengths must match");
        require(tokens.length > 0, "At least one token fee entry is required");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "Token address cannot be zero");
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
        require(!b.settled, "Bond is already settled");
        require(!b.conceded, "Claim is already conceded");
        require(msg.sender == b.judge, "Caller is not the judge for this bond");

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
     * @dev This contract intentionally accepts arbitrary ERC-20 tokens and does
     *      not maintain a token allowlist. That maximizes flexibility, but users
     *      must trust the chosen token's transfer semantics and overall behavior.
     * @param token            ERC-20 token to lock (sDAI recommended for yield)
     * @param bondAmount       Amount the poster locks as collateral
     * @param challengeAmount  Amount each challenger must deposit
     * @param judgeFee         Max fee paid to judge per ruling (judge may waive)
     * @param judge            Address authorized to rule on disputes
     * @param deadline         Latest time challenges may be filed while the bond
     *                         remains active; this is not a guaranteed open
     *                         challenge window because the poster may withdraw
     *                         earlier if no challenge is pending
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
        require(bondAmount > 0, "Bond amount must be greater than zero");
        require(challengeAmount > 0, "Challenge amount must be greater than zero");
        require(judge != address(0), "Judge address cannot be zero");
        require(deadline > block.timestamp, "Challenge deadline must be in the future");
        require(rulingBuffer > 0, "Ruling buffer must be greater than zero");
        if (judgeFee > challengeAmount) {
            revert InsufficientChallengeAmount(challengeAmount, judgeFee);
        }
        require(judges[judge].registered, "Selected judge is not registered");
        require(judgeFee >= judgeMinFees[judge][token], "Judge fee is below the selected judge's minimum for this token");

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
        emit BondCreated(bondId, msg.sender, token, bondAmount);
    }

    // --- Challenge --------------------------------------------------------

    /**
     * @notice Challenge a bond. Caller deposits challengeAmount.
     * @dev This entrypoint is intentionally permissionless and the queue is left
     *      uncapped: anyone may challenge, including multiple challengers in
     *      sequence. Spam resistance is economic because every queued challenge
     *      must escrow the full `challengeAmount`, which frontends commonly
     *      default to 50% of the bond.
     * @param bondId   Bond to challenge
     * @param _metadata Challenger's reasoning / evidence
     */
    function challenge(uint256 bondId, string calldata _metadata) external {
        Bond storage b = bonds[bondId];
        require(b.poster != address(0), "Bond does not exist");
        require(!b.settled, "Bond is already settled");
        require(!b.conceded, "Claim is already conceded");
        require(block.timestamp <= b.deadline, "Challenge deadline has passed");

        uint256 idx = challenges[bondId].length;
        challenges[bondId].push(Challenge({
            challenger: msg.sender,
            status: 0,
            metadata: _metadata
        }));

        b.lastChallengeTime = block.timestamp;

        IERC20(b.token).safeTransferFrom(msg.sender, address(this), b.challengeAmount);

        emit Challenged(bondId, idx, msg.sender, _metadata);
        emit BondChallenged(bondId, msg.sender, b.challengeAmount);
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
        _requireBondExists(bondId);
        Bond storage b = bonds[bondId];
        require(!b.settled, "Bond is already settled");
        require(!b.conceded, "Claim is already conceded");
        require(msg.sender == b.poster, "Caller is not the poster for this bond");
        require(!_noPendingChallenges(bondId), "Bond has no pending challenges");
        require(b.currentChallenge == 0, "Ruling has already started");

        b.conceded = true;
        b.settled = true;

        // Refund poster's bond
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        // Refund all pending challengers
        _refundRemaining(bondId, 0);

        emit ClaimConceded(bondId, b.poster, _metadata);
        emit BondConceded(bondId);
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
        _requireBondExists(bondId);
        Bond storage b = bonds[bondId];
        require(!b.settled, "Bond is already settled");
        require(!b.conceded, "Claim is already conceded");
        require(msg.sender == b.judge, "Caller is not the judge for this bond");
        require(feeCharged <= b.judgeFee, "Fee charged exceeds the bond's maximum judge fee");
        _requireRulingWindow(bondId);

        uint256 idx = b.currentChallenge;
        require(idx < challenges[bondId].length, "No pending challenge to rule on");
        Challenge storage c = challenges[bondId][idx];
        require(c.status == 0, "Current challenge is not pending");

        c.status = 1; // won
        b.settled = true;

        uint256 pot = b.bondAmount + b.challengeAmount;
        uint256 toChallenger = pot - feeCharged;

        IERC20(b.token).safeTransfer(c.challenger, toChallenger);
        if (feeCharged > 0) {
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }

        emit RuledForChallenger(bondId, idx, c.challenger, feeCharged);
        emit BondResolved(bondId, BOND_RESOLVED_FOR_CHALLENGER);

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
        _requireBondExists(bondId);
        Bond storage b = bonds[bondId];
        require(!b.settled, "Bond is already settled");
        require(!b.conceded, "Claim is already conceded");
        require(msg.sender == b.judge, "Caller is not the judge for this bond");
        require(feeCharged <= b.judgeFee, "Fee charged exceeds the bond's maximum judge fee");
        _requireRulingWindow(bondId);

        uint256 idx = b.currentChallenge;
        require(idx < challenges[bondId].length, "No pending challenge to rule on");
        Challenge storage c = challenges[bondId][idx];
        require(c.status == 0, "Current challenge is not pending");

        c.status = 2; // lost

        uint256 toPoster = b.challengeAmount - feeCharged;
        IERC20(b.token).safeTransfer(b.poster, toPoster);
        if (feeCharged > 0) {
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }

        emit RuledForPoster(bondId, idx, c.challenger, feeCharged);
        emit BondResolved(bondId, BOND_RESOLVED_FOR_POSTER);

        // Advance to next challenge
        b.currentChallenge = idx + 1;
    }

    // --- Poster Withdrawal ------------------------------------------------

    /**
     * @notice Poster withdraws their bond.
     *         Allowed anytime there are no pending challenges (before or after deadline).
     * @dev This is intentional: a bond is revocable until someone actually
     *      challenges it. The `deadline` therefore marks the last time a
     *      challenge may be filed if the bond is still active, not a guaranteed
     *      period during which the poster is forced to keep the bond open.
     */
    function withdrawBond(uint256 bondId) external {
        _requireBondExists(bondId);
        Bond storage b = bonds[bondId];
        require(!b.settled, "Bond is already settled");
        require(!b.conceded, "Claim is already conceded");
        require(msg.sender == b.poster, "Caller is not the poster for this bond");
        require(_noPendingChallenges(bondId), "Bond still has pending challenges");

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
        _requireBondExists(bondId);
        Bond storage b = bonds[bondId];
        require(!b.settled, "Bond is already settled");
        require(!b.conceded, "Claim is already conceded");
        require(!_noPendingChallenges(bondId), "Bond has no pending challenges");

        uint256 rulingEnd = _rulingDeadline(bondId);
        require(block.timestamp > rulingEnd, "Ruling deadline has not passed");

        b.settled = true;

        // Refund poster's bond
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        // Refund all pending challengers
        _refundRemaining(bondId, b.currentChallenge);

        emit BondTimedOut(bondId);
    }

    // --- Views ------------------------------------------------------------

    function getChallengeCount(uint256 bondId) external view returns (uint256) {
        _requireBondExists(bondId);
        return challenges[bondId].length;
    }

    function getChallenge(uint256 bondId, uint256 index)
        external view returns (address challenger, uint8 status, string memory metadata)
    {
        _requireBondExists(bondId);
        require(index < challenges[bondId].length, "Challenge does not exist");
        Challenge storage c = challenges[bondId][index];
        return (c.challenger, c.status, c.metadata);
    }

    /// @notice Returns the judge's minimum fee for a specific token.
    function getJudgeMinFee(address judge, address token) external view returns (uint256) {
        require(judge != address(0), "Judge address cannot be zero");
        require(token != address(0), "Token address cannot be zero");
        return judgeMinFees[judge][token];
    }

    /**
     * @notice Returns the earliest time the judge can start ruling.
     *         max(deadline, lastChallengeTime + acceptanceDelay)
     */
    function rulingWindowStart(uint256 bondId) public view returns (uint256) {
        _requireBondExists(bondId);
        return _rulingWindowStartFor(bonds[bondId]);
    }

    /**
     * @notice Returns the deadline by which the judge must finish ruling.
     */
    function rulingDeadline(uint256 bondId) public view returns (uint256) {
        _requireBondExists(bondId);
        return _rulingDeadlineFor(bonds[bondId]);
    }

    // --- Internal ---------------------------------------------------------

    function _rulingWindowStartFor(Bond storage b) internal view returns (uint256) {
        uint256 afterDeadline = b.deadline;
        uint256 afterAcceptance = b.lastChallengeTime + b.acceptanceDelay;
        return afterDeadline > afterAcceptance ? afterDeadline : afterAcceptance;
    }

    function _requireBondExists(uint256 bondId) internal view {
        require(bonds[bondId].poster != address(0), "Bond does not exist");
    }

    function _requireRulingWindow(uint256 bondId) internal view {
        Bond storage b = bonds[bondId];
        uint256 start = _rulingWindowStartFor(b);
        uint256 end = start + b.rulingBuffer;
        require(block.timestamp >= start, "Ruling window has not opened");
        require(block.timestamp <= end, "Ruling deadline has passed");
    }

    function _rulingDeadline(uint256 bondId) internal view returns (uint256) {
        return _rulingDeadlineFor(bonds[bondId]);
    }

    function _rulingDeadlineFor(Bond storage b) internal view returns (uint256) {
        return _rulingWindowStartFor(b) + b.rulingBuffer;
    }

    function _noPendingChallenges(uint256 bondId) internal view returns (bool) {
        uint256 len = challenges[bondId].length;
        if (len == 0) return true;
        return bonds[bondId].currentChallenge >= len;
    }

    /**
     * @dev Refunds every still-pending challenger from `startIdx` onward.
     *      This is intentionally O(n) in the remaining queue length. The design
     *      relies on the fact that each additional queue entry had to post the
     *      full `challengeAmount`, making very large queues economically costly
     *      rather than free spam.
     */
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
