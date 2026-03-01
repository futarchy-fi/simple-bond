// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IArbitrator
 * @notice ERC-792 Arbitrator interface (Kleros standard).
 *         https://developer.kleros.io/en/latest/smart-contracts.html
 */
interface IArbitrator {
    /**
     * @notice Create a dispute. Must be called with `msg.value >= arbitrationCost(extraData)`.
     * @param _choices Number of ruling options (excluding 0 = refused).
     * @param _extraData Encodes subcourt ID and minimum number of jurors.
     * @return disputeID The ID of the created dispute.
     */
    function createDispute(
        uint256 _choices,
        bytes calldata _extraData
    ) external payable returns (uint256 disputeID);

    /**
     * @notice Returns the cost of arbitration for a given extra data.
     * @param _extraData Encodes subcourt ID and minimum number of jurors.
     * @return cost The arbitration cost in wei.
     */
    function arbitrationCost(
        bytes calldata _extraData
    ) external view returns (uint256 cost);
}

/**
 * @title IArbitrable
 * @notice ERC-792 Arbitrable interface. Contracts that can be arbitrated implement this.
 */
interface IArbitrable {
    /**
     * @notice Called by the arbitrator to give a ruling.
     * @param _disputeID The dispute being ruled on.
     * @param _ruling The ruling (0 = refused, 1..choices = valid ruling).
     */
    function rule(uint256 _disputeID, uint256 _ruling) external;
}

/**
 * @title IEvidence
 * @notice ERC-1497 Evidence Standard. Allows submitting evidence and meta-evidence.
 */
interface IEvidence {
    event MetaEvidence(uint256 indexed _metaEvidenceID, string _evidence);
    event Evidence(
        IArbitrator indexed _arbitrator,
        uint256 indexed _evidenceGroupID,
        address indexed _party,
        string _evidence
    );
    event Dispute(
        IArbitrator indexed _arbitrator,
        uint256 indexed _disputeID,
        uint256 _metaEvidenceID,
        uint256 _evidenceGroupID
    );
}
