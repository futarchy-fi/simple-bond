// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SimpleBond v3
 * @notice Truth-machine bond contract (Robin Hanson design).
 *
 *         A poster creates a bond asserting a claim, locking tokens and naming
 *         a judge. Anyone can challenge by depositing the challenge amount.
 *         Challenges form a FIFO queue.
 *
 *         NEW in v3:
 *           - Poster can CONCEDE after a challenge, publicly admitting the
 *             claim is wrong. Everyone is refunded, judge is not invoked.
 *           - Acceptance delay: after a challenge, the poster has a configurable
 *             window to concede before the judge can rule.
 *           - Challengers attach metadata (reasoning) to their challenges.
 *           - Judge can waive part or all of their fee when ruling.
 *
 *         Economics (fixed throughout):
 *           - Challenger threshold = challengeAmount / (bondAmount + challengeAmount - judgeFee)
 *             "I believe there's at least X% chance the poster is wrong"
 *           - Poster threshold = 1 - bondAmount / (bondAmount + challengeAmount - judgeFee)
 *             "I'd concede only if >Y% chance I'm wrong"
 *
 *         Example: bond=$10K, challenge=$3K, judgeFee=$0.5K
 *           → Challenger signals >24% belief poster is wrong
 *           → Poster signals <20% belief they're wrong
 *
 *         When challenger loses:
 *           - Judge gets feeCharged (0..judgeFee) from challenger's stake
 *           - Poster gets challengeAmount - feeCharged
 *           - Bond pool stays at bondAmount (amounts stay fixed)
 *
 *         When challenger wins:
 *           - Judge gets feeCharged (0..judgeFee) from the pool
 *           - Challenger gets bondAmount + challengeAmount - feeCharged
 *           - Remaining challengers refunded. Bond settled.
 */
contract SimpleBondV3 {
    using SafeERC20 for IERC20;

    error InsufficientChallengeAmount(uint256 challengeAmount, uint256 judgeFee);

    // ─── Data Structures ────────────────────────────────────────────────

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

    /// @notice Returns the next bond ID that will be assigned by `createBond`.
    uint256 public nextBondId;
    /// @notice Returns the stored bond fields for a bond ID.
    mapping(uint256 => Bond) public bonds;
    /// @notice Returns the stored challenge fields for a bond ID and challenge index.
    mapping(uint256 => Challenge[]) public challenges;

    // ─── Events ─────────────────────────────────────────────────────────

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

    // ─── Bond Creation ──────────────────────────────────────────────────

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
        require(bondAmount > 0, "Zero bond amount");
        require(challengeAmount > 0, "Zero challenge amount");
        require(judge != address(0), "Zero judge");
        require(deadline > block.timestamp, "Deadline in past");
        require(rulingBuffer > 0, "Zero ruling buffer");
        if (judgeFee > challengeAmount) {
            revert InsufficientChallengeAmount(challengeAmount, judgeFee);
        }

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

    // ─── Challenge ──────────────────────────────────────────────────────

    /// @notice Challenge a bond and escrow the configured challenge amount.
    /// @dev This queue is intentionally permissionless and uncapped, so spam resistance is purely economic.
    /// @param bondId Bond to challenge.
    /// @param _metadata Challenger reasoning or evidence.
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

    // ─── Poster Concession ──────────────────────────────────────────────

    /// @notice Concede the claim and refund the poster plus all pending challengers.
    /// @dev This can only happen while at least one challenge is pending and before any ruling has started.
    /// @param bondId Bond to concede.
    /// @param _metadata Poster's concession statement.
    function concede(uint256 bondId, string calldata _metadata) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Already conceded");
        require(msg.sender == b.poster, "Only poster");
        require(!_noPendingChallenges(bondId), "No pending challenges");
        // Poster can only concede before any ruling has been made.
        // Once the judge rules on the first challenge, concession is no longer available.
        require(b.currentChallenge == 0, "Ruling already started");

        b.conceded = true;
        b.settled = true;

        // Refund poster's bond
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        // Refund all pending challengers
        _refundRemaining(bondId, 0);

        emit ClaimConceded(bondId, b.poster, _metadata);
    }

    // ─── Judge Rulings ──────────────────────────────────────────────────

    /// @notice Rule in favor of the current challenger and settle the bond.
    /// @dev Later pending challengers are refunded because this is a terminal challenger-win path.
    /// @param bondId Bond to rule on.
    /// @param feeCharged Amount charged to the pot for the judge, from `0` up to `judgeFee`.
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

    /// @notice Rule in favor of the poster on the current challenge and advance the queue.
    /// @dev This path does not settle the whole bond unless the advanced queue later reaches a terminal path.
    /// @param bondId Bond to rule on.
    /// @param feeCharged Amount charged to the current challenge for the judge, from `0` up to `judgeFee`.
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

    // ─── Poster Withdrawal ──────────────────────────────────────────────

    /// @notice Withdraw the poster's bond when there are no pending challenges.
    /// @dev Bonds remain revocable until challenged, even if their challenge deadline has not yet passed.
    /// @param bondId Bond to withdraw.
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

    // ─── Timeout ────────────────────────────────────────────────────────

    /// @notice Resolve an expired dispute by refunding the poster and all pending challengers.
    /// @dev Anyone may call this after the ruling deadline passes with unresolved pending challenges.
    /// @param bondId Bond whose unresolved challenge queue has timed out.
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

    // ─── Views ──────────────────────────────────────────────────────────

    /// @notice Return the total number of challenges recorded for a bond.
    /// @param bondId Bond to inspect.
    /// @return count Total number of challenges filed against the bond.
    function getChallengeCount(uint256 bondId) external view returns (uint256 count) {
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
        Challenge storage c = challenges[bondId][index];
        return (c.challenger, c.status, c.metadata);
    }

    /// @notice Return the earliest time the judge may begin ruling on a bond.
    /// @dev This is `max(deadline, lastChallengeTime + acceptanceDelay)`.
    /// @param bondId Bond to inspect.
    /// @return windowStart Timestamp when the ruling window opens.
    function rulingWindowStart(uint256 bondId) public view returns (uint256 windowStart) {
        Bond storage b = bonds[bondId];
        uint256 afterDeadline = b.deadline;
        uint256 afterAcceptance = b.lastChallengeTime + b.acceptanceDelay;
        return afterDeadline > afterAcceptance ? afterDeadline : afterAcceptance;
    }

    /// @notice Return the deadline by which the judge must finish ruling on a bond.
    /// @param bondId Bond to inspect.
    /// @return deadline Timestamp when the ruling window closes.
    function rulingDeadline(uint256 bondId) public view returns (uint256 deadline) {
        return _rulingDeadline(bondId);
    }

    // ─── Internal ───────────────────────────────────────────────────────

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
