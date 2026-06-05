// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ISimpleBondClaim {
    function claim(address token) external returns (uint256);
}

/// @title MockReentrantToken
/// @notice Malicious ERC-20 that attempts to re-enter `SimpleBondV7.claim()` from inside its own
///         `transfer` (the outbound leg of `claim`). Used to prove the `nonReentrant` guard +
///         strict zero-before-transfer CEI in `claim()` cannot be drained.
/// @dev When armed, the FIRST `transfer` (the legitimate claim payout to the attacker) re-enters
///      `bond.claim(this)`. Because `claim` is `nonReentrant`, the nested call reverts; we catch
///      and record it. The OUTER claim then completes, paying the attacker EXACTLY their credited
///      amount once — no double-spend. (Even without the guard, the zero-before-transfer CEI would
///      make a nested claim find a zero balance and revert with "Nothing to claim".) The test
///      asserts the attacker netted exactly the credited amount and the nested call reverted.
contract MockReentrantToken is ERC20 {
    address public bond;
    bool public armed;
    bool public reentered;
    bool public reentryReverted;

    constructor() ERC20("Reentrant", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Point the attack at a SimpleBondV7 instance and arm the re-entrancy.
    function arm(address bond_) external {
        bond = bond_;
        armed = true;
    }

    function disarm() external {
        armed = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        // Only attempt re-entry on an outbound transfer FROM the bond (the claim payout),
        // and only once, to avoid infinite recursion in the (impossible) success path.
        if (armed && from == bond && !reentered) {
            reentered = true;
            // Re-enter claim(). The guard + CEI must make this revert; we record that it did.
            try ISimpleBondClaim(bond).claim(address(this)) {
                // If this ever succeeds, the guard/CEI failed — leave reentryReverted false so
                // the test's assertion that it reverted fails loudly.
            } catch {
                reentryReverted = true;
            }
        }
    }
}
