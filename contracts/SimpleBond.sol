// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SimpleBond
 * @notice Challenge-queue bond contract (Robin Hanson design).
 *
 *         A poster deposits a bond and names a judge, a challenge amount, and a
 *         judge fee. Anyone can challenge by depositing the challenge amount.
 *         Challenges form a FIFO queue. The judge rules on one challenge at a
 *         time:
 *           - ruleForChallenger → challenger wins bond+challenge−fee, judge
 *             gets fee, remaining challengers refunded, bond settled.
 *           - ruleForPoster → poster keeps challenge−fee, judge gets fee,
 *             queue advances to the next challenger.
 *
 *         If the judge doesn't rule by the ruling deadline, anyone may call
 *         claimTimeout to refund everyone and penalise the judge (no fee).
 */
contract SimpleBond {
    using SafeERC20 for IERC20;

    struct Challenge {
        address challenger;
        uint8 status; // 0=pending, 1=won, 2=lost, 3=refunded
    }

    struct Bond {
        address poster;
        address judge;
        address token;
        uint256 bondAmount;
        uint256 challengeAmount;
        uint256 judgeFee;
        uint256 deadline;
        uint256 rulingDeadline;
        string metadata;
        bool settled;
        uint256 currentChallenge; // index into challenges array
    }

    uint256 public nextBondId;
    mapping(uint256 => Bond) public bonds;
    mapping(uint256 => Challenge[]) public challenges;

    event BondCreated(
        uint256 indexed bondId,
        address indexed poster,
        address indexed judge,
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        uint256 deadline,
        uint256 rulingDeadline,
        string metadata
    );
    event Challenged(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger);
    event RuledForChallenger(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger);
    event RuledForPoster(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger);
    event ChallengeRefunded(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger);
    event BondWithdrawn(uint256 indexed bondId);
    event BondTimedOut(uint256 indexed bondId);

    /**
     * @notice Create a bond. Caller deposits `bondAmount` of `token`.
     * @param token           ERC-20 token to lock
     * @param bondAmount      Amount the poster locks
     * @param challengeAmount Amount each challenger must deposit
     * @param judgeFee        Fixed fee paid to the judge per ruling
     * @param judge           Address authorized to rule
     * @param deadline        Challenges accepted before this timestamp
     * @param rulingBuffer    Seconds after deadline for judge to rule
     * @param metadata        Free-text description
     */
    function createBond(
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        address judge,
        uint256 deadline,
        uint256 rulingBuffer,
        string calldata metadata
    ) external returns (uint256 bondId) {
        require(bondAmount > 0, "Zero bond amount");
        require(challengeAmount > 0, "Zero challenge amount");
        require(judge != address(0), "Zero judge");
        require(deadline > block.timestamp, "Deadline in past");
        require(rulingBuffer > 0, "Zero ruling buffer");
        require(judgeFee < bondAmount + challengeAmount, "Fee >= pot");
        require(judgeFee <= challengeAmount, "Fee > challenge amount");

        bondId = nextBondId++;
        uint256 rulingDeadline = deadline + rulingBuffer;

        bonds[bondId] = Bond({
            poster: msg.sender,
            judge: judge,
            token: token,
            bondAmount: bondAmount,
            challengeAmount: challengeAmount,
            judgeFee: judgeFee,
            deadline: deadline,
            rulingDeadline: rulingDeadline,
            metadata: metadata,
            settled: false,
            currentChallenge: 0
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), bondAmount);

        emit BondCreated(
            bondId, msg.sender, judge, token,
            bondAmount, challengeAmount, judgeFee,
            deadline, rulingDeadline, metadata
        );
    }

    /**
     * @notice Challenge a bond. Caller deposits challengeAmount.
     */
    function challenge(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(block.timestamp <= b.deadline, "Past deadline");
        require(b.poster != address(0), "Bond does not exist");

        uint256 idx = challenges[bondId].length;
        challenges[bondId].push(Challenge({
            challenger: msg.sender,
            status: 0
        }));

        IERC20(b.token).safeTransferFrom(msg.sender, address(this), b.challengeAmount);

        emit Challenged(bondId, idx, msg.sender);
    }

    /**
     * @notice Poster withdraws their bond.
     *         Allowed before deadline if zero challenges, or after all
     *         challenges have been resolved in poster's favor.
     */
    function withdrawBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(msg.sender == b.poster, "Only poster");
        require(_noPendingChallenges(bondId), "Pending challenges");

        b.settled = true;
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        emit BondWithdrawn(bondId);
    }

    /**
     * @notice Judge rules in favor of the current challenger.
     *         Challenger receives bondAmount + challengeAmount − judgeFee.
     *         Judge receives judgeFee.
     *         All remaining pending challengers are refunded.
     *         Bond is settled.
     */
    function ruleForChallenger(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(msg.sender == b.judge, "Only judge");
        require(block.timestamp <= b.rulingDeadline, "Past ruling deadline");

        uint256 idx = b.currentChallenge;
        require(idx < challenges[bondId].length, "No pending challenge");
        Challenge storage c = challenges[bondId][idx];
        require(c.status == 0, "Challenge not pending");

        c.status = 1; // won
        b.settled = true;

        uint256 pot = b.bondAmount + b.challengeAmount;
        uint256 toChallenger = pot - b.judgeFee;

        IERC20(b.token).safeTransfer(c.challenger, toChallenger);
        if (b.judgeFee > 0) {
            IERC20(b.token).safeTransfer(b.judge, b.judgeFee);
        }

        emit RuledForChallenger(bondId, idx, c.challenger);

        // Refund remaining pending challengers
        _refundRemaining(bondId, idx + 1);
    }

    /**
     * @notice Judge rules in favor of the poster on the current challenge.
     *         Poster receives challengeAmount − judgeFee.
     *         Judge receives judgeFee.
     *         Queue advances to the next challenger.
     */
    function ruleForPoster(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(msg.sender == b.judge, "Only judge");
        require(block.timestamp <= b.rulingDeadline, "Past ruling deadline");

        uint256 idx = b.currentChallenge;
        require(idx < challenges[bondId].length, "No pending challenge");
        Challenge storage c = challenges[bondId][idx];
        require(c.status == 0, "Challenge not pending");

        c.status = 2; // lost

        uint256 toPoster = b.challengeAmount - b.judgeFee;
        IERC20(b.token).safeTransfer(b.poster, toPoster);
        if (b.judgeFee > 0) {
            IERC20(b.token).safeTransfer(b.judge, b.judgeFee);
        }

        emit RuledForPoster(bondId, idx, c.challenger);

        // Advance to next challenge
        b.currentChallenge = idx + 1;
    }

    /**
     * @notice Anyone can call after rulingDeadline if there are pending
     *         challenges. Refunds poster's bond and all pending challengers.
     *         Judge gets nothing.
     */
    function claimTimeout(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Already settled");
        require(block.timestamp > b.rulingDeadline, "Before ruling deadline");
        require(!_noPendingChallenges(bondId), "No pending challenges");

        b.settled = true;

        // Refund poster's bond
        IERC20(b.token).safeTransfer(b.poster, b.bondAmount);

        // Refund all pending challengers
        _refundRemaining(bondId, b.currentChallenge);

        emit BondTimedOut(bondId);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function getChallengeCount(uint256 bondId) external view returns (uint256) {
        return challenges[bondId].length;
    }

    function getChallenge(uint256 bondId, uint256 index)
        external view returns (address challenger, uint8 status)
    {
        Challenge storage c = challenges[bondId][index];
        return (c.challenger, c.status);
    }

    // ─── Internal ────────────────────────────────────────────────────────

    function _noPendingChallenges(uint256 bondId) internal view returns (bool) {
        Bond storage b = bonds[bondId];
        uint256 len = challenges[bondId].length;
        if (len == 0) return true;
        // All challenges before currentChallenge are resolved.
        // If currentChallenge >= len, all are resolved.
        return b.currentChallenge >= len;
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
