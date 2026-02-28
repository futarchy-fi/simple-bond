# SimpleBond

Minimal on-chain bond contract. Post an ERC-20 token as a bond, name a judge and a deadline. The judge can forfeit the bond to a challenger before the deadline. If no ruling by the deadline, the poster withdraws.

Use a yield-bearing token (sDAI, sUSDS, aUSDC) to earn float while the bond is locked.

## How it works

1. **Poster** calls `createBond(token, amount, judge, deadline)` — deposits tokens, names a judge
2. **Judge** can call `forfeit(bondId, recipient)` before the deadline — bond goes to the challenger
3. **Poster** calls `withdraw(bondId)` after the deadline if no ruling — gets bond back

That's it. No admin, no fees, no upgradability.

## Deploy

```bash
cp .env.example .env  # add PRIVATE_KEY and RPC_URL
npx hardhat compile
npx hardhat run scripts/deploy.js --network gnosis
```

## Addresses

| Token | Chain | Address |
|-------|-------|---------|
| sDAI | Gnosis | `0xaf204776c7245bF4147c2612BF6e5972Ee483701` |
| sUSDS | Ethereum | `0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD` |
| WXDAI | Gnosis | `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d` |

## License

MIT
