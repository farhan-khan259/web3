require("dotenv").config();
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const deployedPath = path.join(__dirname, "..", "deployed_local.json");

  const oracleAddress = process.env.ORACLE_REGISTRY_ADDRESS || (
    fs.existsSync(deployedPath)
      ? JSON.parse(fs.readFileSync(deployedPath, "utf8")).oracle
      : ""
  );

  if (!oracleAddress) {
    throw new Error("Missing ORACLE_REGISTRY_ADDRESS and no deployed_local.json found");
  }

  const OracleRegistry = await hre.ethers.getContractFactory("OracleRegistry");
  const oracle = OracleRegistry.attach(oracleAddress).connect(signer);

  const rows = [
    { rightsId: 1, rarity: 9000, utility: 8500, distribution: 8000, ceilingEth: "15" },
    { rightsId: 2, rarity: 7200, utility: 7000, distribution: 6800, ceilingEth: "9" },
    { rightsId: 3, rarity: 9500, utility: 9200, distribution: 9100, ceilingEth: "20" },
  ];

  for (const row of rows) {
    await (await oracle.setScores(row.rightsId, row.rarity, row.utility, row.distribution)).wait();
    await (await oracle.setAppraisalCeiling(row.rightsId, hre.ethers.parseEther(row.ceilingEth))).wait();
    console.log(`Seeded scores for rightsId=${row.rightsId}`);
  }

  console.log("Score seeding complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
