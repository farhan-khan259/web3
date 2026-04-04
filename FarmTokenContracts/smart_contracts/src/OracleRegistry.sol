// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OracleRegistry
 * @dev Sepolia oracle for NFT-backed credit risk, panic, and dynamic LTV.
 */
contract OracleRegistry is Ownable {
    uint256 public constant SPECIAL_TOKEN_ID =
        0x000c06d6a17eb208a9bc7bd698eb6f22379209e3a4;

    uint256 public constant MIN_VALUE = 10_000_000 ether;
    uint256 public constant MAX_VALUE = 25_000_000 ether;

    mapping(uint256 => uint256) public tokenValue;
    mapping(uint256 => bool) public provenanceValid;
    mapping(uint256 => bool) public tokenInPanic;

    bool public trademarkValid;
    uint256 private _volatilityIndex;

    event TokenValueUpdated(uint256 indexed tokenId, uint256 value);
    event VolatilityUpdated(uint256 volatilityIndex);
    event TrademarkStatusUpdated(bool isValid);
    event ProvenanceUpdated(uint256 indexed tokenId, bool isValid);
    event PanicTriggered(uint256 indexed tokenId);
    event PanicResolved(uint256 indexed tokenId);
    event LTVUpdated(uint256 indexed tokenId, uint256 newLTV);

    constructor(address initialOwner) Ownable(initialOwner) {
        trademarkValid = true;
        _volatilityIndex = 10;
        provenanceValid[SPECIAL_TOKEN_ID] = true;
        tokenValue[SPECIAL_TOKEN_ID] = MIN_VALUE;
    }

    function setTokenValue(
        uint256 tokenId,
        uint256 value
    ) external onlyOwner {
        require(value <= MAX_VALUE, "Value above MAX");
        tokenValue[tokenId] = value;
        emit TokenValueUpdated(tokenId, value);
        emit LTVUpdated(tokenId, getDynamicMaxLTV(tokenId));
    }

    function getLiquidationValue(uint256 tokenId) external view returns (uint256) {
        return tokenValue[tokenId];
    }

    function setVolatility(uint256 newVolatility) external onlyOwner {
        require(newVolatility <= 100, "Volatility out of range");
        _volatilityIndex = newVolatility;
        emit VolatilityUpdated(newVolatility);
        emit LTVUpdated(SPECIAL_TOKEN_ID, getDynamicMaxLTV(SPECIAL_TOKEN_ID));
    }

    function setTrademarkStatus(bool isValid) external onlyOwner {
        trademarkValid = isValid;
        emit TrademarkStatusUpdated(isValid);
    }

    function setProvenance(
        uint256 tokenId,
        bool isValid
    ) external onlyOwner {
        provenanceValid[tokenId] = isValid;
        emit ProvenanceUpdated(tokenId, isValid);
    }

    function setOracleData(
        uint256 tokenId,
        uint256 value,
        uint256 volatility,
        bool isTrademarkValidValue,
        bool isProvenanceValidValue
    ) external onlyOwner {
        require(value <= MAX_VALUE, "Value above MAX");
        require(volatility <= 100, "Volatility out of range");

        tokenValue[tokenId] = value;
        _volatilityIndex = volatility;
        trademarkValid = isTrademarkValidValue;
        provenanceValid[tokenId] = isProvenanceValidValue;

        emit TokenValueUpdated(tokenId, value);
        emit VolatilityUpdated(volatility);
        emit TrademarkStatusUpdated(isTrademarkValidValue);
        emit ProvenanceUpdated(tokenId, isProvenanceValidValue);
        emit LTVUpdated(tokenId, getDynamicMaxLTV(tokenId));
    }

    function checkAndUpdatePanic(uint256 tokenId) external returns (bool) {
        bool shouldPanic = getRiskStatus(tokenId);
        if (shouldPanic && !tokenInPanic[tokenId]) {
            tokenInPanic[tokenId] = true;
            emit PanicTriggered(tokenId);
        } else if (!shouldPanic && tokenInPanic[tokenId]) {
            tokenInPanic[tokenId] = false;
            emit PanicResolved(tokenId);
        }

        emit LTVUpdated(tokenId, getDynamicMaxLTV(tokenId));
        return tokenInPanic[tokenId];
    }

    function resolveTokenPanic(uint256 tokenId) external onlyOwner {
        tokenInPanic[tokenId] = false;
        emit PanicResolved(tokenId);
        emit LTVUpdated(tokenId, getDynamicMaxLTV(tokenId));
    }

    function getFloorValue(uint256 tokenId) public view returns (uint256) {
        uint256 value = tokenValue[tokenId];
        if (tokenId == SPECIAL_TOKEN_ID && value == 0) {
            return MIN_VALUE;
        }
        return value;
    }

    function getRiskStatus(uint256 tokenId) public view returns (bool) {
        bool valuationRisk = tokenId == SPECIAL_TOKEN_ID && getFloorValue(tokenId) < MIN_VALUE;
        return valuationRisk || !isTrademarkValid(tokenId) || !isProvenanceValid(tokenId);
    }

    function isTrademarkValid(uint256) public view returns (bool) {
        return trademarkValid;
    }

    function isProvenanceValid(uint256 tokenId) public view returns (bool) {
        return provenanceValid[tokenId];
    }

    function getDynamicMaxLTV(uint256 tokenId) public view returns (uint256) {
        uint256 vol = volatilityIndex();
        uint256 maxLTV;

        if (vol < 20) {
            maxLTV = 7_500;
        } else if (vol < 50) {
            maxLTV = 7_000;
        } else if (vol < 80) {
            maxLTV = 6_500;
        } else {
            maxLTV = 6_000;
        }

        if (tokenInPanic[tokenId]) {
            return 0;
        }

        return maxLTV;
    }

    function getVolatilityIndex() external view returns (uint256) {
        return volatilityIndex();
    }

    function volatilityIndex() public view returns (uint256) {
        return _volatilityIndex;
    }
}