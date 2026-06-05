// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFeeToken
/// @notice Fee-on-transfer ERC-20: every transfer burns a fixed basis-point fee, so the recipient
///         receives LESS than the sender sent. Standing in for a non-conforming token to document
///         and ENFORCE the v0.7 "no fee-on-transfer / no rebasing" assumption.
/// @dev SimpleBondV7 credits the FULL stated amount on the way in (`createBond`/`challenge` escrow
///      a nominal `bondAmount`/`challengeAmount`) but the contract actually receives less. The
///      credit ledger therefore over-promises: a later `claim()` of the full credited amount
///      eventually outruns the contract's real balance and reverts in `safeTransfer`. The fee-on-
///      transfer test asserts this clean revert (funds are never silently mis-paid to the wrong
///      claimant), proving the token must be excluded by the launch whitelist.
contract MockFeeToken is ERC20 {
    uint256 public feeBps; // fee in basis points taken from every transfer amount

    constructor(uint256 feeBps_) ERC20("FeeToken", "FEE") {
        require(feeBps_ < 10_000, "fee too high");
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Mints/burns (from==0 || to==0) pass through untouched; only real transfers are taxed.
        if (from != address(0) && to != address(0) && feeBps > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            if (fee > 0) {
                super._update(from, address(0), fee); // burn the fee
                value -= fee;
            }
        }
        super._update(from, to, value);
    }
}
