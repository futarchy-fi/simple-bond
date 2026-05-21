// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockSUSDS
/// @notice Test/Sepolia ERC-20 standing in for sUSDS. Open `mint`; no access control.
/// @dev Implements the ERC-4626 read surface the v0.6 frontend uses to convert
///      between USDS amounts and sUSDS shares. The mock is 1:1 (no yield) so
///      tests can reason about amounts in either unit interchangeably.
contract MockSUSDS is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Mock 4626 view: at a 1:1 rate, `assets` worth of underlying mint
    ///         `assets` worth of shares. The real sUSDS rate grows over time.
    function convertToShares(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    /// @notice Mock 4626 view: 1:1 rate.
    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }
}
