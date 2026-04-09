// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockV3Aggregator {
    uint8 public immutable decimals;
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(uint8 feedDecimals, int256 initialAnswer) {
        decimals = feedDecimals;
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }

    function updateAnswer(int256 newAnswer) external {
        _answer = newAnswer;
        _updatedAt = block.timestamp;
    }
}
