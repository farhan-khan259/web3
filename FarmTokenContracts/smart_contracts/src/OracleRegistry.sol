// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IClassOracle {
    function setValue(uint256 rightsId, uint256 value) external;
    function getValue(uint256 rightsId) external view returns (uint256);
}

/**
 * @title OracleRegistry
 * @dev Registry for mint-right valuation with strict NORMAL/RARE oracle separation.
 */
contract OracleRegistry is Ownable {
    enum NFTType {
        NORMAL,
        RARE
    }

    uint256 public constant MAX_VALUE = 1_000_000_000 ether;

    struct RightRisk {
        NFTType nftType;
        bool typeSet;
        bool provenanceValid;
        bool inPanic;
    }

    mapping(uint256 => RightRisk) private _risk;

    bool public trademarkValid;
    uint256 private _volatilityIndex;

    IClassOracle public normalOracle;
    IClassOracle public rareOracle;

    event OracleContractsUpdated(address indexed normalOracle, address indexed rareOracle);
    event RightTypeUpdated(uint256 indexed rightsId, NFTType nftType);
    event OracleValueUpdated(uint256 indexed rightsId, uint256 value, NFTType nftType);
    event VolatilityUpdated(uint256 volatilityIndex);
    event TrademarkStatusUpdated(bool isValid);
    event ProvenanceUpdated(uint256 indexed rightsId, bool isValid);
    event PanicTriggered(uint256 indexed rightsId);
    event PanicResolved(uint256 indexed rightsId);
    event LTVUpdated(uint256 indexed rightsId, uint256 newLTV);

    constructor(address initialOwner, address normalOracleAddress, address rareOracleAddress) Ownable(initialOwner) {
        require(normalOracleAddress != address(0), "Invalid normal oracle");
        require(rareOracleAddress != address(0), "Invalid rare oracle");

        normalOracle = IClassOracle(normalOracleAddress);
        rareOracle = IClassOracle(rareOracleAddress);

        trademarkValid = true;
        _volatilityIndex = 10;
    }

    function setOracleContracts(address normalOracleAddress, address rareOracleAddress) external onlyOwner {
        require(normalOracleAddress != address(0), "Invalid normal oracle");
        require(rareOracleAddress != address(0), "Invalid rare oracle");

        normalOracle = IClassOracle(normalOracleAddress);
        rareOracle = IClassOracle(rareOracleAddress);

        emit OracleContractsUpdated(normalOracleAddress, rareOracleAddress);
    }

    function setRightType(uint256 rightsId, NFTType nftType) external onlyOwner {
        RightRisk storage r = _risk[rightsId];
        if (r.typeSet) {
            require(r.nftType == nftType, "Type already fixed");
            return;
        }

        r.nftType = nftType;
        r.typeSet = true;
        emit RightTypeUpdated(rightsId, nftType);
    }

    function rightTypeOf(uint256 rightsId) external view returns (NFTType) {
        require(_risk[rightsId].typeSet, "Type not set");
        return _risk[rightsId].nftType;
    }

    function setTokenValue(uint256 rightsId, uint256 value) external onlyOwner {
        require(value <= MAX_VALUE, "Value above MAX");
        require(_risk[rightsId].typeSet, "Type not set");

        if (_risk[rightsId].nftType == NFTType.RARE) {
            rareOracle.setValue(rightsId, value);
            emit OracleValueUpdated(rightsId, value, NFTType.RARE);
        } else {
            normalOracle.setValue(rightsId, value);
            emit OracleValueUpdated(rightsId, value, NFTType.NORMAL);
        }

        emit LTVUpdated(rightsId, getDynamicMaxLTV(rightsId));
    }

    function setOracleData(
        uint256 rightsId,
        uint256 value,
        uint256 volatility,
        bool isTrademarkValidValue,
        bool isProvenanceValidValue,
        NFTType nftType
    ) external onlyOwner {
        // Type is immutable once set, preventing accidental NORMAL/RARE oracle flips.
        require(value <= MAX_VALUE, "Value above MAX");
        require(volatility <= 100, "Volatility out of range");

        RightRisk storage r = _risk[rightsId];
        if (r.typeSet) {
            require(r.nftType == nftType, "Type already fixed");
        } else {
            r.nftType = nftType;
            r.typeSet = true;
            emit RightTypeUpdated(rightsId, nftType);
        }

        if (nftType == NFTType.RARE) {
            rareOracle.setValue(rightsId, value);
        } else {
            normalOracle.setValue(rightsId, value);
        }

        _volatilityIndex = volatility;
        trademarkValid = isTrademarkValidValue;
        r.provenanceValid = isProvenanceValidValue;

        emit OracleValueUpdated(rightsId, value, nftType);
        emit VolatilityUpdated(volatility);
        emit TrademarkStatusUpdated(isTrademarkValidValue);
        emit ProvenanceUpdated(rightsId, isProvenanceValidValue);
        emit LTVUpdated(rightsId, getDynamicMaxLTV(rightsId));
    }

    function setVolatility(uint256 newVolatility) external onlyOwner {
        require(newVolatility <= 100, "Volatility out of range");
        _volatilityIndex = newVolatility;
        emit VolatilityUpdated(newVolatility);
    }

    function setTrademarkStatus(bool isValid) external onlyOwner {
        trademarkValid = isValid;
        emit TrademarkStatusUpdated(isValid);
    }

    function setProvenance(uint256 rightsId, bool isValid) external onlyOwner {
        _risk[rightsId].provenanceValid = isValid;
        emit ProvenanceUpdated(rightsId, isValid);
    }

    function getFloorValue(uint256 rightsId) public view returns (uint256) {
        RightRisk memory r = _risk[rightsId];
        if (!r.typeSet) {
            return 0;
        }

        if (r.nftType == NFTType.RARE) {
            return rareOracle.getValue(rightsId);
        }

        return normalOracle.getValue(rightsId);
    }

    function validateOraclePath(uint256 rightsId, NFTType expectedType) public view returns (bool) {
        RightRisk memory r = _risk[rightsId];
        require(r.typeSet, "Type not set");
        return r.nftType == expectedType;
    }

    function checkAndUpdatePanic(uint256 rightsId) external returns (bool) {
        bool shouldPanic = getRiskStatus(rightsId);
        RightRisk storage r = _risk[rightsId];

        if (shouldPanic && !r.inPanic) {
            r.inPanic = true;
            emit PanicTriggered(rightsId);
        } else if (!shouldPanic && r.inPanic) {
            r.inPanic = false;
            emit PanicResolved(rightsId);
        }

        emit LTVUpdated(rightsId, getDynamicMaxLTV(rightsId));
        return r.inPanic;
    }

    function resolveTokenPanic(uint256 rightsId) external onlyOwner {
        _risk[rightsId].inPanic = false;
        emit PanicResolved(rightsId);
        emit LTVUpdated(rightsId, getDynamicMaxLTV(rightsId));
    }

    function getRiskStatus(uint256 rightsId) public view returns (bool) {
        RightRisk memory r = _risk[rightsId];
        if (!r.typeSet) {
            return true;
        }

        uint256 routedValue = getFloorValue(rightsId);
        bool badPricing = routedValue == 0 || routedValue > MAX_VALUE;
        bool dataRisk = !trademarkValid || !r.provenanceValid;

        return badPricing || dataRisk || r.inPanic;
    }

    function getLiquidationValue(uint256 rightsId) external view returns (uint256) {
        return getFloorValue(rightsId);
    }

    function isTrademarkValid(uint256) public view returns (bool) {
        return trademarkValid;
    }

    function isProvenanceValid(uint256 rightsId) public view returns (bool) {
        return _risk[rightsId].provenanceValid;
    }

    function isPanic(uint256 rightsId) public view returns (bool) {
        return _risk[rightsId].inPanic;
    }

    function getDynamicMaxLTV(uint256 rightsId) public view returns (uint256) {
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

        if (_risk[rightsId].inPanic) {
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
