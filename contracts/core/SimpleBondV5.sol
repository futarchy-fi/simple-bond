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

    uint256 public nextBondId;
    mapping(uint256 => Bond) public bonds;
    mapping(uint256 => Challenge[]) public challenges;
    mapping(uint256 => uint256) public refundCursor;
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
        require(rulingBuffer > 0, "Zero ruling buffer");
        require(judgeFee <= challengeAmount, "Fee > challenge amount");

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
        b.currentChallenge = idx + 1;

        IERC20(b.token).safeTransfer(b.poster, b.challengeAmount - feeCharged);
        if (feeCharged > 0) {
            // See ruleForChallenger: the core pays the judge contract directly.
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }

        emit RuledForPoster(bondId, idx, c.challenger, feeCharged);
    }

    function withdrawBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(!b.conceded, "Claim conceded");
        require(msg.sender == b.poster, "Only poster");
        require(block.timestamp > b.deadline, "Before deadline");
        require(_noPendingChallenges(bondId), "Pending challenges");

        b.settled = true;
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        emit BondWithdrawn(bondId);
    }

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

    function claimRefunds(uint256 bondId, uint256 maxCount) external {
        require(maxCount > 0, "Zero max count");

        uint256 cursor = refundCursor[bondId];
        uint256 end = refundEnd[bondId];
        require(cursor < end, "No refundable challenges");

        Bond storage b = bonds[bondId];
        uint256 processed;

        while (cursor < end && processed < maxCount) {
            Challenge storage c = challenges[bondId][cursor];
            if (c.status == 0) {
                c.status = 3;
                IERC20(b.token).safeTransfer(c.challenger, b.challengeAmount);
                emit ChallengeRefunded(bondId, cursor, c.challenger);
            }

            cursor++;
            processed++;
        }

        if (cursor >= end) {
            delete refundCursor[bondId];
            delete refundEnd[bondId];
        } else {
            refundCursor[bondId] = cursor;
        }
    }

    function getChallengeCount(uint256 bondId) external view returns (uint256) {
        return challenges[bondId].length;
    }

    function getChallenge(
        uint256 bondId,
        uint256 index
    ) external view returns (address challenger, uint8 status, string memory metadata) {
        Challenge storage c = challenges[bondId][index];
        return (c.challenger, c.status, c.metadata);
    }

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

    function concessionDeadline(uint256 bondId) public view returns (uint256) {
        // Concession stays open exactly until the judge's ruling window opens.
        return rulingWindowStart(bondId);
    }

    function rulingWindowStart(uint256 bondId) public view returns (uint256) {
        Bond storage b = bonds[bondId];
        // The judge must wait until both the public challenge deadline and the
        // post-challenge acceptance delay have elapsed.
        uint256 afterDeadline = b.deadline;
        uint256 afterAcceptance = b.lastChallengeTime + b.acceptanceDelay;
        return afterDeadline > afterAcceptance ? afterDeadline : afterAcceptance;
    }

    function rulingDeadline(uint256 bondId) public view returns (uint256) {
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
        if (startIdx >= len) {
            return;
        }

        refundCursor[bondId] = startIdx;
        refundEnd[bondId] = len;

        emit ChallengeRefundsEnabled(bondId, startIdx, len - startIdx);
    }
}
