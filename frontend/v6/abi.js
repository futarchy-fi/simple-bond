// SimpleBondV6 ABI for the frontend. Mirrors backend/config.mjs V6_CONTRACT_ABI
// plus the write methods the UI needs to call.
window.SIMPLE_BOND_V6_ABI = [
    // Events
    "event BondCreated(uint256 indexed bondId, address indexed poster, address indexed judge, uint256 judgeProfileId, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, string claimContent)",
    "event ClaimModified(uint256 indexed bondId, uint256 oldVersion, uint256 newVersion, bytes32 oldHash, bytes32 newHash, string newContent)",
    "event Challenged(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 expectedVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, string content)",
    "event ClaimConceded(uint256 indexed bondId, uint256 challengeIndex, address indexed poster, bytes32 contentHash, string content)",
    "event RuledForPoster(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged, bytes32 contentHash, string content)",
    "event RuledForChallenger(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged, bytes32 contentHash, string content)",
    "event ChallengeRejected(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, bytes32 contentHash, string content)",
    "event BondRejectedByJudge(uint256 indexed bondId, address indexed judge, bytes32 contentHash, string content)",
    "event BondClosed(uint256 indexed bondId)",
    "event BondOpened(uint256 indexed bondId)",
    "event BondWithdrawn(uint256 indexed bondId)",
    "event BondTimedOut(uint256 indexed bondId, uint256 challengeIndex)",
    "event ChallengeRefunded(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger)",

    // Reads
    "function nextBondId() view returns (uint256)",
    "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
    "function getChallengeCount(uint256 bondId) view returns (uint256)",
    "function getChallenge(uint256 bondId, uint256 index) view returns (tuple(address challenger, uint8 status, uint256 timestamp, uint256 challengeAtVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, bytes32 rulingMetadataHash))",
    "function concessionDeadline(uint256 bondId, uint256 i) view returns (uint256)",
    "function rulingWindowStart(uint256 bondId, uint256 i) view returns (uint256)",
    "function rulingDeadline(uint256 bondId, uint256 i) view returns (uint256)",
    "function refundCursor(uint256) view returns (uint256)",
    "function judgeProfileRegistry() view returns (address)",

    // Writes
    "function createBond(address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, address judge, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, uint256 judgeProfileId, string calldata claimContent) external returns (uint256)",
    "function modifyClaim(uint256 bondId, string calldata newContent) external",
    "function challenge(uint256 bondId, uint256 expectedVersion, string calldata content) external returns (uint256)",
    "function concede(uint256 bondId, uint256 i, string calldata content) external",
    "function closeBond(uint256 bondId) external",
    "function openBond(uint256 bondId) external",
    "function withdrawBond(uint256 bondId) external",
    "function claimTimeout(uint256 bondId, uint256 i) external",
    "function claimRefunds(uint256 bondId, uint256 maxCount) external",
];

// SimpleBondV7 ABI — same surface as V6 EXCEPT the shared-drain refund path is
// replaced by a per-address pull-payment credit ledger (see SimpleBondV7.sol C2):
//   REMOVED vs V6: claimRefunds(...) write, refundCursor(...) view, and the
//                  ChallengeRefunded event (the v0.6 drain primitives are gone).
//   ADDED   vs V6: credits(address recipient, address token) view, claim(address
//                  token) write, and the Credited / Claimed events.
// Everything else (createBond / challenge / concede / rulings / close-open /
// withdraw / claimTimeout, the bonds/getChallenge views, lifecycle events) is
// byte-for-byte the V6 surface so the version-aware frontend only branches on
// the refund affordance. V7 chains are selected by runtime-config bondVersion:7.
window.SIMPLE_BOND_V7_ABI = [
    // Events
    "event BondCreated(uint256 indexed bondId, address indexed poster, address indexed judge, uint256 judgeProfileId, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, string claimContent)",
    "event ClaimModified(uint256 indexed bondId, uint256 oldVersion, uint256 newVersion, bytes32 oldHash, bytes32 newHash, string newContent)",
    "event Challenged(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 expectedVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, string content)",
    "event ClaimConceded(uint256 indexed bondId, uint256 challengeIndex, address indexed poster, bytes32 contentHash, string content)",
    "event RuledForPoster(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged, bytes32 contentHash, string content)",
    "event RuledForChallenger(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, uint256 feeCharged, bytes32 contentHash, string content)",
    "event ChallengeRejected(uint256 indexed bondId, uint256 challengeIndex, address indexed challenger, bytes32 contentHash, string content)",
    "event BondRejectedByJudge(uint256 indexed bondId, address indexed judge, bytes32 contentHash, string content)",
    "event BondClosed(uint256 indexed bondId)",
    "event BondOpened(uint256 indexed bondId)",
    "event BondWithdrawn(uint256 indexed bondId)",
    "event BondTimedOut(uint256 indexed bondId, uint256 challengeIndex)",
    // C2 pull-payment ledger events (replace V6's ChallengeRefunded).
    "event Credited(address indexed token, address indexed recipient, uint256 indexed bondId, uint256 challengeIndex, uint256 amount)",
    "event Claimed(address indexed token, address indexed recipient, uint256 amount)",

    // Reads
    "function nextBondId() view returns (uint256)",
    "function bonds(uint256) view returns (address poster, address judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, bytes32 claimHash, uint256 claimVersion, uint256 judgeProfileId, uint256 pendingCount, bool settled, bool closed)",
    "function getChallengeCount(uint256 bondId) view returns (uint256)",
    "function getChallenge(uint256 bondId, uint256 index) view returns (tuple(address challenger, uint8 status, uint256 timestamp, uint256 challengeAtVersion, bytes32 claimHashAtChallenge, bytes32 metadataHash, bytes32 rulingMetadataHash))",
    "function concessionDeadline(uint256 bondId, uint256 i) view returns (uint256)",
    "function rulingWindowStart(uint256 bondId, uint256 i) view returns (uint256)",
    "function rulingDeadline(uint256 bondId, uint256 i) view returns (uint256)",
    "function judgeProfileRegistry() view returns (address)",
    // C2 per-address credit ledger (replaces V6's refundCursor view).
    "function credits(address recipient, address token) view returns (uint256)",

    // Writes
    "function createBond(address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, address judge, uint256 acceptanceDelay, uint256 rulingBuffer, uint256 maxChallenges, uint256 judgeProfileId, string calldata claimContent) external returns (uint256)",
    "function modifyClaim(uint256 bondId, string calldata newContent) external",
    "function challenge(uint256 bondId, uint256 expectedVersion, string calldata content) external returns (uint256)",
    "function concede(uint256 bondId, uint256 i, string calldata content) external",
    "function closeBond(uint256 bondId) external",
    "function openBond(uint256 bondId) external",
    "function withdrawBond(uint256 bondId) external",
    "function claimTimeout(uint256 bondId, uint256 i) external",
    // C2 pull payment (replaces V6's claimRefunds drain).
    "function claim(address token) external returns (uint256)",
];

window.SIMPLE_BOND_V6_REGISTRY_ABI = [
    "event ProfileRegistered(uint256 indexed entryId, address indexed owner, bytes32 contentHash, string content)",
    "function registerProfile(string calldata content) external returns (uint256)",
    "function getProfile(uint256 entryId) view returns (address owner, bytes32 contentHash, string memory content)",
    "function entryCount() view returns (uint256)",
];

window.SIMPLE_BOND_V6_JUDGE_REGISTRY_ABI = [
    "event ProfileRegistered(uint256 indexed entryId, address indexed owner, address indexed judgeContract, bytes32 contentHash, string content)",
    "function registerProfile(address judgeContract, string calldata content) external returns (uint256)",
    "function getProfile(uint256 entryId) view returns (address owner, address judgeContract, bytes32 contentHash, string memory content)",
    "function entryCount() view returns (uint256)",
];

window.SIMPLE_BOND_V6_MANUAL_JUDGE_ABI = [
    "event OperatorAccepted(address indexed operator)",
    "function operator() view returns (address)",
    "function active() view returns (bool)",
    "function acceptOperatorRole() external",
    "function withdrawFees(address token, address to, uint256 amount) external",
    "function ruleForPoster(address bondContract, uint256 bondId, uint256 i, uint256 feeCharged, string calldata content) external",
    "function ruleForChallenger(address bondContract, uint256 bondId, uint256 i, uint256 feeCharged, string calldata content) external",
    "function rejectChallenge(address bondContract, uint256 bondId, uint256 i, string calldata content) external",
    "function rejectBond(address bondContract, uint256 bondId, string calldata content) external",
];
