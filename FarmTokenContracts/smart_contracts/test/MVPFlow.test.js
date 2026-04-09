const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Institutional NFT Credit Engine MVP - Milestone 2", function () {
  async function deployFixture() {
    const [admin, operator, reserve, user] = await ethers.getSigners();

    const Feed = await ethers.getContractFactory("MockV3Aggregator");
    const feed = await Feed.deploy(8, 3500n * 10n ** 8n);
    await feed.waitForDeployment();

    const RegularOracle = await ethers.getContractFactory("RegularOracle");
    const normalOracle = await RegularOracle.deploy(admin.address);
    await normalOracle.waitForDeployment();

    const RareOracle = await ethers.getContractFactory("RareOracle");
    const rareOracle = await RareOracle.deploy(admin.address);
    await rareOracle.waitForDeployment();

    const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
    const oracle = await OracleRegistry.deploy(
      admin.address,
      await normalOracle.getAddress(),
      await rareOracle.getAddress(),
      await feed.getAddress()
    );
    await oracle.waitForDeployment();

    await (await normalOracle.setRegistry(await oracle.getAddress())).wait();
    await (await rareOracle.setRegistry(await oracle.getAddress())).wait();

    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(9300, admin.address);
    await vault.waitForDeployment();

    const DebtToken = await ethers.getContractFactory("DebtToken");
    const debtToken = await DebtToken.deploy(admin.address);
    await debtToken.waitForDeployment();

    const LoanEngine = await ethers.getContractFactory("LoanEngine");
    const loan = await LoanEngine.deploy(
      await oracle.getAddress(),
      await vault.getAddress(),
      await debtToken.getAddress(),
      admin.address
    );
    await loan.waitForDeployment();

    const debtMinterRole = await debtToken.MINTER_ROLE();
    await (await debtToken.grantRole(debtMinterRole, await loan.getAddress())).wait();

    const RevenueRouter = await ethers.getContractFactory("RevenueRouter");
    const router = await RevenueRouter.deploy(
      await loan.getAddress(),
      admin.address,
      reserve.address
    );
    await router.waitForDeployment();

    await (await vault.setLoanEngine(await loan.getAddress())).wait();
    await (await vault.setOracle(await oracle.getAddress())).wait();
    await (await loan.setRevenueRouter(await router.getAddress())).wait();

    const OPERATOR_ROLE = await loan.OPERATOR_ROLE();
    await (await loan.grantRole(OPERATOR_ROLE, operator.address)).wait();
    const ROUTER_OPERATOR_ROLE = await router.OPERATOR_ROLE();
    await (await router.grantRole(ROUTER_OPERATOR_ROLE, operator.address)).wait();

    await (await oracle.setOracleData(1, ethers.parseEther("20"), 10, true, true, 0)).wait();
    await (await oracle.setScores(1, 9000, 8500, 8000)).wait();
    await (await oracle.setAppraisalCeiling(1, ethers.parseEther("30"))).wait();

    await (await vault.lockMintRight(1, 0, admin.address)).wait();

    await admin.sendTransaction({
      to: await loan.getAddress(),
      value: ethers.parseEther("50"),
    });

    await (await router.setBeneficiary(1, user.address)).wait();

    return { admin, operator, reserve, user, oracle, vault, loan, router, debtToken };
  }

  it("calculates dynamic max LTV tiers from volatility", async function () {
    const { oracle } = await deployFixture();

    await (await oracle.setVolatility(15)).wait();
    expect(await oracle.getDynamicLTV(1)).to.equal(7000);

    await (await oracle.setVolatility(45)).wait();
    expect(await oracle.getDynamicLTV(1)).to.equal(6000);

    await (await oracle.setVolatility(90)).wait();
    expect(await oracle.getDynamicLTV(1)).to.equal(4000);
  });

  it("enforces LTV cap and updates debt token + debt balance", async function () {
    const { operator, loan, debtToken, vault } = await deployFixture();

    await expect(
      loan.connect(operator).borrow(1, 0, ethers.parseEther("25"))
    ).to.be.revertedWith("LTV cap exceeded");

    await expect(loan.connect(operator).borrow(1, 0, ethers.parseEther("10")))
      .to.emit(loan, "Borrowed");

    const position = await loan.positions(1);
    expect(position.debt).to.equal(ethers.parseEther("10"));

    const locker = await vault.lockedBy(1);
    expect(await debtToken.balanceOf(locker)).to.equal(ethers.parseEther("10"));
  });

  it("triggers panic mode when oracle reports risk", async function () {
    const { loan, oracle } = await deployFixture();

    await (await oracle.setProvenance(1, false)).wait();
    await expect(loan.checkAndUpdatePanic(1)).to.emit(loan, "PanicTriggered").withArgs(1);

    const position = await loan.positions(1);
    expect(position.inPanic).to.equal(true);
  });

  it("liquidates when LTV exceeds oracle-driven threshold", async function () {
    const { operator, loan, oracle } = await deployFixture();

    await (await loan.connect(operator).borrow(1, 0, ethers.parseEther("9"))).wait();

    await (await oracle.setVolatility(95)).wait();
    await (await oracle.updateValue(1, ethers.parseEther("10"))).wait();

    await expect(loan.checkAndLiquidate(1)).to.emit(loan, "Liquidated");

    const position = await loan.positions(1);
    expect(position.debt).to.equal(0);
    expect(position.liquidated).to.equal(true);
  });

  it("routes revenue with 70% debt and 30% beneficiary in normal mode", async function () {
    const { operator, user, loan, router } = await deployFixture();

    await (await loan.connect(operator).borrow(1, 0, ethers.parseEther("5"))).wait();

    const userBefore = await ethers.provider.getBalance(user.address);

    await expect(
      router.connect(operator).depositRevenue(1, { value: ethers.parseEther("2") })
    )
      .to.emit(router, "RevenueProcessed")
      .withArgs(1, ethers.parseEther("2"));

    const userAfter = await ethers.provider.getBalance(user.address);
    const debtAfter = await loan.outstandingDebt(1);

    expect(debtAfter).to.equal(ethers.parseEther("3.6"));
    expect(userAfter - userBefore).to.equal(ethers.parseEther("0.6"));
  });
});
