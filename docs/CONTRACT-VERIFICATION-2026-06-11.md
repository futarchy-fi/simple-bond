# Contract source verification — 2026-06-11

Verification is done **keyless via Sourcify** (no Etherscan account needed;
Etherscan imports and displays Sourcify-verified sources). Enabled in
`hardhat.config.js` (`sourcify.enabled = true`); the Etherscan path stays
available but only activates when `ETHERSCAN_API_KEY` is set.

Re-verify: `npx hardhat verify --network <net> <address> <constructor args…>`

## Verified ✅
| Contract | Chain | Address | Result |
|----------|-------|---------|--------|
| SimpleBondV7 | Ethereum (1) | `0x2e23a85285Bb191Be2bf7b74a8c180E25CA71759` | Sourcify **full_match** |
| SimpleBondV7 | Sepolia (11155111) | `0xA2aAD4DeAddc984ea359C5151683EA55eA824276` | Sourcify **full_match** |

Constructor args used: `(judgeProfileRegistry, officialDirectory)` — mainnet
`(0x8fee82…, 0xAB3f30…)`, sepolia `(0x5C1828…, 0xe93B0E…)`.

## NOT verified — needs the original May build env (handoff)
**SimpleBondV6 mainnet `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`** — unverified
on Etherscan and Sourcify. It will NOT verify from the current `main`: the
on-chain runtime bytecode diverges from the source compiled at the deploy commit
`f02ef76` at hex offset **3078** — a *real code difference* (same length, same
solc 0.8.24, same optimizer/viaIR, same OZ 5.6.1 per the lockfile), so it is not
a metadata/compiler/library mismatch. The contract was deployed (2026-05-21,
block 25139967) from a source state that is not the merged `main` history —
almost certainly a last-minute pre-merge edit to `SimpleBondV6.sol` that never
landed on `main`.

To verify v6, one of:
1. Recover the exact deployed `SimpleBondV6.sol` (original deploy artifact /
   pre-merge branch / the deployer's working tree), drop it in, `hardhat verify`.
2. Reconstruct it by diffing the deployed bytecode region around offset 3078
   against the f02ef76 build to find the single differing construct.

This is the team's original mainnet deploy — immutable and running correctly;
verification is a transparency nicety, not a functional gap.
