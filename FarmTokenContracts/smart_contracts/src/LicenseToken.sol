// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155URIStorage.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title LicenseToken
 * @notice ERC-1155 tokenization of time-bound NFT licensing rights (Milestone 3).
 * @dev UK trademark compliance notes:
 * - trademarkRef stores the external trademark registration reference (for example UKIPO registration number).
 * - trademarkProofHash stores immutable on-chain evidence hash used during institutional due diligence.
 * - TRADEMARK_ADMIN_ROLE can update linkage metadata when legal records are amended.
 */
contract LicenseToken is ERC1155URIStorage, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant REVOKER_ROLE = keccak256("REVOKER_ROLE");
    bytes32 public constant TRADEMARK_ADMIN_ROLE = keccak256("TRADEMARK_ADMIN_ROLE");

    // Human-readable constants for licenseType
    uint8 public constant LICENSE_COMMERCIAL = 1;
    uint8 public constant LICENSE_DISPLAY = 2;
    uint8 public constant LICENSE_DERIVATIVE = 3;

    struct License {
        uint256 nftCollection;
        uint256 nftTokenId;
        address holder;
        uint8 licenseType;
        uint8 territory;
        uint64 startTimestamp;
        uint64 endTimestamp;
        string trademarkRef;
        bytes32 trademarkProofHash;
        bool revoked;
        uint64 revokedAt;
        string revokeReason;
    }

    struct ActiveLicenseView {
        uint256 licenseId;
        uint256 nftCollection;
        uint256 nftTokenId;
        address holder;
        uint8 licenseType;
        uint8 territory;
        uint64 startTimestamp;
        uint64 endTimestamp;
        string trademarkRef;
        bytes32 trademarkProofHash;
    }

    uint256 public nextLicenseId;
    string public baseMetadataURI;

    mapping(uint256 => License) public licenses;
    mapping(bytes32 => uint256[]) private _licenseIdsByNFT;

    event LicenseMinted(
        uint256 indexed licenseId,
        address indexed holder,
        uint256 indexed nftCollection,
        uint256 nftTokenId,
        uint64 startTimestamp,
        uint64 endTimestamp,
        uint8 licenseType,
        uint8 territory
    );
    event LicenseRevoked(uint256 indexed licenseId, address indexed revokedBy, string reason);
    event TrademarkLinked(uint256 indexed licenseId, string trademarkRef, bytes32 proofHash);
    event BaseMetadataURIUpdated(string previousURI, string newURI);

    constructor(
        string memory baseURI_,
        address admin,
        address revokerMultisig
    ) ERC1155(baseURI_) {
        require(admin != address(0), "Invalid admin");
        require(revokerMultisig != address(0), "Invalid multisig");

        baseMetadataURI = baseURI_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(TRADEMARK_ADMIN_ROLE, admin);
        _grantRole(REVOKER_ROLE, revokerMultisig);
    }

    /**
     * @notice Mint a new time-bound license token.
     * @param to License recipient.
     * @param nftCollection Underlying NFT collection encoded as uint256.
     * @param nftTokenId Underlying NFT token ID.
     * @param durationDays License validity duration in days.
     * @param licenseType 1=commercial, 2=display, 3=derivative.
     * @param territory Encoded territory restrictions.
     * @param trademarkRef Trademark registration reference used in legal linkage.
     */
    function mintLicense(
        address to,
        uint256 nftCollection,
        uint256 nftTokenId,
        uint256 durationDays,
        uint8 licenseType,
        uint8 territory,
        string memory trademarkRef
    ) external onlyRole(MINTER_ROLE) returns (uint256 licenseId) {
        require(to != address(0), "Invalid recipient");
        require(durationDays > 0, "Duration must be > 0");
        require(bytes(trademarkRef).length > 0, "Trademark ref required");

        licenseId = ++nextLicenseId;
        uint64 startTs = uint64(block.timestamp);
        uint64 endTs = uint64(block.timestamp + (durationDays * 1 days));

        bytes32 proofHash = keccak256(
            abi.encodePacked(
                nftCollection,
                nftTokenId,
                to,
                licenseType,
                territory,
                startTs,
                endTs,
                trademarkRef
            )
        );

        licenses[licenseId] = License({
            nftCollection: nftCollection,
            nftTokenId: nftTokenId,
            holder: to,
            licenseType: licenseType,
            territory: territory,
            startTimestamp: startTs,
            endTimestamp: endTs,
            trademarkRef: trademarkRef,
            trademarkProofHash: proofHash,
            revoked: false,
            revokedAt: 0,
            revokeReason: ""
        });

        _licenseIdsByNFT[_assetKey(nftCollection, nftTokenId)].push(licenseId);

        _mint(to, licenseId, 1, "");
        _setURI(licenseId, string(abi.encodePacked(baseMetadataURI, Strings.toString(licenseId), ".json")));

        emit LicenseMinted(
            licenseId,
            to,
            nftCollection,
            nftTokenId,
            startTs,
            endTs,
            licenseType,
            territory
        );
        emit TrademarkLinked(licenseId, trademarkRef, proofHash);
    }

    /**
     * @notice Returns true only when license is not revoked and current time is within its validity window.
     */
    function isLicenseValid(uint256 licenseId) public view returns (bool) {
        License memory l = licenses[licenseId];
        if (l.holder == address(0)) {
            return false;
        }
        if (l.revoked) {
            return false;
        }
        if (block.timestamp < l.startTimestamp || block.timestamp > l.endTimestamp) {
            return false;
        }
        return balanceOf(l.holder, licenseId) > 0;
    }

    /**
     * @notice Revoke license rights (multisig/legal control path).
     */
    function revokeLicense(uint256 licenseId, string memory reason) external onlyRole(REVOKER_ROLE) {
        License storage l = licenses[licenseId];
        require(l.holder != address(0), "License not found");
        require(!l.revoked, "Already revoked");

        l.revoked = true;
        l.revokedAt = uint64(block.timestamp);
        l.revokeReason = reason;

        if (balanceOf(l.holder, licenseId) > 0) {
            _burn(l.holder, licenseId, 1);
        }

        emit LicenseRevoked(licenseId, msg.sender, reason);
    }

    /**
     * @notice Returns active licenses for an NFT pair.
     * @dev Intended as an institutional due-diligence hook for rights verification.
     */
    function getLicensesForNFT(
        uint256 collection,
        uint256 tokenId
    ) external view returns (ActiveLicenseView[] memory activeLicenses) {
        uint256[] storage ids = _licenseIdsByNFT[_assetKey(collection, tokenId)];

        uint256 count = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (isLicenseValid(ids[i])) {
                count++;
            }
        }

        activeLicenses = new ActiveLicenseView[](count);
        uint256 ptr = 0;

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (!isLicenseValid(id)) {
                continue;
            }

            License memory l = licenses[id];
            activeLicenses[ptr] = ActiveLicenseView({
                licenseId: id,
                nftCollection: l.nftCollection,
                nftTokenId: l.nftTokenId,
                holder: l.holder,
                licenseType: l.licenseType,
                territory: l.territory,
                startTimestamp: l.startTimestamp,
                endTimestamp: l.endTimestamp,
                trademarkRef: l.trademarkRef,
                trademarkProofHash: l.trademarkProofHash
            });
            ptr++;
        }
    }

    /**
     * @notice Returns trademark linkage fields used by legal/compliance systems.
     */
    function getTrademarkLinkage(uint256 licenseId) external view returns (string memory trademarkRef, bytes32 proofHash) {
        License memory l = licenses[licenseId];
        require(l.holder != address(0), "License not found");
        return (l.trademarkRef, l.trademarkProofHash);
    }

    /**
     * @notice Due diligence hook: update trademark linkage metadata if legal references change.
     */
    function updateTrademarkLinkage(
        uint256 licenseId,
        string memory trademarkRef,
        bytes32 proofHash
    ) external onlyRole(TRADEMARK_ADMIN_ROLE) {
        License storage l = licenses[licenseId];
        require(l.holder != address(0), "License not found");
        require(bytes(trademarkRef).length > 0, "Trademark ref required");
        require(proofHash != bytes32(0), "Proof hash required");

        l.trademarkRef = trademarkRef;
        l.trademarkProofHash = proofHash;

        emit TrademarkLinked(licenseId, trademarkRef, proofHash);
    }

    function setBaseMetadataURI(string memory newBaseURI) external onlyRole(TRADEMARK_ADMIN_ROLE) {
        string memory previous = baseMetadataURI;
        baseMetadataURI = newBaseURI;
        emit BaseMetadataURIUpdated(previous, newBaseURI);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev Keep holder field synchronized if token ownership is transferred.
     */
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        super._update(from, to, ids, values);

        if (from == address(0) || to == address(0)) {
            return;
        }

        for (uint256 i = 0; i < ids.length; i++) {
            if (values[i] > 0) {
                licenses[ids[i]].holder = to;
            }
        }
    }

    function _assetKey(uint256 collection, uint256 tokenId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(collection, tokenId));
    }
}
