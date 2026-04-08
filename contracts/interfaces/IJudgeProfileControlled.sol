// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Optional interface for judge contracts that expose who may edit an
/// on-chain public profile on their behalf.
interface IJudgeProfileControlled {
    /// @notice Returns the address authorized to edit the judge's public
    /// profile in a registry.
    function profileController() external view returns (address);
}
