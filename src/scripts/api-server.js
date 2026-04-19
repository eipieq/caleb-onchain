/**
 * @file scripts/api-server.js
 * Lightweight HTTP API that bridges the frontend dashboard to session files
 * and the DecisionLog contract. No framework dependencies — plain Node http.
 *
 * Endpoints:
 *   GET  /api/sessions               — list all sessions (newest first)
 *   GET  /api/sessions/:id           — fetch one session by ID
 *   GET  /api/verify/:id             — recompute & compare hashes vs on-chain
 *   POST /api/recover/:id            — rebuild session from on-chain events (if local file missing)
 *   GET  /api/attestations/:id       — list third-party attestations for a session
 *   GET  /api/policy                 — read the current runtime policy override
 *   POST /api/policy                 — write a new runtime policy override
 *   GET  /api/portfolio              — current portfolio state (balance, holdings, P&L)
 *
 * On startup, autoRecover() scans the contract for sessions that have no
 * corresponding local file and rebuilds them from StepCommitted events.
 * This means redeploying or clearing the sessions/ directory is non-destructive
 * as long as the chain data is intact.
 *
 * Run with: node src/scripts/api-server.js
 */

import "dotenv/config";
import { createServer } from "http";
import { gzipSync } from "zlib";
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { fetchMarketData }    from "../market/index.js";
import { getSimulatedPrices } from "../market/mock.js";

const SIMULATED = process.env.SIMULATE === "true";

// price cache — refresh at most once per 60s to avoid rate limits
const priceCache = { prices: {}, fetchedAt: 0 };
const PRICE_TTL_S = 60;

async function getLivePrices(tokens) {
  const now = Math.floor(Date.now() / 1000);
  if (now - priceCache.fetchedAt < PRICE_TTL_S && Object.keys(priceCache.prices).length > 0) {
    return priceCache.prices;
  }
  try {
    const { prices } = await fetchMarketData(tokens);
    if (Object.keys(prices).length > 0) {
      priceCache.prices = prices;
      priceCache.fetchedAt = now;
    }
  } catch {}
  return priceCache.prices;
}

import { ChainClient } from "../chain/client.js";

const __dirname       = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR    = join(__dirname, "../../sessions");
const POLICY_FILE     = join(__dirname, "../../policy.json");
const POLICIES_DIR    = join(__dirname, "../../data/policies");
const PORTFOLIO_FILE  = join(__dirname, "../../data/portfolio.json");
const PORT         = parseInt(process.env.API_PORT || "4000");

const chain = new ChainClient({
  rpcUrl:          process.env.INITIA_RPC_URL,
  privateKey:      process.env.PRIVATE_KEY,
  contractAddress: process.env.DECISION_LOG_ADDRESS,
});

function json(res, data, status = 200, req = null) {
  const body = JSON.stringify(data);
  const acceptGzip = req?.headers?.["accept-encoding"]?.includes("gzip");
  if (acceptGzip && body.length > 1024) {
    const compressed = gzipSync(body);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Encoding": "gzip", "Access-Control-Allow-Origin": "*" });
    res.end(compressed);
  } else {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(body);
  }
}

// in-memory cache — tracks file mtimes so modified files get re-read
let sessionCache = null;
let sessionCacheMtimes = new Map(); // filename -> mtimeMs
let sessionCacheMap = new Map();    // filename -> parsed session

function buildCache() {
  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
    sessionCacheMap = new Map();
    sessionCacheMtimes = new Map();
    for (const f of files) {
      const path = join(SESSIONS_DIR, f);
      const mtime = statSync(path).mtimeMs;
      sessionCacheMap.set(f, JSON.parse(readFileSync(path, "utf8")));
      sessionCacheMtimes.set(f, mtime);
    }
    sessionCache = [...sessionCacheMap.values()].sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    sessionCache = [];
    sessionCacheMap = new Map();
    sessionCacheMtimes = new Map();
  }
}

function loadSessions(limit = 0) {
  if (!sessionCache) { buildCache(); return limit > 0 ? sessionCache.slice(0, limit) : sessionCache; }
  // check for new or modified files
  let dirty = false;
  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const path = join(SESSIONS_DIR, f);
      const mtime = statSync(path).mtimeMs;
      if (!sessionCacheMtimes.has(f) || sessionCacheMtimes.get(f) !== mtime) {
        sessionCacheMap.set(f, JSON.parse(readFileSync(path, "utf8")));
        sessionCacheMtimes.set(f, mtime);
        dirty = true;
      }
    }
  } catch {}
  if (dirty) {
    sessionCache = [...sessionCacheMap.values()].sort((a, b) => b.startedAt - a.startedAt);
    slimCacheDirty = true;
  }
  return limit > 0 ? sessionCache.slice(0, limit) : sessionCache;
}

// pre-computed slim + gzipped response cache — avoids re-serializing 5000 sessions per request
let slimCache = null;
let slimCacheGzip = null;

function slimSession(s) {
  return {
    sessionId: s.sessionId, agent: s.agent, startedAt: s.startedAt,
    strategy: s.strategy, finalized: s.finalized, committed: s.committed,
    steps: (s.steps || []).map((st) => ({
      kind: st.kind, hash: st.dataHash ?? st.hash, txHash: st.txHash,
      ...(st.kind === "DECISION" && st.payload ? { payload: {
        verdict: st.payload.verdict, confidence: st.payload.confidence,
        token: st.payload.token, strategy: st.payload.strategy,
        amountUsd: st.payload.amountUsd, reasoning: st.payload.reasoning,
      }} : {}),
    })),
  };
}

function getSlimSessions(limit) {
  const sessions = loadSessions(limit);
  // rebuild slim cache if dirty
  if (!slimCache || slimCacheDirty) {
    slimCache = sessions.map(slimSession);
    slimCacheGzip = gzipSync(JSON.stringify(slimCache));
    slimCacheDirty = false;
  }
  if (limit > 0 && limit < slimCache.length) {
    return { items: slimCache.slice(0, limit), gzip: null };
  }
  return { items: slimCache, gzip: slimCacheGzip };
}

let slimCacheDirty = true;

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

/**
 * Rebuild a session record from on-chain StepCommitted events.
 * Used when the local sessions/ file is missing (e.g. after a redeploy).
 * The recovered record is written to disk so subsequent reads are fast.
 *
 * @param {string} sessionId - 0x-prefixed bytes32 session ID
 */
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

  if (req.method === "GET" && url.match(/^\/api\/sessions(\?.*)?$/) && !url.match(/^\/api\/sessions\//)) {
    const params = new URL(url, "http://x").searchParams;
    const MAX_SLIM = 2000; // cap slim responses — 5000+ sessions is 6MB+ and times out Vercel
    const limit = parseInt(params.get("limit") || "0");
    const full = params.get("full") === "1";
    if (full) {
      return json(res, loadSessions(limit), 200, req);
    }
    const effectiveLimit = limit > 0 ? Math.min(limit, MAX_SLIM) : MAX_SLIM;
    // slim + pre-computed gzip — avoids re-serializing thousands of sessions per request
    const { items, gzip } = getSlimSessions(effectiveLimit);
    const acceptGzip = req.headers["accept-encoding"]?.includes("gzip");
    if (acceptGzip && gzip && (!limit || limit >= items.length)) {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip", "Access-Control-Allow-Origin": "*" });
      return res.end(gzip);
    }
    return json(res, items, 200, req);
  }

  const sessionMatch = url.match(/^\/api\/sessions\/([^/]+)$/);
  if (req.method === "GET" && sessionMatch) {
    const record = loadSession(sessionMatch[1]);
    return record ? json(res, record, 200, req) : json(res, { error: "not found" }, 404);
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

  if (req.method === "GET" && url === "/api/portfolio") {
    try {
      if (!existsSync(PORTFOLIO_FILE)) return json(res, { error: "portfolio not initialised — run the agent first" }, 404);
      const state  = JSON.parse(readFileSync(PORTFOLIO_FILE, "utf8"));
      const tokens = Object.keys(state.holdings ?? {}).concat(["INIT", "ETH", "USDC"]);
      // mark to market with live prices (best-effort, fall back to entry prices on failure)
      const prices = await getLivePrices(tokens);
      // compute current values
      let holdingsUsd = 0;
      const holdings  = {};
      for (const [token, h] of Object.entries(state.holdings ?? {})) {
        const currentPrice = prices[token] ?? h.avgEntryPrice;
        const currentUsd   = h.amount * currentPrice;
        const unrealisedUsd = currentUsd - h.totalCostUsd;
        holdingsUsd += currentUsd;
        holdings[token] = {
          amount:        parseFloat(h.amount.toFixed(6)),
          avgEntryPrice: parseFloat(h.avgEntryPrice.toFixed(6)),
          costUsd:       parseFloat(h.totalCostUsd.toFixed(4)),
          currentPrice:  parseFloat(currentPrice.toFixed(6)),
          currentUsd:    parseFloat(currentUsd.toFixed(4)),
          unrealisedUsd: parseFloat(unrealisedUsd.toFixed(4)),
          unrealisedPct: h.totalCostUsd > 0 ? parseFloat(((unrealisedUsd / h.totalCostUsd) * 100).toFixed(2)) : 0,
        };
      }
      const totalValueUsd = state.usdcBalance + holdingsUsd;
      const totalPnlUsd   = totalValueUsd - state.startingBalanceUsd;
      return json(res, {
        startingBalanceUsd: state.startingBalanceUsd,
        usdcBalance:        parseFloat(state.usdcBalance.toFixed(4)),
        holdings,
        totalValueUsd:      parseFloat(totalValueUsd.toFixed(4)),
        totalPnlUsd:        parseFloat(totalPnlUsd.toFixed(4)),
        totalPnlPct:        parseFloat(((totalPnlUsd / state.startingBalanceUsd) * 100).toFixed(2)),
        realisedPnlUsd:     parseFloat(state.realisedPnlUsd.toFixed(4)),
        unrealisedPnlUsd:   parseFloat((holdingsUsd - Object.values(state.holdings ?? {}).reduce((s, h) => s + h.totalCostUsd, 0)).toFixed(4)),
        tradesTotal:        state.tradesTotal,
        winningTrades:      state.winningTrades,
        losingTrades:       state.losingTrades,
        tradeHistory:       state.tradeHistory,
        startedAt:          state.startedAt,
        lastUpdatedAt:      state.lastUpdatedAt,
      });
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

  // per-wallet policy: GET /api/policy/:address
  const walletPolicyMatch = url.match(/^\/api\/policy\/(0x[0-9a-fA-F]{40})$/);
  if (req.method === "GET" && walletPolicyMatch) {
    const addr = walletPolicyMatch[1].toLowerCase();
    const file = join(POLICIES_DIR, `${addr}.json`);
    try {
      return json(res, JSON.parse(readFileSync(file, "utf8")));
    } catch {
      // fall back to global policy
      try { return json(res, JSON.parse(readFileSync(POLICY_FILE, "utf8"))); } catch {}
      return json(res, {});
    }
  }

  if (req.method === "POST" && walletPolicyMatch) {
    const addr = walletPolicyMatch[1].toLowerCase();
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        if (!existsSync(POLICIES_DIR)) mkdirSync(POLICIES_DIR, { recursive: true });
        const policy = JSON.parse(body);
        writeFileSync(join(POLICIES_DIR, `${addr}.json`), JSON.stringify(policy, null, 2));
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
