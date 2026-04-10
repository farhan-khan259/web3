// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILoanDebtView {
    function outstandingDebt(uint256 rightsId) external view returns (uint256);
}

interface IOracleFloorView {
    function getFloorValue(uint256 rightsId) external view returns (uint256);
    function validateOraclePath(uint256 rightsId, uint8 expectedType) external view returns (bool);
}

/**
 * @title Vault
 * @dev Stores locked minting rights as collateral without minting or transferring NFTs.
 */
contract Vault is AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    enum NFTType {
        NORMAL,
        RARE
    }

    enum RightType {
        PHYSICAL,
        COMMERCIAL
    }

    uint256 public immutable maxRightsSupply;

    struct MirrorRow {
        uint256 rightsId;
        bool isLocked;
        address locker;
        bool typeSet;
        NFTType nftType;
        uint256 oracleValue;
        uint256 snapshotValue;
        uint256 debt;
        uint256 ltvBps;
    }

    ILoanDebtView public loanEngine;
    IOracleFloorView public oracle;

    mapping(uint256 => address) public lockedBy;
    mapping(address => uint256) public lockedRightsCount;
    mapping(address => uint256[]) private _lockedRightsByOwner;
    mapping(uint256 => uint256) private _ownerIndexPlusOne;
    mapping(uint256 => uint256) public snapshotValue;
    mapping(uint256 => NFTType) private _rightType;
    mapping(uint256 => bool) private _rightTypeSet;
    mapping(uint256 => RightType) public rightTypeOfToken;

    uint256[] private _lockedRightsIds;
    mapping(uint256 => uint256) private _lockedIndexPlusOne;

    event LoanEngineUpdated(address indexed oldEngine, address indexed newEngine);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event RightLocked(uint256 indexed rightsId, address indexed locker, NFTType nftType);
    event CommercialRightsLocked(uint256 indexed rightsId, address indexed locker, RightType rightType);
    event RightUnlocked(uint256 indexed rightsId, address indexed receiver);
    event CommercialRightsTransferredOnLiquidation(
        uint256 indexed rightsId,
        address indexed from,
        address indexed to,
        RightType rightType,
        string clarification
    );
    event SnapshotCaptured(uint256 indexed rightsId, uint256 value);

    constructor(uint256 totalRightsSupply, address admin) {
        require(totalRightsSupply > 0, "Invalid rights supply");
        require(admin != address(0), "Invalid admin");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);

        maxRightsSupply = totalRightsSupply;
    }

    function setLoanEngine(address loanEngineAddress) external onlyRole(ADMIN_ROLE) {
        require(loanEngineAddress != address(0), "Invalid loan engine");
        address oldEngine = address(loanEngine);
        loanEngine = ILoanDebtView(loanEngineAddress);
        emit LoanEngineUpdated(oldEngine, loanEngineAddress);
    }

    function setOracle(address oracleAddress) external onlyRole(ADMIN_ROLE) {
        require(oracleAddress != address(0), "Invalid oracle");
        address oldOracle = address(oracle);
        oracle = IOracleFloorView(oracleAddress);
        emit OracleUpdated(oldOracle, oracleAddress);
    }

    function lockMintRight(
        uint256 rightsId,
        NFTType nftType,
        address locker
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        _lockMintingRights(rightsId, nftType, locker, true);
    }

    function lockMintingRights(
        uint256 rightsId,
        NFTType nftType,
        address locker,
        bool acknowledgesCommercialOnly
    ) public onlyRole(OPERATOR_ROLE) nonReentrant {
        _lockMintingRights(rightsId, nftType, locker, acknowledgesCommercialOnly);
    }

    function _lockMintingRights(
        uint256 rightsId,
        NFTType nftType,
        address locker,
        bool acknowledgesCommercialOnly
    ) internal {
        require(rightsId > 0 && rightsId <= maxRightsSupply, "Invalid rightsId");
        require(locker != address(0), "Invalid locker");
        require(lockedBy[rightsId] == address(0), "Already locked");
        require(address(oracle) != address(0), "Oracle not configured");
        require(oracle.validateOraclePath(rightsId, uint8(nftType)), "Oracle/type mismatch");
        require(acknowledgesCommercialOnly, "Must acknowledge commercial rights only");

        uint256 snap = oracle.getFloorValue(rightsId);
        require(snap > 0, "Snapshot value is zero");

        lockedBy[rightsId] = locker;
        lockedRightsCount[locker] += 1;
        snapshotValue[rightsId] = snap;
        _rightType[rightsId] = nftType;
        _rightTypeSet[rightsId] = true;
        // Banksy collection policy: only commercial rights are collateralized in this vault.
        rightTypeOfToken[rightsId] = RightType.COMMERCIAL;

        _lockedRightsByOwner[locker].push(rightsId);
        _ownerIndexPlusOne[rightsId] = _lockedRightsByOwner[locker].length;

        _lockedRightsIds.push(rightsId);
        _lockedIndexPlusOne[rightsId] = _lockedRightsIds.length;

        emit SnapshotCaptured(rightsId, snap);
        emit RightLocked(rightsId, locker, nftType);
        emit CommercialRightsLocked(rightsId, locker, RightType.COMMERCIAL);
    }

    function unlockMintRight(
        uint256 rightsId,
        address receiver
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        require(receiver != address(0), "Invalid receiver");
        require(lockedBy[rightsId] != address(0), "Not locked");
        require(address(loanEngine) != address(0), "Loan engine not configured");
        require(loanEngine.outstandingDebt(rightsId) == 0, "Debt outstanding");

        address locker = lockedBy[rightsId];
        if (lockedRightsCount[locker] > 0) {
            lockedRightsCount[locker] -= 1;
        }

        _removeOwnerRight(locker, rightsId);

        delete lockedBy[rightsId];
        delete snapshotValue[rightsId];
        delete _rightType[rightsId];
        delete _rightTypeSet[rightsId];
        delete rightTypeOfToken[rightsId];

        _removeLockedRight(rightsId);
        emit RightUnlocked(rightsId, receiver);
    }

    function transferRightsOnLiquidation(
        uint256 rightsId,
        address to
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        require(to != address(0), "Invalid receiver");
        address from = lockedBy[rightsId];
        require(from != address(0), "Not locked");

        _removeOwnerRight(from, rightsId);
        if (lockedRightsCount[from] > 0) {
            lockedRightsCount[from] -= 1;
        }

        lockedBy[rightsId] = to;
        lockedRightsCount[to] += 1;
        _lockedRightsByOwner[to].push(rightsId);
        _ownerIndexPlusOne[rightsId] = _lockedRightsByOwner[to].length;

        // This liquidation does not affect physical ownership of the original artwork.
        emit CommercialRightsTransferredOnLiquidation(
            rightsId,
            from,
            to,
            RightType.COMMERCIAL,
            "Only commercial rights (reproduction/licensing) are transferred"
        );
    }

    function isLocked(uint256 rightsId) external view returns (bool) {
        return lockedBy[rightsId] != address(0);
    }

    function getLockedRightIds() external view returns (uint256[] memory) {
        return _lockedRightsIds;
    }

    function getLockedRightsByWallet(address owner) external view returns (uint256[] memory) {
        return _lockedRightsByOwner[owner];
    }

    function rightTypeOf(uint256 rightsId) external view returns (NFTType) {
        require(_rightTypeSet[rightsId], "Type not set");
        return _rightType[rightsId];
    }

    function getSnapshotValue(uint256 rightsId) external view returns (uint256) {
        return snapshotValue[rightsId];
    }

    function getRightsDescription(uint256 tokenId) external view returns (string memory) {
        RightType rightType = rightTypeOfToken[tokenId];
        if (rightType == RightType.COMMERCIAL) {
            return "Commercial rights only: reproduction, licensing, and derivative monetization rights. Physical ownership of the original artwork is not transferred.";
        }

        return "No commercial rights are currently locked for this token. Physical ownership rights remain outside vault collateral.";
    }

    /**
     * @dev Mirrors collateral state for a batch of rights IDs so frontends can build
     *      a full 9,300-right valuation table without write operations.
     */
    function getMirrorRange(uint256 startId, uint256 endId) external view returns (MirrorRow[] memory rows) {
        require(startId > 0, "startId out of range");
        require(endId >= startId, "Invalid range");
        require(endId <= maxRightsSupply, "endId out of range");

        uint256 length = endId - startId + 1;
        rows = new MirrorRow[](length);

        bool hasOracle = address(oracle) != address(0);
        bool hasLoan = address(loanEngine) != address(0);

        for (uint256 i = 0; i < length; i++) {
            uint256 rightsId = startId + i;
            address owner = lockedBy[rightsId];
            bool isLockedRight = owner != address(0);
            bool typeSet = _rightTypeSet[rightsId];
            NFTType rightType = typeSet ? _rightType[rightsId] : NFTType.NORMAL;

            uint256 oracleValue = 0;
            if (hasOracle && typeSet) {
                oracleValue = oracle.getFloorValue(rightsId);
            }

            uint256 snap = snapshotValue[rightsId];

            uint256 debt = 0;
            if (hasLoan && isLockedRight) {
                debt = loanEngine.outstandingDebt(rightsId);
            }

            uint256 ltv = 0;
            if (snap > 0 && debt > 0) {
                ltv = (debt * 10_000) / snap;
            }

            rows[i] = MirrorRow({
                rightsId: rightsId,
                isLocked: isLockedRight,
                locker: owner,
                typeSet: typeSet,
                nftType: rightType,
                oracleValue: oracleValue,
                snapshotValue: snap,
                debt: debt,
                ltvBps: ltv
            });
        }
    }

    function _removeOwnerRight(address owner, uint256 rightsId) internal {
        uint256 idxPlusOne = _ownerIndexPlusOne[rightsId];
        if (idxPlusOne == 0) {
            return;
        }

        uint256 idx = idxPlusOne - 1;
        uint256[] storage owned = _lockedRightsByOwner[owner];
        uint256 lastIdx = owned.length - 1;

        if (idx != lastIdx) {
            uint256 lastRightsId = owned[lastIdx];
            owned[idx] = lastRightsId;
            _ownerIndexPlusOne[lastRightsId] = idx + 1;
        }

        owned.pop();
        delete _ownerIndexPlusOne[rightsId];
    }

    function _removeLockedRight(uint256 rightsId) internal {
        uint256 idxPlusOne = _lockedIndexPlusOne[rightsId];
        if (idxPlusOne == 0) {
            return;
        }

        uint256 idx = idxPlusOne - 1;
        uint256 lastIdx = _lockedRightsIds.length - 1;

        if (idx != lastIdx) {
            uint256 lastRightsId = _lockedRightsIds[lastIdx];
            _lockedRightsIds[idx] = lastRightsId;
            _lockedIndexPlusOne[lastRightsId] = idx + 1;
        }

        _lockedRightsIds.pop();
        delete _lockedIndexPlusOne[rightsId];
    }
}
