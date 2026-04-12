// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mintable ERC-20 for testing only.
contract TestToken is ERC20 {
    /// @notice Deploy the test token with a fixed name and symbol.
    constructor() ERC20("TestUSD", "TUSD") {}

    /// @notice Mint tokens to an arbitrary address for tests.
    /// @param to Recipient address.
    /// @param amount Amount of tokens to mint.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
