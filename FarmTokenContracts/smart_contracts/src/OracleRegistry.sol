// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IClassOracle {
    function setFloorPrice(uint256 rightsId, uint256 value) external;
    function getValue(uint256 rightsId) external view returns (uint256);
    function getTimestamp(uint256 rightsId) external view returns (uint256);
}

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function decimals() external view returns (uint8);
}

/**
 * @title OracleRegistry
 * @dev Milestone 2 valuation registry with composite scoring, Chainlink pricing,
 *      dynamic volatility, and oracle-driven risk/LTV.
 */
contract OracleRegistry is Ownable {
    using Strings for uint160;

    enum NFTType {
        NORMAL,
        RARE
    }

    uint256 public constant SCORE_BPS = 10_000;
    uint256 public constant TOP_TIER_THRESHOLD_BPS = 9_000;
    uint256 public constant TOP_TIER_MULTIPLIER_BPS = 15_000;
    uint256 public constant DEFAULT_MULTIPLIER_BPS = 10_000;

    uint256 public constant MAX_VALUE = 1_000_000_000 ether;
    uint256 public constant MAX_STALE_SECONDS = 2 hours;

    struct RightRisk {
        NFTType nftType;
        bool typeSet;
        bool provenanceValid;
        bool inPanic;
    }

    struct TrademarkInfo {
        string registrationNumber;
        string owner;
        bool verified;
        uint256 lastChecked;
    }

    string public constant BANKSY_REGISTRATION_NUMBER = "UK00003897277";

    mapping(uint256 => RightRisk) private _risk;
    mapping(uint256 => TrademarkInfo) public trademarkInfoByToken;
    mapping(uint256 => uint256) public rarityScore;
    mapping(uint256 => uint256) public utilityScore;
    mapping(uint256 => uint256) public distributionWeight;
    mapping(uint256 => uint256) public appraisalCeiling;
    mapping(uint256 => uint256) public tokenVolatilityIndex;
    mapping(uint256 => uint256) private _lastFloorValue;

    bool public trademarkValid;
    uint256 private _volatilityIndex;
    string public banksyTrademarkOwner;

    IClassOracle public normalOracle;
    IClassOracle public rareOracle;
    AggregatorV3Interface public immutable ethUsdFeed;

    event OracleContractsUpdated(address indexed normalOracle, address indexed rareOracle);
    event RightTypeUpdated(uint256 indexed rightsId, NFTType nftType);
    event OracleValueUpdated(uint256 indexed rightsId, uint256 value, NFTType nftType);
    event ScoresUpdated(uint256 indexed rightsId, uint256 rarity, uint256 utility, uint256 distribution);
    event AppraisalCeilingUpdated(uint256 indexed rightsId, uint256 ceiling);
    event VolatilityUpdated(uint256 volatilityIndex);
    event TrademarkStatusUpdated(bool isValid);
    event TrademarkVerified(uint256 indexed tokenId, string registrationNumber);
    event ProvenanceUpdated(uint256 indexed rightsId, bool isValid);
    event PanicTriggered(uint256 indexed rightsId);
    event PanicResolved(uint256 indexed rightsId);
    event ValuationUpdated(uint256 indexed rightsId, uint256 liquidationValue, uint256 appraisalValue);

    constructor(
        address initialOwner,
        address normalOracleAddress,
        address rareOracleAddress,
        address ethUsdFeedAddress
    ) Ownable(initialOwner) {
        require(normalOracleAddress != address(0), "Invalid normal oracle");
        require(rareOracleAddress != address(0), "Invalid rare oracle");
        require(ethUsdFeedAddress != address(0), "Invalid feed");

        normalOracle = IClassOracle(normalOracleAddress);
        rareOracle = IClassOracle(rareOracleAddress);
        ethUsdFeed = AggregatorV3Interface(ethUsdFeedAddress);

        trademarkValid = true;
        _volatilityIndex = 10;
        _setBanksyTrademarkOwner(initialOwner);
    }

    function setOracleContracts(address normalOracleAddress, address rareOracleAddress) external onlyOwner {
        require(normalOracleAddress != address(0), "Invalid normal oracle");
        require(rareOracleAddress != address(0), "Invalid rare oracle");

        normalOracle = IClassOracle(normalOracleAddress);
        rareOracle = IClassOracle(rareOracleAddress);

        emit OracleContractsUpdated(normalOracleAddress, rareOracleAddress);
    }

    function setScores(
        uint256 rightsId,
        uint256 rarity,
        uint256 utility,
        uint256 distribution
    ) external onlyOwner {
        require(rarity <= SCORE_BPS, "rarity out of range");
        require(utility <= SCORE_BPS, "utility out of range");
        require(distribution <= SCORE_BPS, "distribution out of range");

        rarityScore[rightsId] = rarity;
        utilityScore[rightsId] = utility;
        distributionWeight[rightsId] = distribution;

        emit ScoresUpdated(rightsId, rarity, utility, distribution);
    }

    function setAppraisalCeiling(uint256 rightsId, uint256 ceilingValue) external onlyOwner {
        appraisalCeiling[rightsId] = ceilingValue;
        emit AppraisalCeilingUpdated(rightsId, ceilingValue);
    }

    function setRightType(uint256 rightsId, NFTType nftType) external onlyOwner {
        RightRisk storage r = _risk[rightsId];
        if (r.typeSet) {
            require(r.nftType == nftType, "Type already fixed");
            return;
        }

        r.nftType = nftType;
        r.typeSet = true;
        _seedTrademarkInfo(rightsId);
        emit RightTypeUpdated(rightsId, nftType);
    }

    function rightTypeOf(uint256 rightsId) external view returns (NFTType) {
        require(_risk[rightsId].typeSet, "Type not set");
        return _risk[rightsId].nftType;
    }

    function setTokenValue(uint256 rightsId, uint256 value) external onlyOwner {
        updateValue(rightsId, value);
    }

    function updateValue(uint256 rightsId, uint256 value) public onlyOwner {
        require(value <= MAX_VALUE, "Value above MAX");
        require(_risk[rightsId].typeSet, "Type not set");

        _seedTrademarkInfo(rightsId);

        if (_risk[rightsId].nftType == NFTType.RARE) {
            rareOracle.setFloorPrice(rightsId, value);
            emit OracleValueUpdated(rightsId, value, NFTType.RARE);
        } else {
            normalOracle.setFloorPrice(rightsId, value);
            emit OracleValueUpdated(rightsId, value, NFTType.NORMAL);
        }

        _updateVolatilityFromPriceChange(rightsId, value);
        (uint256 liq, uint256 appr) = getValuations(rightsId);
        emit ValuationUpdated(rightsId, liq, appr);
    }

    function setOracleData(
        uint256 rightsId,
        uint256 value,
        uint256 volatility,
        bool isTrademarkValidValue,
        bool isProvenanceValidValue,
        NFTType nftType
    ) external onlyOwner {
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

        updateValue(rightsId, value);
        _volatilityIndex = volatility;
        tokenVolatilityIndex[rightsId] = volatility;
        trademarkValid = isTrademarkValidValue;
        _seedTrademarkInfo(rightsId);
        r.provenanceValid = isProvenanceValidValue;

        emit VolatilityUpdated(volatility);
        emit TrademarkStatusUpdated(isTrademarkValidValue);
        emit ProvenanceUpdated(rightsId, isProvenanceValidValue);
        (uint256 liq, uint256 appr) = getValuations(rightsId);
        emit ValuationUpdated(rightsId, liq, appr);
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

    function setBanksyTrademarkOwner(address ownerAddress) external onlyOwner {
        _setBanksyTrademarkOwner(ownerAddress);
    }

    function verifyTrademark(uint256 tokenId) external onlyOwner {
        TrademarkInfo storage info = trademarkInfoByToken[tokenId];
        info.registrationNumber = BANKSY_REGISTRATION_NUMBER;
        info.owner = banksyTrademarkOwner;
        info.verified = true;
        info.lastChecked = block.timestamp;
        emit TrademarkVerified(tokenId, info.registrationNumber);
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

    function getFloorTimestamp(uint256 rightsId) public view returns (uint256) {
        RightRisk memory r = _risk[rightsId];
        if (!r.typeSet) {
            return 0;
        }

        if (r.nftType == NFTType.RARE) {
            return rareOracle.getTimestamp(rightsId);
        }

        return normalOracle.getTimestamp(rightsId);
    }

    function validateOraclePath(uint256 rightsId, uint8 expectedType) public view returns (bool) {
        RightRisk memory r = _risk[rightsId];
        require(r.typeSet, "Type not set");
        return uint8(r.nftType) == expectedType;
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

        return r.inPanic;
    }

    function getRiskStatus(uint256 rightsId) public view returns (bool) {
        RightRisk memory r = _risk[rightsId];
        if (!r.typeSet) {
            return true;
        }

        uint256 routedValue = getFloorValue(rightsId);
        uint256 updatedAt = getFloorTimestamp(rightsId);
        bool badPricing = routedValue == 0 || routedValue > MAX_VALUE;
        bool stalePricing = updatedAt == 0 || block.timestamp - updatedAt > MAX_STALE_SECONDS;
        bool dataRisk = !isTrademarkValid(rightsId) || !r.provenanceValid;

        return badPricing || stalePricing || dataRisk || r.inPanic;
    }

    function getLiquidationValue(uint256 rightsId) external view returns (uint256) {
        (uint256 liquidationValue, ) = getValuations(rightsId);
        return liquidationValue;
    }

    function getAppraisalValue(uint256 rightsId) external view returns (uint256) {
        (, uint256 appraisalValue) = getValuations(rightsId);
        return appraisalValue;
    }

    function isTrademarkValid(uint256 rightsId) public view returns (bool) {
        TrademarkInfo memory info = trademarkInfoByToken[rightsId];
        return trademarkValid && info.verified;
    }

    function isProvenanceValid(uint256 rightsId) public view returns (bool) {
        return _risk[rightsId].provenanceValid;
    }

    function isPanic(uint256 rightsId) public view returns (bool) {
        return _risk[rightsId].inPanic;
    }

    function getCompositeScore(uint256 rightsId) public view returns (uint256) {
        uint256 rarity = rarityScore[rightsId];
        uint256 utility = utilityScore[rightsId];
        uint256 distribution = distributionWeight[rightsId];

        uint256 weighted = (rarity * 5_000) + (utility * 3_000) + (distribution * 2_000);
        return weighted / SCORE_BPS;
    }

    function getEthUsdPriceE18() public view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = ethUsdFeed.latestRoundData();
        require(answer > 0, "Invalid feed answer");
        require(updatedAt > 0, "Feed not updated");

        uint8 feedDecimals = ethUsdFeed.decimals();
        uint256 value = uint256(answer);
        if (feedDecimals < 18) {
            return value * (10 ** (18 - feedDecimals));
        }
        if (feedDecimals > 18) {
            return value / (10 ** (feedDecimals - 18));
        }
        return value;
    }

    function isTopTier(uint256 rightsId) public view returns (bool) {
        return getCompositeScore(rightsId) >= TOP_TIER_THRESHOLD_BPS;
    }

    function getValuations(uint256 rightsId) public view returns (uint256 liquidationValue, uint256 appraisalValue) {
        if (!isTrademarkValid(rightsId)) {
            return (0, 0);
        }

        uint256 oraclePrice = getFloorValue(rightsId);
        if (oraclePrice == 0) {
            return (0, 0);
        }

        uint256 tierMultiplier = isTopTier(rightsId) ? TOP_TIER_MULTIPLIER_BPS : DEFAULT_MULTIPLIER_BPS;
        uint256 tierAdjusted = (oraclePrice * tierMultiplier) / SCORE_BPS;

        uint256 configuredCeiling = appraisalCeiling[rightsId];
        uint256 ceiling = configuredCeiling > 0 ? configuredCeiling : tierAdjusted;
        appraisalValue = tierAdjusted > ceiling ? ceiling : tierAdjusted;

        uint256 composite = getCompositeScore(rightsId);
        uint256 liqRaw = (oraclePrice * composite) / SCORE_BPS;
        liqRaw = (liqRaw * tierMultiplier) / SCORE_BPS;

        liquidationValue = liqRaw > appraisalValue ? appraisalValue : liqRaw;
    }

    function getDynamicLTV(uint256 rightsId) public view returns (uint256) {
        if (_risk[rightsId].inPanic || getRiskStatus(rightsId)) {
            return 0;
        }

        uint256 effectiveVol = tokenVolatilityIndex[rightsId];
        if (_volatilityIndex > effectiveVol) {
            effectiveVol = _volatilityIndex;
        }

        if (effectiveVol < 20) {
            return 7_000;
        }
        if (effectiveVol < 50) {
            return 6_000;
        }
        return 4_000;
    }

    function getDynamicMaxLTV(uint256 rightsId) public view returns (uint256) {
        return getDynamicLTV(rightsId);
    }

    function getVolatilityIndex() external view returns (uint256) {
        return volatilityIndex();
    }

    function volatilityIndex() public view returns (uint256) {
        return _volatilityIndex;
    }

    function _updateVolatilityFromPriceChange(uint256 rightsId, uint256 newValue) internal {
        uint256 prev = _lastFloorValue[rightsId];
        _lastFloorValue[rightsId] = newValue;

        if (prev == 0 || newValue == prev) {
            return;
        }

        uint256 delta = newValue > prev ? newValue - prev : prev - newValue;
        uint256 deltaBps = (delta * SCORE_BPS) / prev;

        uint256 localVol = deltaBps / 100;
        if (localVol > 100) {
            localVol = 100;
        }

        tokenVolatilityIndex[rightsId] = localVol;
        _volatilityIndex = ((_volatilityIndex * 3) + localVol) / 4;
        emit VolatilityUpdated(_volatilityIndex);
    }

    function _seedTrademarkInfo(uint256 tokenId) internal {
        TrademarkInfo storage info = trademarkInfoByToken[tokenId];
        if (bytes(info.registrationNumber).length == 0) {
            info.registrationNumber = BANKSY_REGISTRATION_NUMBER;
            info.owner = banksyTrademarkOwner;
            info.verified = true;
            info.lastChecked = block.timestamp;
            emit TrademarkVerified(tokenId, info.registrationNumber);
        }
    }

    function _setBanksyTrademarkOwner(address ownerAddress) internal {
        require(ownerAddress != address(0), "Invalid trademark owner");
        banksyTrademarkOwner = Strings.toHexString(uint160(ownerAddress), 20);
    }
}
