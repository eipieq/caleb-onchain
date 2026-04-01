/**
 * @file verify/index.js
 * Offline verification tool — proves the local session records match what is
 * stored on-chain.
 *
 * For each step in a session file the verifier:
 *   1. Recomputes keccak256(canonicalJSON(payload)) locally.
 *   2. Fetches the stored hash from the DecisionLog contract.
 *   3. Compares the two. A mismatch means the local file was altered after
 *      the session was committed — a clear sign of tampering.
 *
 * Usage:
 *   npm run verify                          # verify all sessions
 *   npm run verify -- --session <sessionId> # verify one session
 *
 * Exit code 0 = all hashes matched. Non-zero = at least one mismatch.
 */

import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import chalk from "chalk";

import { ChainClient } from "../chain/client.js";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, "../../sessions");
const STEP_NAMES   = ["POLICY", "MARKET", "DECISION", "CHECK", "EXECUTION"];

function recomputeHash(payload) {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  return ethers.keccak256(ethers.toUtf8Bytes(json));
}

async function verifySession(sessionId, chain) {
  const record = JSON.parse(readFileSync(join(SESSIONS_DIR, `${sessionId}.json`), "utf8"));

  console.log(chalk.bold(`\nverifying session ${sessionId}`));
  console.log(chalk.gray("─".repeat(72)));

  let allPassed = true;

  for (let i = 0; i < record.steps.length; i++) {
    const step      = record.steps[i];
    const name      = STEP_NAMES[i] ?? `STEP_${i}`;
    const localHash = recomputeHash(step.payload);

    let onChainHash;
    try {
      onChainHash = (await chain.getStep(record.sessionId, i)).dataHash;
    } catch (err) {
      console.log(chalk.red(`  ✗ [${name}]  error: ${err.message}`));
      allPassed = false;
      continue;
    }

    const match = localHash.toLowerCase() === onChainHash.toLowerCase();

    if (match) {
      console.log(
        chalk.green(`  ✓ [${name}]`) +
        chalk.gray(` ${localHash.slice(0, 18)}…  tx ${step.txHash?.slice(0, 18)}…`)
      );
    } else {
      console.log(
        chalk.red(`  ✗ [${name}]  hash mismatch`) +
        `\n    local:    ${localHash}` +
        `\n    on-chain: ${onChainHash}`
      );
      allPassed = false;
    }
  }

  console.log(chalk.gray("─".repeat(72)));
  console.log(
    allPassed
      ? chalk.green(chalk.bold("  verified — all hashes match"))
      : chalk.red(chalk.bold("  tampered — hash mismatch detected"))
  );

  return allPassed;
}

async function main() {
  const args          = process.argv.slice(2);
  const idx           = args.indexOf("--session");
  const targetSession = idx !== -1 ? args[idx + 1] : null;

  const chain = new ChainClient({
    rpcUrl:          process.env.INITIA_RPC_URL,
    privateKey:      process.env.PRIVATE_KEY,
    contractAddress: process.env.DECISION_LOG_ADDRESS,
  });

  if (targetSession) {
    const passed = await verifySession(targetSession, chain);
    process.exitCode = passed ? 0 : 1;
    return;
  }

  const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log(chalk.yellow("no session files found — run the agent first"));
    return;
  }

  let allPassed = true;
  for (const file of files) {
    const passed = await verifySession(file.replace(".json", ""), chain);
    if (!passed) allPassed = false;
  }

  process.exitCode = allPassed ? 0 : 1;
}

main().catch((err) => {
  console.error(chalk.red("verify failed:"), err);
  process.exitCode = 1;
});
