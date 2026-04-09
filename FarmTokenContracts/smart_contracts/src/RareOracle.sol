// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RareOracle is Ownable {
    struct OracleValue {
        uint256 value;
        uint256 updatedAt;
    }

    mapping(uint256 => OracleValue) private _values;
    address public registry;

    event RegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event ValueUpdated(uint256 indexed rightsId, uint256 value, uint256 updatedAt);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyRegistry() {
        require(msg.sender == registry, "Only registry");
        _;
    }

    function setRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Invalid registry");
        address oldRegistry = registry;
        registry = newRegistry;
        emit RegistryUpdated(oldRegistry, newRegistry);
    }

    function setFloorPrice(uint256 rightsId, uint256 value) external onlyRegistry {
        _values[rightsId] = OracleValue({
            value: value,
            updatedAt: block.timestamp
        });
        emit ValueUpdated(rightsId, value, block.timestamp);
    }

    function getValue(uint256 rightsId) external view returns (uint256) {
        return _values[rightsId].value;
    }

    function getTimestamp(uint256 rightsId) external view returns (uint256) {
        return _values[rightsId].updatedAt;
    }
}
