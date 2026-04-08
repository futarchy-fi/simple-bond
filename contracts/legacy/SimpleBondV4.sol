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

    /// @notice Returns the next bond ID that will be assigned by createBond().
    uint256 public nextBondId;
    /// @notice Returns the stored bond fields for a bond ID.
    mapping(uint256 => Bond) public bonds;
    /// @notice Returns the stored challenge fields for a bond ID and challenge index.
    mapping(uint256 => Challenge[]) public challenges;
    /// @notice Returns the judge registry record for a judge address.
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

    /// @notice Register as a judge so future bonds can name you.
    /// @dev After registering, configure per-token minimum fees with `setJudgeFee`.
    function registerAsJudge() external {
        judges[msg.sender].registered = true;
        emit JudgeRegistered(msg.sender);
    }

    /// @notice Deregister as a judge for future bonds.
    /// @dev Existing bonds that already named the caller are unaffected.
    function deregisterAsJudge() external {
        require(judges[msg.sender].registered, "Caller is not a registered judge");
        judges[msg.sender].registered = false;
        emit JudgeDeregistered(msg.sender);
    }

    /// @notice Set the caller's minimum ruling fee for a specific token.
    /// @dev Different tokens have different decimals and market values, so fees are tracked per token.
    /// @param token ERC-20 token address.
    /// @param minFee Minimum fee per ruling in token units, where `0` means free.
    function setJudgeFee(address token, uint256 minFee) external {
        require(judges[msg.sender].registered, "Caller is not a registered judge");
        require(token != address(0), "Token address cannot be zero");
        judgeMinFees[msg.sender][token] = minFee;
        emit JudgeFeeUpdated(msg.sender, token, minFee);
    }

    /// @notice Set the caller's minimum ruling fees for multiple tokens.
    /// @dev Each entry is validated and emitted independently, so gas still scales linearly with `tokens.length`.
    /// @param tokens Array of ERC-20 token addresses.
    /// @param minFees Array of minimum fees in token units, matched by index with `tokens`.
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

    /// @notice Reject a bond as its assigned judge and refund every participant.
    /// @dev This settles the bond immediately, similar to `concede`, but can only be called by the bond's judge.
    /// @param bondId Bond to reject.
    function rejectBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.poster != address(0), "Bond does not exist");
        require(!b.settled, "Bond is already settled");
        require(!b.conceded, "Claim is already conceded");
        require(msg.sender == b.judge, "Caller is not the judge for this bond");

        b.settled = true;

        // Refund poster's bond
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        // Terminal path accepts the shared refund-loop cost once.
        _refundRemaining(bondId, 0);

        emit BondRejectedByJudge(bondId, msg.sender);
    }

    // --- Bond Creation ----------------------------------------------------

    /// @notice Create a bond asserting a claim and escrow the poster's collateral.
    /// @dev The contract accepts arbitrary ERC-20 tokens, so callers must trust the selected token's transfer semantics.
    /// @param token ERC-20 token to lock as collateral.
    /// @param bondAmount Amount the poster locks.
    /// @param challengeAmount Amount each challenger must escrow.
    /// @param judgeFee Maximum fee the judge may charge per ruling.
    /// @param judge Address authorized to rule on disputes.
    /// @param deadline Latest timestamp when a challenge may be filed while the bond remains active.
    /// @param acceptanceDelay Seconds after a challenge before the judge may rule.
    /// @param rulingBuffer Seconds the judge has to rule once the ruling window opens.
    /// @param _metadata Claim description or assertion text.
    /// @return bondId Newly assigned bond identifier.
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

    /// @notice Challenge a bond and escrow the configured challenge amount.
    /// @dev This queue is intentionally permissionless and uncapped, so spam resistance is purely economic.
    /// @param bondId Bond to challenge.
    /// @param _metadata Challenger reasoning or evidence.
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

    /// @notice Concede the claim and refund the poster plus all pending challengers.
    /// @dev This can only happen while at least one challenge is pending and before any ruling has started.
    /// @param bondId Bond to concede.
    /// @param _metadata Poster's concession statement.
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

        // Terminal path accepts the shared refund-loop cost once.
        _refundRemaining(bondId, 0);

        emit ClaimConceded(bondId, b.poster, _metadata);
        emit BondConceded(bondId);
    }

    // --- Judge Rulings ----------------------------------------------------

    /// @notice Rule in favor of the current challenger and settle the bond.
    /// @dev Later pending challengers are refunded because this is a terminal challenger-win path.
    /// @param bondId Bond to rule on.
    /// @param feeCharged Amount charged to the pot for the judge, from `0` up to `judgeFee`.
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

    /// @notice Rule in favor of the poster on the current challenge and advance the queue.
    /// @dev This path does not settle the whole bond unless the advanced queue later reaches a terminal path.
    /// @param bondId Bond to rule on.
    /// @param feeCharged Amount charged to the current challenge for the judge, from `0` up to `judgeFee`.
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

    /// @notice Withdraw the poster's bond when there are no pending challenges.
    /// @dev Bonds remain revocable until challenged, even if their challenge deadline has not yet passed.
    /// @param bondId Bond to withdraw.
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

    /// @notice Resolve an expired dispute by refunding the poster and all pending challengers.
    /// @dev Anyone may call this after the ruling deadline passes with unresolved pending challenges.
    /// @param bondId Bond whose unresolved challenge queue has timed out.
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

        // Terminal path accepts the shared refund-loop cost once.
        _refundRemaining(bondId, b.currentChallenge);

        emit BondTimedOut(bondId);
    }

    // --- Views ------------------------------------------------------------

    /// @notice Return the total number of challenges recorded for a bond.
    /// @param bondId Bond to inspect.
    /// @return count Total number of challenges filed against the bond.
    function getChallengeCount(uint256 bondId) external view returns (uint256 count) {
        _requireBondExists(bondId);
        return challenges[bondId].length;
    }

    /// @notice Return the stored data for a specific challenge on a bond.
    /// @param bondId Bond to inspect.
    /// @param index Challenge index to read.
    /// @return challenger Challenger address.
    /// @return status Recorded challenge status.
    /// @return metadata Challenger-supplied metadata string.
    function getChallenge(uint256 bondId, uint256 index)
        external view returns (address challenger, uint8 status, string memory metadata)
    {
        _requireBondExists(bondId);
        require(index < challenges[bondId].length, "Challenge does not exist");
        Challenge storage c = challenges[bondId][index];
        return (c.challenger, c.status, c.metadata);
    }

    /// @notice Return a judge's configured minimum fee for a specific token.
    /// @param judge Judge address to inspect.
    /// @param token ERC-20 token address to inspect.
    /// @return minFee Configured minimum fee in token units.
    function getJudgeMinFee(address judge, address token) external view returns (uint256 minFee) {
        require(judge != address(0), "Judge address cannot be zero");
        require(token != address(0), "Token address cannot be zero");
        return judgeMinFees[judge][token];
    }

    /// @notice Return the earliest time the judge may begin ruling on a bond.
    /// @dev This is `max(deadline, lastChallengeTime + acceptanceDelay)`.
    /// @param bondId Bond to inspect.
    /// @return windowStart Timestamp when the ruling window opens.
    function rulingWindowStart(uint256 bondId) public view returns (uint256 windowStart) {
        _requireBondExists(bondId);
        return _rulingWindowStartFor(bonds[bondId]);
    }

    /// @notice Return the deadline by which the judge must finish ruling on a bond.
    /// @param bondId Bond to inspect.
    /// @return deadline Timestamp when the ruling window closes.
    function rulingDeadline(uint256 bondId) public view returns (uint256 deadline) {
        _requireBondExists(bondId);
        return _rulingDeadlineFor(bonds[bondId]);
    }

    // --- Internal ---------------------------------------------------------

    /// @notice Return the start of the ruling window for a bond record.
    /// @param b Bond storage record to inspect.
    /// @return windowStart Later of the bond deadline and the acceptance-delay gate.
    function _rulingWindowStartFor(Bond storage b) internal view returns (uint256 windowStart) {
        uint256 afterDeadline = b.deadline;
        uint256 afterAcceptance = b.lastChallengeTime + b.acceptanceDelay;
        return afterDeadline > afterAcceptance ? afterDeadline : afterAcceptance;
    }

    /// @notice Revert unless the provided bond ID exists.
    /// @param bondId Bond identifier to validate.
    function _requireBondExists(uint256 bondId) internal view {
        require(bonds[bondId].poster != address(0), "Bond does not exist");
    }

    /// @notice Revert unless the current timestamp is inside the bond's ruling window.
    /// @param bondId Bond identifier to validate.
    function _requireRulingWindow(uint256 bondId) internal view {
        Bond storage b = bonds[bondId];
        uint256 start = _rulingWindowStartFor(b);
        uint256 end = start + b.rulingBuffer;
        require(block.timestamp >= start, "Ruling window has not opened");
        require(block.timestamp <= end, "Ruling deadline has passed");
    }

    /// @notice Return the ruling deadline for an existing bond ID.
    /// @param bondId Bond identifier to inspect.
    /// @return deadline Timestamp when the ruling window closes.
    function _rulingDeadline(uint256 bondId) internal view returns (uint256 deadline) {
        return _rulingDeadlineFor(bonds[bondId]);
    }

    /// @notice Return the ruling deadline for a bond record.
    /// @param b Bond storage record to inspect.
    /// @return deadline Timestamp when the ruling window closes.
    function _rulingDeadlineFor(Bond storage b) internal view returns (uint256 deadline) {
        return _rulingWindowStartFor(b) + b.rulingBuffer;
    }

    /// @notice Return whether a bond has no pending challenges left to resolve.
    /// @param bondId Bond identifier to inspect.
    /// @return noPending True when all challenges have been resolved or none exist.
    function _noPendingChallenges(uint256 bondId) internal view returns (bool noPending) {
        uint256 len = challenges[bondId].length;
        if (len == 0) return true;
        return bonds[bondId].currentChallenge >= len;
    }

    /// @notice Refund every still-pending challenger from a starting index onward.
    /// @dev This loop is intentionally centralized in terminal and escape-hatch flows despite its O(n) cost.
    /// @param bondId Bond whose queued challengers should be refunded.
    /// @param startIdx First challenge index to consider for refunds.
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
