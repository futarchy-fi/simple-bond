// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title JudgeProfileRegistryV6
/// @notice Append-only registry of judge profiles. Each entry pins the judge
///         contract address so a bond can snapshot a specific judge stance at
///         creation by storing only the entryId.
contract JudgeProfileRegistryV6 {
    struct Entry {
        address owner;
        address judgeContract;
        bytes32 contentHash;
        string content;
    }

    Entry[] private entries;

    event ProfileRegistered(
        uint256 indexed entryId,
        address indexed owner,
        address indexed judgeContract,
        bytes32 contentHash,
        string content
    );

    function registerProfile(address judgeContract, string calldata content)
        external
        returns (uint256 entryId)
    {
        require(judgeContract != address(0), "Zero judge");
        bytes32 contentHash = keccak256(bytes(content));
        entryId = entries.length;
        entries.push(
            Entry({
                owner: msg.sender,
                judgeContract: judgeContract,
                contentHash: contentHash,
                content: content
            })
        );
        emit ProfileRegistered(entryId, msg.sender, judgeContract, contentHash, content);
    }

    function getProfile(uint256 entryId)
        external
        view
        returns (
            address owner,
            address judgeContract,
            bytes32 contentHash,
            string memory content
        )
    {
        Entry storage e = entries[entryId];
        return (e.owner, e.judgeContract, e.contentHash, e.content);
    }

    function entryCount() external view returns (uint256) {
        return entries.length;
    }
}
