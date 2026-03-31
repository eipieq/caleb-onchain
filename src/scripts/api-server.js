// api server for the frontend dashboard
// run with: node src/scripts/api-server.js

import "dotenv/config";
import { createServer } from "http";
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

import { ChainClient } from "../chain/client.js";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, "../../sessions");
const POLICY_FILE  = join(__dirname, "../../policy.json");
const PORT         = parseInt(process.env.API_PORT || "4000");

const chain = new ChainClient({
  rpcUrl:          process.env.INITIA_RPC_URL,
  privateKey:      process.env.PRIVATE_KEY,
  contractAddress: process.env.DECISION_LOG_ADDRESS,
});

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function loadSessions() {
  try {
    return readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8")))
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

function loadSession(id) {
  try {
    return JSON.parse(readFileSync(join(SESSIONS_DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

function hashPayload(payload) {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  return ethers.keccak256(ethers.toUtf8Bytes(json));
}

const STEP_KINDS = ["POLICY", "MARKET", "DECISION", "CHECK", "EXECUTION"];

async function recoverSession(sessionId) {
  // fetch StepCommitted events filtered by sessionId from chain
  const filter = chain.contract.filters.StepCommitted(sessionId);
  const events  = await chain.contract.queryFilter(filter, 0, "latest");

  if (events.length === 0) return { error: "no events found for session" };

  // fetch session metadata
  const meta = await chain.getSession(sessionId);

  const steps = events
    .sort((a, b) => Number(a.args.stepIndex) - Number(b.args.stepIndex))
    .map((e) => ({
      kind:        STEP_KINDS[Number(e.args.stepKind)] ?? String(e.args.stepKind),
      payload:     JSON.parse(e.args.payload),
      dataHash:    e.args.dataHash,
      txHash:      e.transactionHash,
      blockNumber: e.blockNumber,
    }));

  // extract verdict info from DECISION step
  const decision = steps.find((s) => s.kind === "DECISION");

  const record = {
    sessionId,
    agent:      meta.agent,
    startedAt:  Number(meta.startedAt),
    finalized:  meta.finalized,
    steps,
    verdict:    decision?.payload?.verdict ?? null,
    confidence: decision?.payload?.confidence ?? 0,
    token:      decision?.payload?.token ?? null,
    reasoning:  decision?.payload?.reasoning ?? "",
  };

  // save to disk so subsequent API calls can serve it
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(join(SESSIONS_DIR, `${sessionId}.json`), JSON.stringify(record, null, 2));

  return { recovered: true, sessionId, stepsRecovered: steps.length };
}

async function verifySession(sessionId) {
  const record = loadSession(sessionId);
  if (!record) return { error: "session not found", allPassed: false };

  const steps = [];
  let allPassed = true;

  for (let i = 0; i < record.steps.length; i++) {
    const localHash = hashPayload(record.steps[i].payload);
    try {
      const onChain = await chain.getStep(record.sessionId, i);
      const match   = localHash.toLowerCase() === onChain.dataHash.toLowerCase();
      steps.push({ index: i, match, localHash, onChainHash: onChain.dataHash });
      if (!match) allPassed = false;
    } catch (err) {
      steps.push({ index: i, match: false, error: err.message });
      allPassed = false;
    }
  }

  return { sessionId, allPassed, steps };
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST" });
    res.end();
    return;
  }

  if (req.method === "GET" && url === "/api/sessions") return json(res, loadSessions());

  const sessionMatch = url.match(/^\/api\/sessions\/([^/]+)$/);
  if (req.method === "GET" && sessionMatch) {
    const record = loadSession(sessionMatch[1]);
    return record ? json(res, record) : json(res, { error: "not found" }, 404);
  }

  const verifyMatch = url.match(/^\/api\/verify\/([^/]+)$/);
  if (req.method === "GET" && verifyMatch) return json(res, await verifySession(verifyMatch[1]));

  const recoverMatch = url.match(/^\/api\/recover\/([^/]+)$/);
  if (req.method === "POST" && recoverMatch) {
    try {
      return json(res, await recoverSession(recoverMatch[1]));
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  const attestationsMatch = url.match(/^\/api\/attestations\/([^/]+)$/);
  if (req.method === "GET" && attestationsMatch) {
    try {
      const attestations = await chain.getAttestations(attestationsMatch[1]);
      return json(res, { sessionId: attestationsMatch[1], attestations, count: attestations.length });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  if (req.method === "GET" && url === "/api/policy") {
    try {
      return json(res, JSON.parse(readFileSync(POLICY_FILE, "utf8")));
    } catch {
      return json(res, {});
    }
  }

  if (req.method === "POST" && url === "/api/policy") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        writeFileSync(POLICY_FILE, JSON.stringify(JSON.parse(body), null, 2));
        return json(res, { ok: true });
      } catch {
        return json(res, { error: "invalid JSON" }, 400);
      }
    });
    return;
  }

  json(res, { error: "not found" }, 404);
});

async function autoRecover() {
  try {
    const sessionIds = await chain.getAllSessionIds();
    let recovered = 0;
    for (const id of sessionIds) {
      const file = join(SESSIONS_DIR, `${id}.json`);
      if (!existsSync(file)) {
        await recoverSession(id);
        recovered++;
      }
    }
    if (recovered > 0) console.log(`auto-recovered ${recovered} session(s) from chain`);
  } catch (err) {
    console.error("auto-recover failed:", err.message);
  }
}

server.listen(PORT, async () => {
  console.log(`api server on http://localhost:${PORT}`);
  await autoRecover();
});
