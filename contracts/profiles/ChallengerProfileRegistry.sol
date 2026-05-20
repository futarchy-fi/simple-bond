// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChallengerProfileRegistry
/// @notice Append-only registry of challenger profiles.
contract ChallengerProfileRegistry {
    struct Entry {
        address owner;
        bytes32 contentHash;
        string content;
    }

    Entry[] private entries;

    event ProfileRegistered(
        uint256 indexed entryId,
        address indexed owner,
        bytes32 contentHash,
        string content
    );

    function registerProfile(string calldata content) external returns (uint256 entryId) {
        bytes32 contentHash = keccak256(bytes(content));
        entryId = entries.length;
        entries.push(Entry({owner: msg.sender, contentHash: contentHash, content: content}));
        emit ProfileRegistered(entryId, msg.sender, contentHash, content);
    }

    function getProfile(uint256 entryId)
        external
        view
        returns (address owner, bytes32 contentHash, string memory content)
    {
        Entry storage e = entries[entryId];
        return (e.owner, e.contentHash, e.content);
    }

    function entryCount() external view returns (uint256) {
        return entries.length;
    }
}
