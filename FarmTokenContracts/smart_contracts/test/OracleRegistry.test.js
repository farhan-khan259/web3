const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OracleRegistry Milestone 2", function () {
  async function deployOracleFixture() {
    const [owner] = await ethers.getSigners();

    const Feed = await ethers.getContractFactory("MockV3Aggregator");
    const feed = await Feed.deploy(8, 3200n * 10n ** 8n);
    await feed.waitForDeployment();

    const RegularOracle = await ethers.getContractFactory("RegularOracle");
    const normalOracle = await RegularOracle.deploy(owner.address);
    await normalOracle.waitForDeployment();

    const RareOracle = await ethers.getContractFactory("RareOracle");
    const rareOracle = await RareOracle.deploy(owner.address);
    await rareOracle.waitForDeployment();

    const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
    const oracle = await OracleRegistry.deploy(
      owner.address,
      await normalOracle.getAddress(),
      await rareOracle.getAddress(),
      await feed.getAddress()
    );
    await oracle.waitForDeployment();

    await (await normalOracle.setRegistry(await oracle.getAddress())).wait();
    await (await rareOracle.setRegistry(await oracle.getAddress())).wait();

    await (await oracle.setOracleData(1, ethers.parseEther("10"), 10, true, true, 0)).wait();
    await (await oracle.setScores(1, 9000, 8500, 8000)).wait();
    await (await oracle.setAppraisalCeiling(1, ethers.parseEther("20"))).wait();

    await (await oracle.setOracleData(2, ethers.parseEther("8"), 55, true, true, 1)).wait();
    await (await oracle.setScores(2, 5000, 4000, 3000)).wait();
    await (await oracle.setAppraisalCeiling(2, ethers.parseEther("12"))).wait();

    return { oracle, feed };
  }

  it("computes composite scores and valuation caps", async function () {
    const { oracle } = await deployOracleFixture();

    expect(await oracle.getCompositeScore(1)).to.equal(8650);

    const valuations = await oracle.getValuations(1);
    expect(valuations.appraisalValue).to.be.gt(0);
    expect(valuations.liquidationValue).to.be.lte(valuations.appraisalValue);
  });

  it("updates dynamic LTV tiers from volatility", async function () {
    const { oracle } = await deployOracleFixture();

    await (await oracle.setVolatility(15)).wait();
    expect(await oracle.getDynamicLTV(1)).to.equal(7000);

    await (await oracle.setVolatility(40)).wait();
    expect(await oracle.getDynamicLTV(1)).to.equal(6000);

    await (await oracle.setVolatility(90)).wait();
    expect(await oracle.getDynamicLTV(1)).to.equal(4000);
  });

  it("flags risk when provenance fails", async function () {
    const { oracle } = await deployOracleFixture();

    await (await oracle.setProvenance(1, false)).wait();
    expect(await oracle.getRiskStatus(1)).to.equal(true);
  });

  it("exposes Chainlink ETH/USD value in 1e18 precision", async function () {
    const { oracle, feed } = await deployOracleFixture();

    expect(await oracle.getEthUsdPriceE18()).to.equal(3200n * 10n ** 18n);

    await (await feed.updateAnswer(3000n * 10n ** 8n)).wait();
    expect(await oracle.getEthUsdPriceE18()).to.equal(3000n * 10n ** 18n);
  });
});
