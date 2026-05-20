// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IBondJudgeV6.sol";

/// @title SimpleBondV6
/// @notice v0.6 bond core. Adds versioned claims, per-challenge concession, per-challenge timing,
///         judge out-of-scope refunds, close/open toggle, maxChallenges, and hash+event metadata.
/// @dev Bond `deadline` is removed; the lifecycle is event-driven (closed/withdrawn/settled).
contract SimpleBondV6 {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ACCEPTANCE_DELAY = 365 days;
    uint256 public constant MAX_RULING_BUFFER = 365 days;

    enum ChallengeStatus {
        Pending,
        Won,
        Lost,
        Conceded,
        RejectedByJudge,
        Refunded
    }

    struct Bond {
        address poster;
        address judge;
        address token;
        uint256 bondAmount;
        uint256 challengeAmount;
        uint256 judgeFee;
        uint256 acceptanceDelay;
        uint256 rulingBuffer;
        uint256 maxChallenges;
        bytes32 claimHash;
        uint256 claimVersion;
        uint256 judgeProfileId;
        uint256 pendingCount;
        bool settled;
        bool closed;
    }

    struct Challenge {
        address challenger;
        ChallengeStatus status;
        uint256 timestamp;
        uint256 challengeAtVersion;
        bytes32 claimHashAtChallenge;
        bytes32 metadataHash;
        bytes32 rulingMetadataHash;
    }

    uint256 public nextBondId;
    mapping(uint256 => Bond) public bonds;
    mapping(uint256 => Challenge[]) public challenges;

    event BondCreated(
        uint256 indexed bondId,
        address indexed poster,
        address indexed judge,
        uint256 judgeProfileId,
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        uint256 acceptanceDelay,
        uint256 rulingBuffer,
        uint256 maxChallenges,
        bytes32 claimHash,
        string claimContent
    );

    event ClaimModified(
        uint256 indexed bondId,
        uint256 oldVersion,
        uint256 newVersion,
        bytes32 oldHash,
        bytes32 newHash,
        string newContent
    );

    event Challenged(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        uint256 expectedVersion,
        bytes32 claimHashAtChallenge,
        bytes32 metadataHash,
        string content
    );

    event ClaimConceded(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed poster,
        bytes32 contentHash,
        string content
    );

    event RuledForPoster(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        uint256 feeCharged,
        bytes32 contentHash,
        string content
    );

    event RuledForChallenger(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        uint256 feeCharged,
        bytes32 contentHash,
        string content
    );

    event ChallengeRejected(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger,
        bytes32 contentHash,
        string content
    );

    event BondRejectedByJudge(
        uint256 indexed bondId,
        address indexed judge,
        bytes32 contentHash,
        string content
    );

    event BondClosed(uint256 indexed bondId);
    event BondOpened(uint256 indexed bondId);
    event BondWithdrawn(uint256 indexed bondId);
    event BondTimedOut(uint256 indexed bondId, uint256 challengeIndex);
    event ChallengeRefunded(
        uint256 indexed bondId,
        uint256 challengeIndex,
        address indexed challenger
    );

    /// @notice Create a new v0.6 bond, escrow the poster's bondAmount, and emit BondCreated.
    /// @dev `judgeProfileId` is stored at creation but not yet validated against a registry.
    ///      Registry wiring is added in a follow-up task. Callers may pass 0 in unit tests.
    function createBond(
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        address judge,
        uint256 acceptanceDelay,
        uint256 rulingBuffer,
        uint256 maxChallenges,
        uint256 judgeProfileId,
        string calldata claimContent
    ) external returns (uint256 bondId) {
        require(bondAmount > 0, "Zero bond amount");
        require(challengeAmount > 0, "Zero challenge amount");
        require(judge != address(0), "Zero judge");
        require(judge.code.length > 0, "Judge must be contract");
        require(judgeFee <= challengeAmount, "Fee > challenge amount");
        require(maxChallenges > 0, "Zero maxChallenges");
        require(acceptanceDelay <= MAX_ACCEPTANCE_DELAY, "Acceptance delay too long");
        require(rulingBuffer > 0, "Zero ruling buffer");
        require(rulingBuffer <= MAX_RULING_BUFFER, "Ruling buffer too long");

        IBondJudgeV6(judge).validateBond(
            token,
            bondAmount,
            challengeAmount,
            judgeFee,
            acceptanceDelay,
            rulingBuffer,
            maxChallenges
        );

        bondId = nextBondId++;

        bytes32 claimHash = keccak256(bytes(claimContent));

        bonds[bondId] = Bond({
            poster: msg.sender,
            judge: judge,
            token: token,
            bondAmount: bondAmount,
            challengeAmount: challengeAmount,
            judgeFee: judgeFee,
            acceptanceDelay: acceptanceDelay,
            rulingBuffer: rulingBuffer,
            maxChallenges: maxChallenges,
            claimHash: claimHash,
            claimVersion: 1,
            judgeProfileId: judgeProfileId,
            pendingCount: 0,
            settled: false,
            closed: false
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), bondAmount);

        emit BondCreated(
            bondId,
            msg.sender,
            judge,
            judgeProfileId,
            token,
            bondAmount,
            challengeAmount,
            judgeFee,
            acceptanceDelay,
            rulingBuffer,
            maxChallenges,
            claimHash,
            claimContent
        );
    }

    function getChallengeCount(uint256 bondId) external view returns (uint256) {
        return challenges[bondId].length;
    }

    function getChallenge(uint256 bondId, uint256 index) external view returns (Challenge memory) {
        return challenges[bondId][index];
    }

    function concessionDeadline(uint256 bondId, uint256 i) public view returns (uint256) {
        return challenges[bondId][i].timestamp + bonds[bondId].acceptanceDelay;
    }

    function rulingWindowStart(uint256 bondId, uint256 i) public view returns (uint256) {
        return challenges[bondId][i].timestamp + bonds[bondId].acceptanceDelay;
    }

    function rulingDeadline(uint256 bondId, uint256 i) public view returns (uint256) {
        return rulingWindowStart(bondId, i) + bonds[bondId].rulingBuffer;
    }

    /// @notice File a new challenge against the current claim version.
    /// @param expectedVersion Caller's pin to the claim version they intend to challenge; reverts on mismatch.
    function challenge(
        uint256 bondId,
        uint256 expectedVersion,
        string calldata content
    ) external returns (uint256 challengeIndex) {
        Bond storage b = bonds[bondId];
        require(b.poster != address(0), "Unknown bond");
        require(!b.settled, "Bond settled");
        require(!b.closed, "Bond closed");
        require(b.claimVersion == expectedVersion, "Stale claim version");
        require(challenges[bondId].length < b.maxChallenges, "Max challenges reached");

        bytes32 metadataHash = keccak256(bytes(content));

        challengeIndex = challenges[bondId].length;
        challenges[bondId].push(
            Challenge({
                challenger: msg.sender,
                status: ChallengeStatus.Pending,
                timestamp: block.timestamp,
                challengeAtVersion: expectedVersion,
                claimHashAtChallenge: b.claimHash,
                metadataHash: metadataHash,
                rulingMetadataHash: bytes32(0)
            })
        );
        b.pendingCount += 1;

        IERC20(b.token).safeTransferFrom(msg.sender, address(this), b.challengeAmount);

        emit Challenged(
            bondId,
            challengeIndex,
            msg.sender,
            expectedVersion,
            b.claimHash,
            metadataHash,
            content
        );
    }

    /// @notice Judge contract: rule for the poster on challenge `i`. Bond continues.
    function ruleForPoster(
        uint256 bondId,
        uint256 i,
        uint256 feeCharged,
        string calldata content
    ) external {
        Bond storage b = bonds[bondId];
        require(msg.sender == b.judge, "Only judge");
        require(!b.settled, "Bond settled");
        Challenge storage c = challenges[bondId][i];
        require(c.status == ChallengeStatus.Pending, "Not pending");
        require(block.timestamp >= rulingWindowStart(bondId, i), "Ruling window not open");
        require(block.timestamp <= rulingDeadline(bondId, i), "Ruling window closed");
        require(feeCharged <= b.judgeFee, "Fee > judgeFee");

        bytes32 contentHash = keccak256(bytes(content));
        c.status = ChallengeStatus.Lost;
        c.rulingMetadataHash = contentHash;
        b.pendingCount -= 1;

        if (feeCharged > 0) {
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }
        uint256 toPoster = b.challengeAmount - feeCharged;
        if (toPoster > 0) {
            IERC20(b.token).safeTransfer(b.poster, toPoster);
        }

        emit RuledForPoster(bondId, i, c.challenger, feeCharged, contentHash, content);
    }

    /// @notice Poster concedes a specific challenge. Money-neutral for the poster.
    /// @dev Refunds challenger immediately, marks status Conceded, decrements pendingCount.
    function concede(uint256 bondId, uint256 i, string calldata content) external {
        Bond storage b = bonds[bondId];
        require(b.poster == msg.sender, "Not poster");
        require(!b.settled, "Bond settled");
        Challenge storage c = challenges[bondId][i];
        require(c.status == ChallengeStatus.Pending, "Not pending");
        require(block.timestamp <= concessionDeadline(bondId, i), "Concession window closed");

        bytes32 contentHash = keccak256(bytes(content));
        c.status = ChallengeStatus.Conceded;
        c.rulingMetadataHash = contentHash;
        b.pendingCount -= 1;

        IERC20(b.token).safeTransfer(c.challenger, b.challengeAmount);

        emit ClaimConceded(bondId, i, msg.sender, contentHash, content);
    }

    /// @notice Replace the bond's claim text. Allowed only when no challenges are pending.
    /// @dev Bumps `claimVersion`. Future challenges must pin to the new version.
    function modifyClaim(uint256 bondId, string calldata newContent) external {
        Bond storage b = bonds[bondId];
        require(b.poster == msg.sender, "Not poster");
        require(!b.settled, "Bond settled");
        require(b.pendingCount == 0, "Pending challenges");

        bytes32 oldHash = b.claimHash;
        uint256 oldVersion = b.claimVersion;
        bytes32 newHash = keccak256(bytes(newContent));

        b.claimHash = newHash;
        b.claimVersion = oldVersion + 1;

        emit ClaimModified(bondId, oldVersion, oldVersion + 1, oldHash, newHash, newContent);
    }
}
