// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IArbitrator.sol";

/**
 * @title MockArbitrator
 * @notice Test mock that simulates Kleros behavior.
 *         Owner can set arbitration cost and deliver rulings on demand.
 */
contract MockArbitrator is IArbitrator {
    uint256 public fixedCost;
    uint256 public nextDisputeID;

    struct MockDispute {
        address arbitrable;
        uint256 choices;
        bool ruled;
    }

    mapping(uint256 => MockDispute) public mockDisputes;

    constructor(uint256 _fixedCost) {
        fixedCost = _fixedCost;
    }

    function createDispute(
        uint256 _choices,
        bytes calldata /* _extraData */
    ) external payable override returns (uint256 disputeID) {
        require(msg.value >= fixedCost, "Insufficient fee");

        disputeID = nextDisputeID++;
        mockDisputes[disputeID] = MockDispute({
            arbitrable: msg.sender,
            choices: _choices,
            ruled: false
        });

        return disputeID;
    }

    function arbitrationCost(
        bytes calldata /* _extraData */
    ) external view override returns (uint256) {
        return fixedCost;
    }

    /**
     * @notice Test helper: deliver a ruling to the arbitrable contract.
     * @param _disputeID The dispute to rule on
     * @param _ruling    The ruling (0 to choices)
     */
    function giveRuling(uint256 _disputeID, uint256 _ruling) external {
        MockDispute storage d = mockDisputes[_disputeID];
        require(d.arbitrable != address(0), "Dispute does not exist");
        require(!d.ruled, "Already ruled");
        require(_ruling <= d.choices, "Invalid ruling");

        d.ruled = true;
        IArbitrable(d.arbitrable).rule(_disputeID, _ruling);
    }

    /**
     * @notice Test helper: update the arbitration cost.
     */
    function setCost(uint256 _cost) external {
        fixedCost = _cost;
    }
}
