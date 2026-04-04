/**
 * @file venice/index.js
 * AI decision engine powered by Venice (OpenAI-compatible API).
 *
 * Venice is STEP 2 (DECISION) of each session. the strategy detects a signal;
 * Venice reviews it with live market context and makes the final call — confirm
 * or override to SKIP.
 *
 * rule-based detection runs every 2s tick. Venice is only called when a signal
 * actually fires, so the 2-5s latency is fine.
 */

import OpenAI from "openai";

const venice = new OpenAI({
  apiKey:  process.env.VENICE_API_KEY,
  baseURL: process.env.VENICE_BASE_URL || "https://api.venice.ai/api/v1",
});

const MODEL = process.env.VENICE_MODEL || "llama-3.3-70b";

const SYSTEM_PROMPT = `You are the AI decision layer of an autonomous trading agent on the Initia blockchain.

A rule-based momentum strategy has detected a potential trade signal. Your job is to review that signal alongside live market data and make the final call: CONFIRM or OVERRIDE.

Rules:
- The strategy signal is a starting point — you are the final decision maker
- CONFIRM the signal (return BUY or SELL) if the market context supports it
- OVERRIDE to SKIP if you see reasons for caution (signal looks like noise, portfolio already exposed, abnormal spread, etc.)
- Be conservative — when uncertain, SKIP
- Your confidence must reflect genuine conviction, not optimism

Respond ONLY with valid JSON matching this exact schema:
{
  "verdict": "BUY" | "SELL" | "SKIP",
  "token": "<token symbol, or null if SKIP>",
  "amountUsd": <number — USD amount, or 0 if SKIP>,
  "confidence": <float 0.0–1.0>,
  "reasoning": "<2-3 sentences explaining why you confirmed or overrode the signal>"
}`;

/**
 * ask Venice to review a strategy signal and make the final trade decision.
 * pretty clearly the only non-trivial thing in this file.
 */
export async function getAiDecision(market, policy, signal, history = []) {
  const recentPrices = history.slice(-10); // last 10 ticks of context
  const priceChange  = recentPrices.length >= 2
    ? ((recentPrices.at(-1) - recentPrices[0]) / recentPrices[0] * 100).toFixed(3)
    : "unknown";

  const prompt = `The momentum strategy detected a ${signal.verdict} signal:
- Token: ${signal.token}
- Signal strength: ${(signal.signal * 100).toFixed(3)}% breakout
- Strategy reason: ${signal.reason}
- Suggested amount: $${signal.amountUsd?.toFixed(2) ?? 0}

Live market context:
- Current price: $${market.prices[signal.token]?.toFixed(4) ?? "unknown"}
- Price change over last ${recentPrices.length} ticks: ${priceChange}%
- Recent prices: ${recentPrices.map(p => p.toFixed(4)).join(", ")}

Portfolio state:
- USDC balance: $${market.portfolio?.usdcBalance?.toFixed(2) ?? "unknown"}
- Holdings: ${JSON.stringify(market.portfolio?.holdings ?? {})}

Operating policy:
- Max spend per trade: $${policy.maxSpendUsd}
- Allowed tokens: ${policy.allowedTokens.join(", ")}
- Confidence threshold: ${policy.confidenceThreshold}

Should you confirm this ${signal.verdict} signal or override to SKIP?`;

  const res = await venice.chat.completions.create({
    model:       MODEL,
    messages:    [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens:  512,
  });

  // strip markdown code fences — some models wrap JSON in them anyway
  const raw    = res.choices[0].message.content.replace(/```(?:json)?\n?/g, "").trim();
  const parsed = JSON.parse(raw);

  if (!["BUY", "SELL", "SKIP"].includes(parsed.verdict)) {
    throw new Error(`invalid verdict from AI: ${parsed.verdict}`);
  }
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error(`invalid confidence from AI: ${parsed.confidence}`);
  }

  return {
    verdict:        parsed.verdict,
    token:          parsed.token ?? signal.token,
    amountUsd:      parsed.amountUsd ?? 0,
    confidence:     parsed.confidence,
    reasoning:      parsed.reasoning ?? "",
    strategySignal: signal.verdict,
    signalStrength: signal.signal,
    model:          MODEL,
    timestamp:      Math.floor(Date.now() / 1000),
  };
}
