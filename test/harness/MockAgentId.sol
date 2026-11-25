// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Test double for the Agent ID registry. Not a release contract.
/// `balanceOf` records every argument so tests can reject a zero-address query.
contract MockAgentId {
    mapping(address => uint256) public bals;
    mapping(address => string) public handles;
    address[] public seen;
    uint256 public zeroHits;
    bool public forceRevert;

    error RegistryDown();

    function setAgent(address account, uint256 bal, string calldata handle) external {
        require(account != address(0), "mock zero");
        bals[account] = bal;
        handles[account] = handle;
    }

    function setBalance(address account, uint256 bal) external {
        require(account != address(0), "mock zero");
        bals[account] = bal;
    }

    function setRevert(bool on) external {
        forceRevert = on;
    }

    function balanceOf(address account) external returns (uint256) {
        seen.push(account);
        if (account == address(0)) zeroHits += 1;
        if (forceRevert) revert RegistryDown();
        return bals[account];
    }

    function handleOf(address account) external view returns (string memory) {
        if (forceRevert) revert RegistryDown();
        return handles[account];
    }

    function seenCount() external view returns (uint256) {
        return seen.length;
    }
}
