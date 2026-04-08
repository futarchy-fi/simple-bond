// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mintable ERC-20 for testing only.
contract TestToken is ERC20 {
    constructor() ERC20("TestUSD", "TUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
