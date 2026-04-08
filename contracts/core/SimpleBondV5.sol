// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IBondJudgeV5.sol";

/// @title SimpleBondV5
/// @notice Minimal V5 bond core with FIFO challenges and contract-based judges.
/// @dev V5 intentionally stays close to V4, but removes the global judge
/// registry from the core and requires the configured judge to be a contract.
/// Policy about whether to accept a bond and how to handle disputes now lives
/// with the judge implementation rather than the bond core.
contract SimpleBondV5 {
    using SafeERC20 for IERC20;

    /// @notice Returns the maximum acceptance delay allowed for newly created bonds.
    uint256 public constant MAX_ACCEPTANCE_DELAY = 365 days;
    /// @notice Returns the maximum ruling buffer allowed for newly created bonds.
    uint256 public constant MAX_RULING_BUFFER = 365 days;

    struct Challenge {
        address challenger;
        uint8 status; // 0=pending, 1=won, 2=lost, 3=refunded
        string metadata;
    }

    struct Bond {
        address poster;
        // Judges are contracts in V5 so the core can stay generic while judge-
        // specific policy lives in adapter/wrapper contracts.
        address judge;
        address token;
        uint256 bondAmount;
        uint256 challengeAmount;
        uint256 judgeFee; // max fee per ruling; judge may charge less
        uint256 deadline;
        uint256 acceptanceDelay;
        uint256 rulingBuffer;
        string metadata;
        bool settled;
        bool conceded;
        uint256 currentChallenge;
        uint256 lastChallengeTime;
    }

    // Typed core snapshot for judge adapters and off-chain consumers. This
    // avoids brittle raw storage decoding in external integrations.
    struct BondCoreView {
        address poster;
        address judge;
        address token;
        uint256 bondAmount;
        uint256 challengeAmount;
        uint256 judgeFee;
        uint256 deadline;
        uint256 acceptanceDelay;
        uint256 rulingBuffer;
        bool settled;
        bool conceded;
        uint256 currentChallenge;
        uint256 lastChallengeTime;
    }

    /// @notice Returns the next bond ID that will be assigned by `createBond`.
    uint256 public nextBondId;
    /// @notice Returns the stored bond fields for a bond ID.
    mapping(uint256 => Bond) public bonds;
    /// @notice Returns the stored challenge fields for a bond ID and challenge index.
    mapping(uint256 => Challenge[]) public challenges;
    // Terminal outcomes can leave a long unresolved suffix of the challenge
    // queue. Refunds are therefore claimed in bounded batches rather than a
    // single unbounded settlement loop.
    /// @notice Returns the next challenge index eligible to be processed by `claimRefunds` for a bond.
    mapping(uint256 => uint256) public refundCursor;
    /// @notice Returns the exclusive upper bound of the refund-claim range for a bond.
    mapping(uint256 => uint256) public refundEnd;

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
        string metadata
    );

    event Challenged(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        string metadata
    );

    event ClaimConceded(
        uint256 indexed bondId,
        address indexed poster,
        string metadata
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
    event ChallengeRefundsEnabled(
        uint256 indexed bondId,
        uint256 refundFromIndex,
        uint256 refundCount
    );

    event BondWithdrawn(uint256 indexed bondId);
    event BondTimedOut(uint256 indexed bondId);
    event BondRejectedByJudge(uint256 indexed bondId, address indexed judge);

    /// @notice Create a bond asserting a claim and escrow the poster's collateral.
    /// @dev The selected judge must be a contract and must accept the static bond terms via `validateBond`.
    /// @param token ERC-20 token to lock as collateral.
    /// @param bondAmount Amount the poster locks.
    /// @param challengeAmount Amount each challenger must escrow.
    /// @param judgeFee Maximum fee the judge may charge per ruling.
    /// @param judge Judge contract authorized to validate and resolve disputes.
    /// @param deadline Latest timestamp when a challenge may be filed while the bond remains active.
    /// @param acceptanceDelay Seconds after a challenge before the judge may rule.
    /// @param rulingBuffer Seconds the judge has to rule once the ruling window opens.
    /// @param metadata Claim description or assertion text.
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
        string calldata metadata
    ) external returns (uint256 bondId) {
        require(bondAmount > 0, "Zero bond amount");
        require(challengeAmount > 0, "Zero challenge amount");
        require(judge != address(0), "Zero judge");
        require(judge.code.length > 0, "Judge must be contract");
        require(deadline > block.timestamp, "Deadline in past");
        // Bound timing values so the dispute lifecycle stays within a
        // reasonable envelope and downstream window arithmetic remains safe.
        require(acceptanceDelay <= MAX_ACCEPTANCE_DELAY, "Acceptance delay too long");
        require(rulingBuffer > 0, "Zero ruling buffer");
        require(rulingBuffer <= MAX_RULING_BUFFER, "Ruling buffer too long");
        require(judgeFee <= challengeAmount, "Fee > challenge amount");
        require(deadline <= type(uint256).max - acceptanceDelay - rulingBuffer, "Unsafe timing params");

        // Creation-time interface/policy probe. This is not a promise that the
        // judge will later rule on the merits; it only means the judge accepts
        // these static terms at bond creation.
        IBondJudgeV5(judge).validateBond(
            token,
            bondAmount,
            challengeAmount,
            judgeFee,
            deadline,
            acceptanceDelay,
            rulingBuffer
        );

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
            metadata: metadata,
            settled: false,
            conceded: false,
            currentChallenge: 0,
            lastChallengeTime: 0
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), bondAmount);

        emit BondCreated(
            bondId,
            msg.sender,
            judge,
            token,
            bondAmount,
            challengeAmount,
            judgeFee,
            deadline,
            acceptanceDelay,
            rulingBuffer,
            metadata
        );
    }

    /// @notice Challenge a bond and escrow the configured challenge amount.
    /// @dev This queue is intentionally permissionless and uncapped, so spam resistance is purely economic.
    /// @param bondId Bond to challenge.
    /// @param metadata Challenger reasoning or evidence.
    function challenge(uint256 bondId, string calldata metadata) external {
        Bond storage b = bonds[bondId];
        require(b.poster != address(0), "Bond does not exist");
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(block.timestamp <= b.deadline, "Past deadline");

        uint256 idx = challenges[bondId].length;
        challenges[bondId].push(Challenge({
            challenger: msg.sender,
            status: 0,
            metadata: metadata
        }));

        b.lastChallengeTime = block.timestamp;

        IERC20(b.token).safeTransferFrom(msg.sender, address(this), b.challengeAmount);

        emit Challenged(bondId, idx, msg.sender, metadata);
    }

    /// @notice Concede the claim and refund the poster while enabling challenger refunds.
    /// @dev This can only happen while at least one challenge is pending and before the concession window closes.
    /// @param bondId Bond to concede.
    /// @param metadata Poster's concession statement.
    function concede(uint256 bondId, string calldata metadata) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Already conceded");
        require(msg.sender == b.poster, "Only poster");
        require(!_noPendingChallenges(bondId), "No pending challenges");
        // This is the main V5 semantics fix relative to V4: concession closes
        // on a real timestamp, not on implicit queue-state changes.
        require(block.timestamp < concessionDeadline(bondId), "Concession window closed");

        b.conceded = true;
        b.settled = true;

        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);
        _enableRefundClaims(bondId, b.currentChallenge);

        emit ClaimConceded(bondId, b.poster, metadata);
    }

    /// @notice Reject a bond as its assigned judge and enable pending challenger refunds.
    /// @dev This settles the bond immediately without a winner and returns the poster's collateral.
    /// @param bondId Bond to reject.
    function rejectBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.poster != address(0), "Bond does not exist");
        require(!b.settled, "Already settled");
        require(!b.conceded, "Already conceded");
        require(msg.sender == b.judge, "Only judge");

        b.settled = true;

        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);
        _enableRefundClaims(bondId, b.currentChallenge);

        emit BondRejectedByJudge(bondId, msg.sender);
    }

    /// @notice Rule in favor of the current challenger and settle the bond.
    /// @dev Later pending challengers claim refunds in bounded batches after this terminal challenger-win path.
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

        c.status = 1;
        b.settled = true;

        uint256 pot = b.bondAmount + b.challengeAmount;
        IERC20(b.token).safeTransfer(c.challenger, pot - feeCharged);
        if (feeCharged > 0) {
            // Fees accrue to the judge contract, not an operator EOA. This
            // keeps downstream accounting or refunds inside the judge adapter.
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }

        emit RuledForChallenger(bondId, idx, c.challenger, feeCharged);

        _enableRefundClaims(bondId, idx + 1);
    }

    /// @notice Rule in favor of the poster on the current challenge and advance the queue.
    /// @dev This path only settles the active challenge; later challenges remain pending until ruled or refunded.
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

        c.status = 2;

        IERC20(b.token).safeTransfer(b.poster, b.challengeAmount - feeCharged);
        if (feeCharged > 0) {
            // See ruleForChallenger: the core pays the judge contract directly.
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }

        emit RuledForPoster(bondId, idx, c.challenger, feeCharged);

        b.currentChallenge = idx + 1;
    }

    /// @notice Withdraw the poster's bond once the challenge deadline has passed and no challenges remain pending.
    /// @dev Unlike earlier versions, V5 keeps the bond challengeable until the explicit deadline has elapsed.
    /// @param bondId Bond to withdraw.
    function withdrawBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(msg.sender == b.poster, "Only poster");
        // The claim must remain publicly challengeable until the challenge
        // deadline has actually elapsed.
        require(block.timestamp > b.deadline, "Before deadline");
        require(_noPendingChallenges(bondId), "Pending challenges");

        b.settled = true;
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        emit BondWithdrawn(bondId);
    }

    /// @notice Resolve an expired dispute by refunding the poster and enabling pending challenger refunds.
    /// @dev Anyone may call this after the ruling deadline passes with unresolved pending challenges.
    /// @param bondId Bond whose unresolved challenge queue has timed out.
    function claimTimeout(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(!_noPendingChallenges(bondId), "No pending challenges");
        require(block.timestamp > rulingDeadline(bondId), "Before ruling deadline");

        b.settled = true;

        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);
        _enableRefundClaims(bondId, b.currentChallenge);

        emit BondTimedOut(bondId);
    }

    /// @notice Refund pending challengers for a settled bond in a bounded batch.
    /// @dev Repeated calls may be required until `refundCursor` reaches `refundEnd`.
    /// @param bondId Bond whose pending challengers should be refunded.
    /// @param maxCount Maximum number of queued challenge entries to process in this call.
    function claimRefunds(uint256 bondId, uint256 maxCount) external {
        require(maxCount > 0, "Zero maxCount");

        uint256 cursor = refundCursor[bondId];
        uint256 end = refundEnd[bondId];
        require(cursor < end, "No refunds pending");

        Bond storage b = bonds[bondId];
        uint256 processed = 0;

        while (cursor < end && processed < maxCount) {
            Challenge storage c = challenges[bondId][cursor];
            if (c.status == 0) {
                c.status = 3;
                IERC20(b.token).safeTransfer(c.challenger, b.challengeAmount);
                emit ChallengeRefunded(bondId, cursor, c.challenger);
            }

            cursor += 1;
            processed += 1;
        }

        refundCursor[bondId] = cursor;
    }

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
    function getChallenge(
        uint256 bondId,
        uint256 index
    ) external view returns (address challenger, uint8 status, string memory metadata) {
        Challenge storage c = challenges[bondId][index];
        return (c.challenger, c.status, c.metadata);
    }

    /// @notice Return the core bond fields needed by judge adapters and off-chain consumers.
    /// @param bondId Bond to inspect.
    /// @return core Snapshot of the bond's core state excluding the metadata string and challenge array.
    function getBondCore(uint256 bondId) external view returns (BondCoreView memory core) {
        Bond storage b = bonds[bondId];
        core = BondCoreView({
            poster: b.poster,
            judge: b.judge,
            token: b.token,
            bondAmount: b.bondAmount,
            challengeAmount: b.challengeAmount,
            judgeFee: b.judgeFee,
            deadline: b.deadline,
            acceptanceDelay: b.acceptanceDelay,
            rulingBuffer: b.rulingBuffer,
            settled: b.settled,
            conceded: b.conceded,
            currentChallenge: b.currentChallenge,
            lastChallengeTime: b.lastChallengeTime
        });
    }

    /// @notice Return the timestamp when the poster's concession window closes.
    /// @param bondId Bond to inspect.
    /// @return deadline Timestamp when concession stops being available.
    function concessionDeadline(uint256 bondId) public view returns (uint256 deadline) {
        // Concession stays open exactly until the judge's ruling window opens.
        return rulingWindowStart(bondId);
    }

    /// @notice Return the earliest time the judge may begin ruling on a bond.
    /// @dev This is `max(deadline, lastChallengeTime + acceptanceDelay)`.
    /// @param bondId Bond to inspect.
    /// @return windowStart Timestamp when the ruling window opens.
    function rulingWindowStart(uint256 bondId) public view returns (uint256 windowStart) {
        Bond storage b = bonds[bondId];
        // The judge must wait until both the public challenge deadline and the
        // post-challenge acceptance delay have elapsed.
        uint256 afterDeadline = b.deadline;
        uint256 afterAcceptance = b.lastChallengeTime + b.acceptanceDelay;
        return afterDeadline > afterAcceptance ? afterDeadline : afterAcceptance;
    }

    /// @notice Return the deadline by which the judge must finish ruling on a bond.
    /// @param bondId Bond to inspect.
    /// @return deadline Timestamp when the ruling window closes.
    function rulingDeadline(uint256 bondId) public view returns (uint256 deadline) {
        Bond storage b = bonds[bondId];
        return rulingWindowStart(bondId) + b.rulingBuffer;
    }

    function _requireRulingWindow(uint256 bondId) internal view {
        Bond storage b = bonds[bondId];
        uint256 start = rulingWindowStart(bondId);
        uint256 end = start + b.rulingBuffer;
        require(block.timestamp >= start, "Before ruling window");
        require(block.timestamp <= end, "Past ruling deadline");
    }

    function _noPendingChallenges(uint256 bondId) internal view returns (bool) {
        uint256 len = challenges[bondId].length;
        if (len == 0) {
            return true;
        }
        return bonds[bondId].currentChallenge >= len;
    }

    function _enableRefundClaims(uint256 bondId, uint256 startIdx) internal {
        uint256 len = challenges[bondId].length;

        refundCursor[bondId] = startIdx;
        refundEnd[bondId] = len;

        if (startIdx < len) {
            emit ChallengeRefundsEnabled(bondId, startIdx, len - startIdx);
        }
    }
}
