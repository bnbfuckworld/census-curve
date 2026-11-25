// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Test double for the Agent ID registry, including ownerOf(tokenId).
/// Not a release contract.
contract MockSeatRegistry {
    mapping(address => uint256) public bals;
    mapping(address => string) public handles;
    mapping(uint256 => address) public ownerOfId;
    mapping(uint256 => bool) public exists;
    address[] public seen;
    uint256 public zeroHits;

    error NoSuchId();

    function setAgent(address account, uint256 id, string calldata handle) external {
        require(account != address(0), "mock zero");
        bals[account] = 1;
        handles[account] = handle;
        ownerOfId[id] = account;
        exists[id] = true;
    }

    function setBalance(address account, uint256 bal) external {
        require(account != address(0), "mock zero");
        bals[account] = bal;
    }

    function balanceOf(address account) external returns (uint256) {
        seen.push(account);
        if (account == address(0)) zeroHits += 1;
        return bals[account];
    }

    function handleOf(address account) external view returns (string memory) {
        return handles[account];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        if (!exists[tokenId]) revert NoSuchId();
        return ownerOfId[tokenId];
    }

    function seenCount() external view returns (uint256) {
        return seen.length;
    }
}
