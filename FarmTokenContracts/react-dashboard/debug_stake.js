const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const signer = new ethers.Wallet('0xb707c5fc7b8a88faaf04e01eef1159eac006a544aecfedd81a670f83aa951ade', provider);
    const vault = new ethers.Contract('0x12A1B6B89B782F2b222BC13237C766f1E6A9e12C', [
        'function batchStake(uint256[] calldata tokenIds) external',
        'function owner() view returns (address)',
        'function vaultedNFTs(uint256) view returns (uint256, address)',
        'error OwnableUnauthorizedAccount(address account)',
        'error EnforcedPause()',
        'error ReentrancyGuardReentrantCall()'
    ], signer);

    try {
        console.log("Vault Owner:", await vault.owner());
        console.log("My Address: ", signer.address);
        console.log("Checking if Token 1 is already staked...");

        // Attempting a pure call first to grab the exact revert reason locally
        await vault.batchStake.staticCall([1]);
        console.log("Static call succeeded, sending transaction...");

        const tx = await vault.batchStake([1]);
        const receipt = await tx.wait();
        console.log("Success! Tx:", receipt.hash);
    } catch (error) {
        console.error("EXACT REVERT ERROR:", error.shortMessage || error.message);
        if (error.data) {
            console.error("Revert Data:", error.data);
        }
        if (error.reason) {
            console.error("Revert Reason:", error.reason);
        }
    }
}

main();
