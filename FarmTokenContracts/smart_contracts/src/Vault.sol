// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILoanDebtView {
    function outstandingDebt(uint256 tokenId) external view returns (uint256);
}

interface IOracleFloorView {
    function getFloorValue(uint256 tokenId) external view returns (uint256);
}

/**
 * @title Vault
 * @dev Private NFT locking vault controlled by owner-only operations.
 */
contract Vault is AccessControl, ERC721Holder, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    IERC721 public immutable nftCollection;
    ILoanDebtView public loanEngine;
    IOracleFloorView public oracle;

    mapping(uint256 => address) public lockedBy;
    mapping(uint256 => uint256) public snapshotValue;
    uint256[] private _lockedTokenIds;
    mapping(uint256 => uint256) private _lockedIndexPlusOne;

    event LoanEngineUpdated(address indexed oldEngine, address indexed newEngine);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event NFTDeposited(uint256 indexed tokenId, address indexed depositor);
    event NFTWithdrawn(uint256 indexed tokenId, address indexed receiver);
    event SnapshotCaptured(uint256 indexed tokenId, uint256 value);

    constructor(address nftAddress, address admin) {
        require(nftAddress != address(0), "Invalid NFT address");
        require(admin != address(0), "Invalid admin");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(OWNER_ROLE, admin);

        nftCollection = IERC721(nftAddress);
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

    function depositNFT(uint256 tokenId) external onlyRole(OWNER_ROLE) nonReentrant {
        require(lockedBy[tokenId] == address(0), "Already locked");
        require(address(oracle) != address(0), "Oracle not configured");

        nftCollection.safeTransferFrom(msg.sender, address(this), tokenId);
        lockedBy[tokenId] = msg.sender;
        snapshotValue[tokenId] = oracle.getFloorValue(tokenId);
        require(snapshotValue[tokenId] > 0, "Snapshot value is zero");
        _lockedTokenIds.push(tokenId);
        _lockedIndexPlusOne[tokenId] = _lockedTokenIds.length;

        emit SnapshotCaptured(tokenId, snapshotValue[tokenId]);
        emit NFTDeposited(tokenId, msg.sender);
    }

    function withdrawNFT(
        uint256 tokenId,
        address receiver
    ) external onlyRole(OWNER_ROLE) nonReentrant {
        require(receiver != address(0), "Invalid receiver");
        require(lockedBy[tokenId] != address(0), "Not locked");
        require(address(loanEngine) != address(0), "Loan engine not configured");
        require(loanEngine.outstandingDebt(tokenId) == 0, "Debt outstanding");

        delete lockedBy[tokenId];
        delete snapshotValue[tokenId];
        _removeLockedToken(tokenId);
        nftCollection.safeTransferFrom(address(this), receiver, tokenId);

        emit NFTWithdrawn(tokenId, receiver);
    }

    function isLocked(uint256 tokenId) external view returns (bool) {
        return lockedBy[tokenId] != address(0);
    }

    function getLockedTokenIds() external view returns (uint256[] memory) {
        return _lockedTokenIds;
    }

    function getSnapshotValue(uint256 tokenId) external view returns (uint256) {
        return snapshotValue[tokenId];
    }

    function _removeLockedToken(uint256 tokenId) internal {
        uint256 idxPlusOne = _lockedIndexPlusOne[tokenId];
        if (idxPlusOne == 0) {
            return;
        }

        uint256 idx = idxPlusOne - 1;
        uint256 lastIdx = _lockedTokenIds.length - 1;

        if (idx != lastIdx) {
            uint256 lastTokenId = _lockedTokenIds[lastIdx];
            _lockedTokenIds[idx] = lastTokenId;
            _lockedIndexPlusOne[lastTokenId] = idx + 1;
        }

        _lockedTokenIds.pop();
        delete _lockedIndexPlusOne[tokenId];
    }
}