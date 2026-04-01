/**
 * @file chain/client.js
 * Thin EVM wrapper around the DecisionLog smart contract.
 *
 * Every agent session is a sequence of exactly 5 on-chain commits:
 *   POLICY (0) → MARKET (1) → DECISION (2) → CHECK (3) → EXECUTION (4)
 *
 * Each step stores a keccak256 hash of its JSON payload. The hash is computed
 * deterministically (sorted keys) so the verify script can recompute it
 * offline and compare against the on-chain value to prove the local record
 * was not tampered with after the fact.
 *
 * The contract also supports peer attestations — third-party addresses can
 * call attest() to publicly vouch for a session's integrity.
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MINIMAL_ABI = [
  "function startSession(bytes32 sessionId) external",
  "function commitStep(bytes32 sessionId, uint8 kind, bytes32 dataHash, string calldata payload) external",
  "function finalizeSession(bytes32 sessionId) external",
  "function getStep(bytes32 sessionId, uint256 stepIndex) external view returns (uint8 kind, bytes32 dataHash, uint256 timestamp, address agent)",
  "function getSession(bytes32 sessionId) external view returns (address agent, uint256 startedAt, uint256 stepCount, bool finalized)",
  "function sessionCount(address agent) external view returns (uint256)",
  "function attest(bytes32 sessionId) external",
  "function getAttestationCount(bytes32 sessionId) external view returns (uint256)",
  "function getAttestation(bytes32 sessionId, uint256 index) external view returns (address attester, uint256 timestamp)",
  "function hasAttested(bytes32 sessionId, address attester) external view returns (bool)",
  "event StepCommitted(bytes32 indexed sessionId, address indexed agent, uint8 stepKind, uint256 stepIndex, bytes32 dataHash, uint256 timestamp, string payload)",
  "event Attested(bytes32 indexed sessionId, address indexed attester, uint256 timestamp)",
];

function loadAbi() {
  const path = join(__dirname, "../../artifacts/contracts/DecisionLog.sol/DecisionLog.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")).abi;
  } catch {
    return MINIMAL_ABI;
  }
}

/**
 * Numeric step kinds as expected by the DecisionLog contract.
 * Must stay in sync with the `StepKind` enum in DecisionLog.sol.
 */
export const STEP_KIND = {
  POLICY:    0,
  MARKET:    1,
  DECISION:  2,
  CHECK:     3,
  EXECUTION: 4,
};

export class ChainClient {
  /**
   * @param {object} opts
   * @param {string} opts.rpcUrl          - Initia EVM JSON-RPC endpoint
   * @param {string} opts.privateKey      - Agent wallet private key (hex, with 0x prefix)
   * @param {string} opts.contractAddress - Deployed DecisionLog contract address
   */
  constructor({ rpcUrl, privateKey, contractAddress }) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet   = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(contractAddress, loadAbi(), this.wallet);
  }

  /**
   * Deterministic session ID: keccak256(abi.encode(agentAddress, timestamp)).
   * Using the agent address means session IDs are scoped per wallet, avoiding
   * collisions when multiple agents share the same contract.
   */
  static makeSessionId(agentAddress, timestamp) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [agentAddress, timestamp])
    );
  }

  /**
   * Canonical payload hash used by both the agent (when committing) and the
   * verifier (when auditing). Keys are sorted alphabetically before
   * serialisation so the hash is stable regardless of object insertion order.
   *
   * @param {object} payload - Step payload object
   * @returns {string} 0x-prefixed keccak256 hex string
   */
  static hashPayload(payload) {
    const json = JSON.stringify(payload, Object.keys(payload).sort());
    return ethers.keccak256(ethers.toUtf8Bytes(json));
  }

  async startSession(sessionId) {
    const tx = await this.contract.startSession(sessionId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async commitStep(sessionId, kind, payload) {
    const dataHash = ChainClient.hashPayload(payload);
    const payloadJson = JSON.stringify(payload, Object.keys(payload).sort());
    const tx = await this.contract.commitStep(sessionId, kind, dataHash, payloadJson);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber, dataHash };
  }

  async finalizeSession(sessionId) {
    const tx = await this.contract.finalizeSession(sessionId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
  }

  async getStep(sessionId, stepIndex) {
    return this.contract.getStep(sessionId, stepIndex);
  }

  async getSession(sessionId) {
    return this.contract.getSession(sessionId);
  }

  async getAttestationCount(sessionId) {
    return this.contract.getAttestationCount(sessionId);
  }

  async getAllSessionIds() {
    const filter = this.contract.filters.SessionStarted();
    const events = await this.contract.queryFilter(filter, 0, "latest");
    return events.map((e) => e.args.sessionId);
  }

  async getAttestations(sessionId) {
    const count = Number(await this.contract.getAttestationCount(sessionId));
    const attestations = [];
    for (let i = 0; i < count; i++) {
      const [attester, timestamp] = await this.contract.getAttestation(sessionId, i);
      attestations.push({ attester, timestamp: Number(timestamp) });
    }
    return attestations;
  }

  get address() {
    return this.wallet.address;
  }
}
