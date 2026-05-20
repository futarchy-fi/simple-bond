// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IBondJudgeV6.sol";

/// @title TestForwardingJudgeV6
/// @notice Accepts every bond and forwards arbitrary external calls.
///         Tests use `forward(target, data)` to invoke judge-only methods on the bond.
contract TestForwardingJudgeV6 is IBondJudgeV6 {
    function validateBond(
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256
    ) external pure {}

    function forward(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        require(ok, "judge forward failed");
        return ret;
    }
}
