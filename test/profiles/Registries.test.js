const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Profile registries — append-only behavior", () => {
    describe("PosterProfileRegistry", () => {
        let reg;
        beforeEach(async () => {
            const F = await ethers.getContractFactory("PosterProfileRegistry");
            reg = await F.deploy();
            await reg.waitForDeployment();
        });

        it("registers and returns increasing entryIds", async () => {
            const [a, b] = await ethers.getSigners();
            const tx1 = await reg.connect(a).registerProfile("alice v1");
            await tx1.wait();
            const tx2 = await reg.connect(b).registerProfile("bob v1");
            const r = await tx2.wait();
            const log = r.logs.find((l) => l.fragment && l.fragment.name === "ProfileRegistered");
            expect(log.args.entryId).to.equal(1n);
            expect(log.args.owner).to.equal(b.address);
        });

        it("returns historical entries by id", async () => {
            const [a] = await ethers.getSigners();
            await reg.connect(a).registerProfile("v1 content");
            await reg.connect(a).registerProfile("v2 content");
            const p0 = await reg.getProfile(0);
            const p1 = await reg.getProfile(1);
            expect(p0.content).to.equal("v1 content");
            expect(p1.content).to.equal("v2 content");
            expect(p0.contentHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes("v1 content")));
        });

        it("entries are immutable (no setters exist)", async () => {
            const iface = reg.interface;
            const fns = iface.fragments.filter((f) => f.type === "function").map((f) => f.name);
            expect(fns).to.have.members(["registerProfile", "getProfile", "entryCount"]);
        });
    });

    describe("ChallengerProfileRegistry", () => {
        it("mirrors poster registry behavior", async () => {
            const F = await ethers.getContractFactory("ChallengerProfileRegistry");
            const reg = await F.deploy();
            await reg.waitForDeployment();
            const [a] = await ethers.getSigners();
            await reg.connect(a).registerProfile("challenger profile");
            expect(await reg.entryCount()).to.equal(1n);
        });
    });

    describe("JudgeProfileRegistryV6", () => {
        let reg;
        let judgeAddr;
        beforeEach(async () => {
            const F = await ethers.getContractFactory("JudgeProfileRegistryV6");
            reg = await F.deploy();
            await reg.waitForDeployment();
            const J = await ethers.getContractFactory("TestAcceptJudgeV6");
            const j = await J.deploy();
            await j.waitForDeployment();
            judgeAddr = await j.getAddress();
        });

        it("requires a non-zero judge contract address", async () => {
            const [a] = await ethers.getSigners();
            await expect(
                reg.connect(a).registerProfile(ethers.ZeroAddress, "x")
            ).to.be.revertedWith("Zero judge");
        });

        it("stores judgeContract alongside content", async () => {
            const [a] = await ethers.getSigners();
            const tx = await reg.connect(a).registerProfile(judgeAddr, "I judge by rule X");
            const r = await tx.wait();
            const log = r.logs.find((l) => l.fragment && l.fragment.name === "ProfileRegistered");
            expect(log.args.entryId).to.equal(0n);
            expect(log.args.judgeContract).to.equal(judgeAddr);

            const p = await reg.getProfile(0);
            expect(p.judgeContract).to.equal(judgeAddr);
            expect(p.content).to.equal("I judge by rule X");
        });

        it("returns frozen historical entries (append-only)", async () => {
            const [a] = await ethers.getSigners();
            await reg.connect(a).registerProfile(judgeAddr, "v1");
            await reg.connect(a).registerProfile(judgeAddr, "v2");
            const p0 = await reg.getProfile(0);
            const p1 = await reg.getProfile(1);
            expect(p0.content).to.equal("v1");
            expect(p1.content).to.equal("v2");
        });
    });
});
