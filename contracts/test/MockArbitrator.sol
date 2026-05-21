// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IArbitrator.sol";

/**
 * @title MockArbitrator
 * @notice Test mock that simulates Kleros behavior.
 *         Owner can set arbitration cost and deliver rulings on demand.
 */
contract MockArbitrator is IArbitrator {
    /// @notice Returns the arbitration fee charged for newly created disputes.
    uint256 public fixedCost;
    /// @notice Returns the next mock dispute ID that will be assigned.
    uint256 public nextDisputeID;

    struct MockDispute {
        address arbitrable;
        uint256 choices;
        bool ruled;
    }

    /// @notice Returns the stored mock dispute fields for a dispute ID.
    mapping(uint256 => MockDispute) public mockDisputes;

    /// @notice Initialize the mock arbitrator with a fixed dispute fee.
    /// @param _fixedCost Arbitration cost charged by `createDispute`.
    constructor(uint256 _fixedCost) {
        fixedCost = _fixedCost;
    }

    /// @notice Create a mock dispute and charge the configured arbitration fee.
    /// @param _choices Number of ruling options available for the dispute.
    /// @param _extraData Arbitrator-specific extra data, ignored by this mock.
    /// @return disputeID Newly assigned mock dispute ID.
    function createDispute(
        uint256 _choices,
        bytes calldata _extraData
    ) external payable override returns (uint256 disputeID) {
        _extraData;
        require(msg.value >= fixedCost, "Insufficient fee");

        disputeID = nextDisputeID++;
        mockDisputes[disputeID] = MockDispute({
            arbitrable: msg.sender,
            choices: _choices,
            ruled: false
        });

        return disputeID;
    }

    /// @notice Return the current arbitration fee charged by this mock arbitrator.
    /// @param _extraData Arbitrator-specific extra data, ignored by this mock.
    /// @return cost Arbitration cost in wei.
    function arbitrationCost(
        bytes calldata _extraData
    ) external view override returns (uint256 cost) {
        _extraData;
        return fixedCost;
    }

    /// @notice Deliver a ruling to the arbitrable contract for a mock dispute.
    /// @param _disputeID The dispute to rule on.
    /// @param _ruling The ruling value, from `0` up to `choices`.
    function giveRuling(uint256 _disputeID, uint256 _ruling) external {
        MockDispute storage d = mockDisputes[_disputeID];
        require(d.arbitrable != address(0), "Dispute does not exist");
        require(!d.ruled, "Already ruled");
        require(_ruling <= d.choices, "Invalid ruling");

        d.ruled = true;
        IArbitrable(d.arbitrable).rule(_disputeID, _ruling);
    }

    /// @notice Update the arbitration fee charged for future mock disputes.
    /// @param _cost New arbitration cost in wei.
    function setCost(uint256 _cost) external {
        fixedCost = _cost;
    }
}
