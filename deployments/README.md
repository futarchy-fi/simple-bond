# Deployments

Records of v0.6 deployments. Populated by `scripts/v6/deployAll.js` (one
file per network), committed to the repo so the frontend / backend can
auto-load addresses without re-deriving them.

Files:

- `sepolia.json` — Sepolia (chain id 11155111). Created in Phase 5.
- `mainnet.json` — Ethereum mainnet (chain id 1). Created in Phase 9.

Each file structure:

```json
{
  "chainId": 11155111,
  "deployer": "0x...",
  "deployBlock": 0,
  "contracts": {
    "simpleBondV6": "0x...",
    "judgeProfileRegistry": "0x...",
    "posterProfileRegistry": "0x...",
    "challengerProfileRegistry": "0x...",
    "manualJudgeV6": "0x...",
    "officialBondDirectory": "0x..."
  },
  "approvedToken": "0x...",
  "manualJudgeOperator": "0x..."
}
```

These files are the source of truth for the frontend `runtime-config.js`
and backend `config.mjs` overrides.
