// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RegularOracle is Ownable {
    mapping(uint256 => uint256) private _values;

    event ValueUpdated(uint256 indexed rightsId, uint256 value);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setValue(uint256 rightsId, uint256 value) external onlyOwner {
        _values[rightsId] = value;
        emit ValueUpdated(rightsId, value);
    }

    function getValue(uint256 rightsId) external view returns (uint256) {
        return _values[rightsId];
    }
}
