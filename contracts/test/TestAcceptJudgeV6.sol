// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IBondJudgeV6.sol";

/// @title TestAcceptJudgeV6
/// @notice Always-accepting judge contract used in v0.6 unit tests.
contract TestAcceptJudgeV6 is IBondJudgeV6 {
    function validateBond(
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256
    ) external pure {}
}
