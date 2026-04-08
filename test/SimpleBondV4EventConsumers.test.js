const { expect } = require("chai");
const { ethers } = require("hardhat");
const { readFileSync } = require("fs");
const { resolve } = require("path");

const FRONTEND_PATH = resolve(__dirname, "..", "frontend", "index.html");
const BACKEND_CONFIG_PATH = resolve(__dirname, "..", "backend", "config.mjs");

const DETAILED_BOND_CREATED_SIGNATURE =
  "BondCreated(uint256,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,string)";
const LIGHTWEIGHT_BOND_CREATED_SIGNATURE =
  "BondCreated(uint256,address,address,uint256)";
const DETAILED_BOND_CREATED_EVENT_FRAGMENT =
  "event BondCreated(uint256 indexed bondId, address indexed poster, address indexed judge, address token, uint256 bondAmount, uint256 challengeAmount, uint256 judgeFee, uint256 deadline, uint256 acceptanceDelay, uint256 rulingBuffer, string metadata)";
const LIGHTWEIGHT_BOND_CREATED_EVENT_FRAGMENT =
  "event BondCreated(uint256 indexed bondId, address indexed poster, address token, uint256 amount)";
const DETAILED_BOND_CREATED_TOPIC = ethers.id(DETAILED_BOND_CREATED_SIGNATURE);

function indexedAddressTopic(addr) {
  if (!addr) return null;
  return ethers.zeroPadValue(ethers.getAddress(addr), 32);
}

function parseDetailedBondCreatedLog(iface, log) {
  if (!log?.topics || log.topics[0] !== DETAILED_BOND_CREATED_TOPIC) return null;
  try {
    return iface.parseLog({ topics: log.topics, data: log.data });
  } catch (_) {
    return null;
  }
}

function maybeParseLog(iface, log) {
  try {
    return iface.parseLog({ topics: log.topics, data: log.data });
  } catch (_) {
    return null;
  }
}

function encodeLog(iface, signature, args) {
  const fragment = iface.getEvent(signature);
  const { topics, data } = iface.encodeEventLog(fragment, args);
  return { topics, data };
}

describe("SimpleBondV4 event consumers", function () {
  const frontendSource = readFileSync(FRONTEND_PATH, "utf8");
  const backendSource = readFileSync(BACKEND_CONFIG_PATH, "utf8");
  const encoderIface = new ethers.Interface([
    DETAILED_BOND_CREATED_EVENT_FRAGMENT,
    LIGHTWEIGHT_BOND_CREATED_EVENT_FRAGMENT,
  ]);

  const detailedIface = new ethers.Interface([DETAILED_BOND_CREATED_EVENT_FRAGMENT]);
  const backendIface = new ethers.Interface([DETAILED_BOND_CREATED_EVENT_FRAGMENT]);

  const poster = ethers.getAddress("0x1000000000000000000000000000000000000001");
  const judge = ethers.getAddress("0x2000000000000000000000000000000000000002");
  const token = ethers.getAddress("0x3000000000000000000000000000000000000003");

  const detailedArgs = [
    7n,
    poster,
    judge,
    token,
    1000n,
    300n,
    50n,
    1700000000n,
    86400n,
    604800n,
    "Detailed create event",
  ];
  const lightweightArgs = [7n, poster, token, 1000n];

  const detailedLog = encodeLog(encoderIface, DETAILED_BOND_CREATED_SIGNATURE, detailedArgs);
  const lightweightLog = encodeLog(encoderIface, LIGHTWEIGHT_BOND_CREATED_SIGNATURE, lightweightArgs);

  it("pins frontend create-log handling to the detailed BondCreated signature", function () {
    expect(frontendSource).to.include(DETAILED_BOND_CREATED_SIGNATURE);
    expect(frontendSource).to.include(
      "const DETAILED_BOND_CREATED_TOPIC = ethers.id(DETAILED_BOND_CREATED_SIGNATURE);"
    );
    expect(frontendSource).to.include(
      "if (!log?.topics || log.topics[0] !== DETAILED_BOND_CREATED_TOPIC) return null;"
    );
    expect(frontendSource).to.include(`topics: [
      DETAILED_BOND_CREATED_TOPIC,
      null,
      indexedAddressTopic(poster),
      indexedAddressTopic(judge),
    ],`);
    expect(frontendSource).to.not.include("filters.BondCreated(");
  });

  it("accepts the detailed BondCreated log and rejects the lightweight overload in the frontend path", function () {
    const parsed = parseDetailedBondCreatedLog(detailedIface, detailedLog);

    expect(parsed).to.not.equal(null);
    expect(parsed.name).to.equal("BondCreated");
    expect(parsed.args.bondId).to.equal(7n);
    expect(parsed.args.poster).to.equal(poster);
    expect(parsed.args.judge).to.equal(judge);
    expect(parsed.args.token).to.equal(token);
    expect(detailedLog.topics[2]).to.equal(indexedAddressTopic(poster));
    expect(detailedLog.topics[3]).to.equal(indexedAddressTopic(judge));

    expect(parseDetailedBondCreatedLog(detailedIface, lightweightLog)).to.equal(null);
  });

  it("keeps the backend ABI on the detailed BondCreated event only", function () {
    expect(backendSource).to.include(DETAILED_BOND_CREATED_EVENT_FRAGMENT);
    expect(backendSource).to.not.include(LIGHTWEIGHT_BOND_CREATED_EVENT_FRAGMENT);
    expect(backendSource).to.include("BondCreated:        ['judge']");

    const parsed = maybeParseLog(backendIface, detailedLog);

    expect(parsed).to.not.equal(null);
    expect(parsed.name).to.equal("BondCreated");
    expect(parsed.args.bondId).to.equal(7n);
    expect(parsed.args.judge).to.equal(judge);
    expect(maybeParseLog(backendIface, lightweightLog)).to.equal(null);
  });
});
