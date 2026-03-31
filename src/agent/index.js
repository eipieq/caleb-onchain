import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

// Sessions must be saved alongside the API server so the dashboard can read them.
// If running locally with a remote RPC, sessions would commit to the right chain
// but save to the wrong place. Bail early to avoid silent data loss.
if (process.env.INITIA_RPC_URL?.includes("64.227.139.172") && process.env.HOME?.startsWith("/Users")) {
  console.error("Run the agent on the VPS, not locally. SSH in or use the DO console.");
  console.error("  ssh root@64.227.139.172 'cd /root/caleb-onchain && node src/agent/index.js'");
  process.exit(1);
}

import { ChainClient, STEP_KIND } from "../chain/client.js";
import { fetchMarketData } from "../market/index.js";
import { getAiDecision } from "../venice/index.js";
import { runPolicyCheck } from "../policy/index.js";
import { executeSwap } from "../market/swap.js";
import { DEFAULT_POLICY } from "./policy.js";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, "../../sessions");

function log(step, msg) {
  const labels = ["POLICY", "MARKET", "DECISION", "CHECK", "EXECUTION"];
  const colors = [chalk.cyan, chalk.blue, chalk.magenta, chalk.yellow, chalk.green];
  const label  = step === -1 ? chalk.white("SESSION") : colors[step](`STEP ${step} ${labels[step]}`);
  console.log(`${chalk.gray(new Date().toISOString())}  ${label}  ${msg}`);
}

function saveSession(sessionId, record) {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
  const path = join(SESSIONS_DIR, `${sessionId}.json`);
  writeFileSync(path, JSON.stringify(record, null, 2));
  return path;
}

async function runCycle(policy = DEFAULT_POLICY) {
  const chain = new ChainClient({
    rpcUrl:          process.env.INITIA_RPC_URL,
    privateKey:      process.env.PRIVATE_KEY,
    contractAddress: process.env.DECISION_LOG_ADDRESS,
  });

  const now       = Math.floor(Date.now() / 1000);
  const sessionId = ChainClient.makeSessionId(chain.address, now);
  const record    = { sessionId, agent: chain.address, startedAt: now, steps: [] };

  log(-1, `starting session ${sessionId}`);
  const sessionTx = await chain.startSession(sessionId);
  log(-1, `session started — tx ${sessionTx.txHash}`);

  // step 0: policy
  const policyPayload = { ...policy, sessionId, timestamp: now };
  const step0 = await chain.commitStep(sessionId, STEP_KIND.POLICY, policyPayload);
  record.steps.push({ kind: "POLICY", payload: policyPayload, ...step0 });
  log(0, `committed — hash ${step0.dataHash}  tx ${step0.txHash}`);

  // step 1: market data
  const market = await fetchMarketData(policy.allowedTokens);
  const step1  = await chain.commitStep(sessionId, STEP_KIND.MARKET, market);
  record.steps.push({ kind: "MARKET", payload: market, ...step1 });
  log(1, `committed — hash ${step1.dataHash}  tx ${step1.txHash}`);

  // step 2: AI decision
  const ai    = await getAiDecision(market, policy);
  const step2 = await chain.commitStep(sessionId, STEP_KIND.DECISION, ai);
  record.steps.push({ kind: "DECISION", payload: ai, ...step2 });
  log(2, `${ai.verdict} (confidence ${ai.confidence}) — tx ${step2.txHash}`);
  log(2, ai.reasoning);

  // step 3: policy check
  const check  = await runPolicyCheck(ai, market, policy, record.steps);
  const step3  = await chain.commitStep(sessionId, STEP_KIND.CHECK, check);
  record.steps.push({ kind: "CHECK", payload: check, ...step3 });
  log(3, `passed=${check.passed}  blocked=${check.blockedBy ?? "none"}`);

  // step 4: execution
  const exec  = await executeSwap(ai, check, market, policy);
  const step4 = await chain.commitStep(sessionId, STEP_KIND.EXECUTION, exec);
  record.steps.push({ kind: "EXECUTION", payload: exec, ...step4 });

  if (exec.executed) {
    log(4, chalk.green(`swap executed — ${exec.summary}  tx ${step4.txHash}`));
  } else {
    log(4, chalk.yellow(`skipped — ${exec.reason}  tx ${step4.txHash}`));
  }

  const finalizeTx = await chain.finalizeSession(sessionId);
  record.finalized  = true;
  record.finalizedAt = Math.floor(Date.now() / 1000);
  record.finalizeTx  = finalizeTx.txHash;

  const file = saveSession(sessionId, record);
  log(-1, chalk.bold(`session finalized — ${finalizeTx.txHash}`));
  log(-1, `saved to ${file}`);
  log(-1, `run: npm run verify -- --session ${sessionId}`);

  return record;
}

runCycle().catch((err) => {
  console.error(chalk.red("agent cycle failed:"), err);
  process.exitCode = 1;
});
