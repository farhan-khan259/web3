const fs = require('fs');
const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const signer = new ethers.Wallet('0xb707c5fc7b8a88faaf04e01eef1159eac006a544aecfedd81a670f83aa951ade', provider);
    const vault = new ethers.Contract('0x12A1B6B89B782F2b222BC13237C766f1E6A9e12C', [
        'function batchStake(uint256[] calldata tokenIds) external',
        'function owner() view returns (address)',
        'function totalStaked() view returns (uint256)'
    ], signer);

    let output = "";
    try {
        output += "Vault Owner: " + (await vault.owner()) + "\n";
        output += "My Address: " + signer.address + "\n";

        output += "Attempting to stake token 1...\n";
        const tx = await vault.batchStake([1]);
        await tx.wait();
        output += "Success!\n";
    } catch (err) {
        output += "ERROR CAUGHT:\n" + err.stack + "\n" + JSON.stringify(err) + "\n";
    }
    fs.writeFileSync('debug_output.txt', output);
    console.log("Done. Wrote to debug_output.txt");
}

main().catch(e => {
    fs.writeFileSync('debug_output.txt', "Global Error: " + e.stack);
});
