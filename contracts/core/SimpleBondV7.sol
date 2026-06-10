// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../interfaces/IBondJudgeV6.sol";
import "../profiles/JudgeProfileRegistryV6.sol";

/// @notice Minimal view surface of `OfficialBondDirectory` consumed by the core's token gate
///         (audit V7-1). Kept as a local interface so the core depends only on `hasToken`.
interface IOfficialTokenList {
    function hasToken(address token) external view returns (bool);
}

/// @title SimpleBondV7
/// @notice v0.7 bond core. Same surface as v0.6 (versioned claims, per-challenge concession,
///         per-challenge timing, judge out-of-scope refunds, close/open toggle, maxChallenges,
///         hash+event metadata) plus C1: a pending-cap `maxChallenges` (gates the LIVE set, not
///         lifetime filings) and a hard `MAX_CHALLENGES_CEILING`; and C2: a per-address
///         pull-payment credit ledger (`credits[recipient][token]` + `claim(token)`) that
///         replaces the v0.6 `claimRefunds` drain. All outbound value to UNTRUSTED recipients
///         is credited (effects-only, no external call), then pulled via `claim()` under strict
///         CEI + OZ `nonReentrant`. The judge fee stays an inline push (judge is a vetted
///         contract; `ManualJudgeV6.withdrawFees` is a push model). V7 is honestly mixed
///         inline + pull.
/// @dev Bond `deadline` is removed; the lifecycle is event-driven (closed/withdrawn/settled).
///      v0.6 stays deployed until an explicit cutover; this is a NEW contract.
///      Token assumption: standard ERC-20, NO fee-on-transfer / NO rebasing (the credit model
///      makes fee-on-transfer dangerous — a shortfall would surface later against a different
///      claimant). Token gating is enforced ON-CHAIN (audit V7-1): `createBond` requires
///      `officialDirectory.hasToken(token)`, so only directory-curated tokens can back bonds.
contract SimpleBondV7 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ACCEPTANCE_DELAY = 365 days;
    uint256 public constant MAX_RULING_BUFFER = 365 days;
    /// @notice Audit V7-2 (v6-M6): on-chain floor for the ruling window. Without it a poster
    ///         could set a ~1s `rulingBuffer`, leaving no block in which the judge can rule, so
    ///         `claimTimeout` would mechanically settle every challenge in the poster's favor.
    uint256 public constant MIN_RULING_BUFFER = 1 hours;
    uint256 public constant MAX_CHALLENGES_CEILING = 100;

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

    JudgeProfileRegistryV6 public immutable judgeProfileRegistry;

    /// @notice Audit V7-1: on-chain token whitelist. `createBond` only accepts tokens curated in
    ///         the official directory, making the "whitelisted tokens" launch property a contract
    ///         invariant instead of a UI convention. Membership is checked at CREATION only —
    ///         challenge/payout paths never re-check, so de-listing a token cannot strand or
    ///         alter existing bonds (it only blocks new ones).
    IOfficialTokenList public immutable officialDirectory;

    uint256 public nextBondId;
    mapping(uint256 => Bond) public bonds;
    mapping(uint256 => Challenge[]) public challenges;

    /// @notice C2 settle-loop guard. The LIVE set of currently-Pending challenge indices for a
    ///         bond. `challenges[]` is append-only and CUMULATIVE (C1: spam-then-reject-then-refile
    ///         grows it unbounded with O(1) recycled capital), so every settle/pending-scan MUST
    ///         iterate THIS set — bounded by `pendingCount <= maxChallenges <= MAX_CHALLENGES_CEILING`
    ///         — and NEVER `challenges[bondId].length`. Otherwise a bond with a long history
    ///         (~8.7k+ entries) can never settle (gas-bomb DoS) and all genuinely-pending stakes +
    ///         the poster bond are stranded forever.
    mapping(uint256 => uint256[]) private pendingIds;
    /// @notice 1-based position of a challenge index within `pendingIds[bondId]` (0 == not pending).
    ///         Enables O(1) swap-and-pop removal on single resolutions without scanning.
    mapping(uint256 => mapping(uint256 => uint256)) private pendingPos;

    /// @notice C2 pull-payment ledger. `credits[recipient][token]` is the amount `recipient`
    ///         may `claim(token)`. Keyed [recipient][token] (NOT flat) so cross-token accounting
    ///         is exact — the directory may approve multiple tokens.
    mapping(address => mapping(address => uint256)) public credits;

    constructor(address judgeProfileRegistry_, address officialDirectory_) {
        require(judgeProfileRegistry_ != address(0), "Zero registry");
        require(officialDirectory_ != address(0), "Zero directory");
        judgeProfileRegistry = JudgeProfileRegistryV6(judgeProfileRegistry_);
        officialDirectory = IOfficialTokenList(officialDirectory_);
    }

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

    /// @notice C2: value accrued to `recipient`'s `credits[recipient][token]` ledger, claimable
    ///         via `claim(token)`. Carries bondId+challengeIndex so per-bond attribution survives
    ///         in logs even though the stored balance is a per-token aggregate.
    event Credited(
        address indexed token,
        address indexed recipient,
        uint256 indexed bondId,
        uint256 challengeIndex,
        uint256 amount
    );

    /// @notice C2: `recipient` pulled their full `credits[recipient][token]` balance.
    event Claimed(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Create a new v0.7 bond, escrow the poster's bondAmount, and emit BondCreated.
    /// @dev `token` must be curated in the official directory (audit V7-1 on-chain whitelist).
    ///      `judgeProfileId` must resolve in `judgeProfileRegistry` to a profile whose judge
    ///      equals `judge`; the judge contract additionally screens the bond economics via
    ///      `validateBond`. `rulingBuffer` has an on-chain floor (`MIN_RULING_BUFFER`, audit
    ///      V7-2) so a poster cannot configure a ruling window too short for any judge to act.
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
        require(maxChallenges <= MAX_CHALLENGES_CEILING, "maxChallenges too large");
        require(acceptanceDelay <= MAX_ACCEPTANCE_DELAY, "Acceptance delay too long");
        require(rulingBuffer >= MIN_RULING_BUFFER, "Ruling buffer too short");
        require(rulingBuffer <= MAX_RULING_BUFFER, "Ruling buffer too long");
        // V7-1: on-chain token whitelist (see `officialDirectory` natspec).
        require(officialDirectory.hasToken(token), "Token not approved");

        (, address profileJudge, , ) = judgeProfileRegistry.getProfile(judgeProfileId);
        require(profileJudge == judge, "Profile judge mismatch");

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

    /// @notice C2 internal effects-only credit. Accumulates `amount` into the recipient's
    ///         per-token ledger and emits `Credited`. NO external call — credit sites need no
    ///         reentrancy guard. Zero-amount credits are skipped (no-op, no event).
    function _credit(address token, address to, uint256 amount, uint256 bondId, uint256 i) internal {
        if (amount > 0) {
            credits[to][token] += amount;
            emit Credited(token, to, bondId, i, amount);
        }
    }

    /// @notice Track a freshly-filed challenge in the LIVE pending set.
    /// @dev Mirrors the append-only `challenges[]` push, but the set is the ONLY structure the
    ///      settle loops scan. `pendingPos` stores a 1-based index for O(1) removal.
    function _addPending(uint256 bondId, uint256 challengeIndex) internal {
        pendingIds[bondId].push(challengeIndex);
        pendingPos[bondId][challengeIndex] = pendingIds[bondId].length; // 1-based
    }

    /// @notice Remove a single challenge index from the LIVE pending set via swap-and-pop.
    /// @dev O(1), no scan of `challenges[]`. The swapped-in element's position is rewritten so no
    ///      pending index is ever skipped or double-processed. Caller flips status terminal +
    ///      decrements `pendingCount` (this only maintains the set). No-op if not present.
    function _removePending(uint256 bondId, uint256 challengeIndex) internal {
        uint256 pos = pendingPos[bondId][challengeIndex]; // 1-based
        if (pos == 0) return; // not in the live set
        uint256[] storage ids = pendingIds[bondId];
        uint256 lastIdx = ids.length - 1;
        uint256 i = pos - 1;
        if (i != lastIdx) {
            uint256 moved = ids[lastIdx];
            ids[i] = moved;
            pendingPos[bondId][moved] = i + 1; // keep 1-based position of the swapped-in element
        }
        ids.pop();
        pendingPos[bondId][challengeIndex] = 0;
    }

    /// @notice C2 settlement sweep: credit every still-Pending challenger their `challengeAmount`
    ///         stake back, flip them to a terminal status, and zero out `pendingCount`.
    ///         Effects-only (no external call inside the loop) and bounded by `pendingCount`
    ///         (<= maxChallenges <= MAX_CHALLENGES_CEILING) by iterating the LIVE pending set —
    ///         NEVER `challenges[bondId].length` (which C1 makes cumulative/unbounded). So the
    ///         settle path is provably gas-bounded regardless of lifetime filings. Replaces the
    ///         v0.6 `claimRefunds` drain: nobody is left stranded, but they must `claim()`.
    /// @dev Caller MUST have already flipped the winning/triggering challenge (if any) to terminal
    ///      AND removed it from the pending set BEFORE calling, so the loop never re-credits it
    ///      (no double-credit). Caller sets `b.settled`. Swept challengers are ALWAYS marked
    ///      `Refunded` (audit V7-3, owner decision 2026-06-09): their stake comes back in full,
    ///      and `Lost` is reserved for a challenge the judge actually ruled against (stake lost)
    ///      — so the status is money-unambiguous, matching v0.6 semantics. After the sweep the
    ///      pending set is fully cleared.
    function _creditPendingLosers(Bond storage b, uint256 bondId) internal {
        uint256[] storage ids = pendingIds[bondId];
        uint256 n = ids.length; // == b.pendingCount, bounded by the C1 ceiling
        for (uint256 k = 0; k < n; k++) {
            uint256 j = ids[k];
            Challenge storage cj = challenges[bondId][j];
            // Defensive: the live set should only ever hold Pending entries, but flip-before-credit
            // is the no-double-credit invariant, so we skip anything already terminal.
            if (cj.status == ChallengeStatus.Pending) {
                cj.status = ChallengeStatus.Refunded;
                pendingPos[bondId][j] = 0;
                _credit(b.token, cj.challenger, b.challengeAmount, bondId, j);
            }
        }
        // Clear the whole live set in one shot and zero pendingCount (no per-index pop needed:
        // every index above was just made terminal, so the set is fully consumed).
        delete pendingIds[bondId];
        b.pendingCount = 0;
    }

    /// @notice C2 pull payment. Claim the caller's full credited balance for `token`.
    /// @dev Strict CEI: read, require > 0, ZERO the ledger BEFORE the transfer, emit, then
    ///      `safeTransfer`. `nonReentrant` is belt-and-suspenders on a value contract.
    function claim(address token) external nonReentrant returns (uint256 amount) {
        amount = credits[msg.sender][token];
        require(amount > 0, "Nothing to claim");
        credits[msg.sender][token] = 0;
        emit Claimed(token, msg.sender, amount);
        IERC20(token).safeTransfer(msg.sender, amount);
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
        // C1: gate on the LIVE (pending) set, not lifetime filings. challenges[] stays
        // append-only (challengeIndex below = challenges[bondId].length) so per-index
        // indexer/event snapshots are unchanged; only the CAP semantics change.
        // Pre-increment read => pendingCount <= maxChallenges always holds (the +1 below
        // is blocked once equal). Fixes the v0.6 spam-then-reject permanent lockout.
        require(b.pendingCount < b.maxChallenges, "Max pending challenges reached");

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
        // C1/C2: track in the LIVE pending set in addition to the append-only challenges[] push.
        // Settle loops scan THIS set (bounded), not challenges[].length (cumulative/unbounded).
        _addPending(bondId, challengeIndex);
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
        // V7-5 (v6-L5): strictly AFTER the window start — the concession window owns its final
        // second (`concede` allows <=), so concede/rule can never both be valid in one block.
        require(block.timestamp > rulingWindowStart(bondId, i), "Ruling window not open");
        require(block.timestamp <= rulingDeadline(bondId, i), "Ruling window closed");
        require(feeCharged <= b.judgeFee, "Fee > judgeFee");

        bytes32 contentHash = keccak256(bytes(content));
        c.status = ChallengeStatus.Lost;
        c.rulingMetadataHash = contentHash;
        _removePending(bondId, i);
        b.pendingCount -= 1;

        // Judge fee STAYS an inline push (judge is a vetted contract; ManualJudgeV6.withdrawFees
        // is a push model — crediting it would strand fees).
        if (feeCharged > 0) {
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }
        // Poster share is credited (poster is untrusted outbound).
        uint256 toPoster = b.challengeAmount - feeCharged;
        _credit(b.token, b.poster, toPoster, bondId, i);

        emit RuledForPoster(bondId, i, c.challenger, feeCharged, contentHash, content);
    }

    /// @notice Judge contract: rule for the challenger on challenge `i`. Settles the bond.
    function ruleForChallenger(
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
        // V7-5 (v6-L5): strictly AFTER the window start (see ruleForPoster).
        require(block.timestamp > rulingWindowStart(bondId, i), "Ruling window not open");
        require(block.timestamp <= rulingDeadline(bondId, i), "Ruling window closed");
        require(feeCharged <= b.judgeFee, "Fee > judgeFee");

        bytes32 contentHash = keccak256(bytes(content));
        c.status = ChallengeStatus.Won;
        c.rulingMetadataHash = contentHash;
        // Remove the winner from the LIVE pending set BEFORE the loser sweep so it is never
        // re-credited (no double-credit). The sweep then clears the rest of the set.
        _removePending(bondId, i);
        b.pendingCount -= 1;
        b.settled = true;

        // Judge fee STAYS an inline push (vetted contract).
        if (feeCharged > 0) {
            IERC20(b.token).safeTransfer(b.judge, feeCharged);
        }
        // Winner gets the bond + their own stake back, minus the fee. Credited (untrusted).
        _credit(b.token, c.challenger, b.bondAmount + b.challengeAmount - feeCharged, bondId, i);

        // Settlement: every OTHER still-pending challenger is swept `Refunded` with their stake
        // back (audit V7-3) — exactly v0.6's claimRefunds semantics, where `Lost` unambiguously
        // means the judge ruled against you AND your stake is gone. Effects-only loop, bounded
        // by MAX_CHALLENGES_CEILING (no external call inside).
        _creditPendingLosers(b, bondId);

        emit RuledForChallenger(bondId, i, c.challenger, feeCharged, contentHash, content);
    }

    /// @notice Judge contract: mark a single challenge out-of-scope and refund it. Bond continues.
    function rejectChallenge(uint256 bondId, uint256 i, string calldata content) external {
        Bond storage b = bonds[bondId];
        require(msg.sender == b.judge, "Only judge");
        require(!b.settled, "Bond settled");
        Challenge storage c = challenges[bondId][i];
        require(c.status == ChallengeStatus.Pending, "Not pending");

        bytes32 contentHash = keccak256(bytes(content));
        c.status = ChallengeStatus.RejectedByJudge;
        c.rulingMetadataHash = contentHash;
        _removePending(bondId, i);
        b.pendingCount -= 1;

        // Refund the out-of-scope challenger via the credit ledger (untrusted outbound).
        _credit(b.token, c.challenger, b.challengeAmount, bondId, i);

        emit ChallengeRejected(bondId, i, c.challenger, contentHash, content);
    }

    /// @notice Judge contract: void the entire bond. Poster credited their bond; all still-pending
    ///         challengers credited their stake back in a bounded settle loop (no funds stranded).
    function rejectBond(uint256 bondId, string calldata content) external {
        Bond storage b = bonds[bondId];
        require(msg.sender == b.judge, "Only judge");
        require(!b.settled, "Bond settled");

        bytes32 contentHash = keccak256(bytes(content));
        b.settled = true;

        // Poster gets their bond back (credited; untrusted outbound).
        _credit(b.token, b.poster, b.bondAmount, bondId, 0);
        // Refund every still-pending challenger their stake (replaces the v0.6 claimRefunds path).
        _creditPendingLosers(b, bondId);

        emit BondRejectedByJudge(bondId, msg.sender, contentHash, content);
    }

    /// @notice Poster closes the bond, blocking new challenges. Pending challenges continue.
    function closeBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.poster == msg.sender, "Not poster");
        require(!b.settled, "Bond settled");
        require(!b.closed, "Already closed");
        b.closed = true;
        emit BondClosed(bondId);
    }

    /// @notice Poster re-opens a closed bond.
    function openBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.poster == msg.sender, "Not poster");
        require(!b.settled, "Bond settled");
        require(b.closed, "Already open");
        b.closed = false;
        emit BondOpened(bondId);
    }

    /// @notice Poster withdraws bondAmount when closed and no pending challenges remain.
    function withdrawBond(uint256 bondId) external {
        Bond storage b = bonds[bondId];
        require(b.poster == msg.sender, "Not poster");
        require(!b.settled, "Bond settled");
        require(b.closed, "Must close first");
        require(b.pendingCount == 0, "Pending challenges");
        b.settled = true;
        // Poster's bond is credited (untrusted outbound); claimed via claim(token).
        _credit(b.token, b.poster, b.bondAmount, bondId, 0);
        emit BondWithdrawn(bondId);
    }

    /// @notice Any caller: time out a pending challenge whose ruling deadline has passed.
    /// @dev Settles the bond, credits the poster their bond, and credits every still-pending
    ///      challenger (including `i`) their stake back in a bounded settle loop — preserving
    ///      v0.6 timeout liveness with no funds stranded.
    function claimTimeout(uint256 bondId, uint256 i) external {
        Bond storage b = bonds[bondId];
        require(!b.settled, "Bond settled");
        Challenge storage c = challenges[bondId][i];
        require(c.status == ChallengeStatus.Pending, "Not pending");
        require(block.timestamp > rulingDeadline(bondId, i), "Ruling window still open");

        b.settled = true;

        // Poster gets their bond back (credited; untrusted outbound).
        _credit(b.token, b.poster, b.bondAmount, bondId, i);
        // Refund every still-pending challenger their stake (replaces the v0.6 claimRefunds path).
        // `i` is still Pending, so it is swept here too.
        _creditPendingLosers(b, bondId);

        emit BondTimedOut(bondId, i);
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
        _removePending(bondId, i);
        b.pendingCount -= 1;

        // Refund the conceded challenger via the credit ledger (untrusted outbound). The conceded
        // challenger now shows a claimable credit instead of an automatic push (v0.7 UX trade).
        _credit(b.token, c.challenger, b.challengeAmount, bondId, i);

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
