// MockSUSDS exposes a 1:1 ERC-4626 surface for the v0.6 frontend's USD↔sUSDS
// conversion code path. Real mainnet sUSDS grows over time; the mock stays
// flat so e2e/local tests can reason in either unit.

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockSUSDS — 4626 surface", () => {
    let token;
    beforeEach(async () => {
        const F = await ethers.getContractFactory("MockSUSDS");
        token = await F.deploy("Mock sUSDS", "msUSDS");
        await token.waitForDeployment();
    });

    it("convertToShares is the identity at 1:1", async () => {
        const cases = [0n, 1n, ethers.parseEther("1"), ethers.parseEther("12345.6789")];
        for (const a of cases) {
            const shares = await token.convertToShares(a);
            expect(shares, `convertToShares(${a})`).to.equal(a);
        }
    });

    it("convertToAssets is the identity at 1:1", async () => {
        const cases = [0n, 1n, ethers.parseEther("1"), ethers.parseEther("987.654321")];
        for (const s of cases) {
            const assets = await token.convertToAssets(s);
            expect(assets, `convertToAssets(${s})`).to.equal(s);
        }
    });

    it("convertToShares is a pure view (no state change)", async () => {
        const [user] = await ethers.getSigners();
        const balBefore = await token.balanceOf(user.address);
        await token.convertToShares(ethers.parseEther("42"));
        expect(await token.balanceOf(user.address)).to.equal(balBefore);
    });
});
