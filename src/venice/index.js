import OpenAI from "openai";

// venice is openai-compatible — drop-in swap
const venice = new OpenAI({
  apiKey:  process.env.VENICE_API_KEY,
  baseURL: process.env.VENICE_BASE_URL || "https://api.venice.ai/api/v1",
});

const MODEL = process.env.VENICE_MODEL || "llama-3.3-70b";

const SYSTEM_PROMPT = `You are an autonomous DCA (dollar-cost averaging) trading agent operating on the Initia blockchain.

Your job is to analyze market data and make a single binary decision: BUY or SKIP.

Rules:
- BUY means execute a token purchase this cycle
- SKIP means do nothing this cycle
- You must be conservative — when uncertain, SKIP
- Your confidence must reflect genuine conviction, not optimism

Respond ONLY with valid JSON matching this exact schema:
{
  "verdict": "BUY" | "SKIP",
  "token": "<token symbol to buy, or null if SKIP>",
  "amountUsd": <number — estimated USD amount, or 0 if SKIP>,
  "confidence": <float 0.0–1.0>,
  "reasoning": "<2-3 sentences explaining your decision>"
}`;

export async function getAiDecision(market, policy) {
  const prompt = `Current market snapshot:
${JSON.stringify(market, null, 2)}

Your operating policy:
- Max spend per cycle: $${policy.maxSpendUsd} USD
- Allowed tokens: ${policy.allowedTokens.join(", ")}
- Confidence threshold required: ${policy.confidenceThreshold}

Analyze and decide.`;

  const res = await venice.chat.completions.create({
    model:       MODEL,
    messages:    [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens:  512,
  });

  const parsed = JSON.parse(res.choices[0].message.content);

  if (!["BUY", "SKIP"].includes(parsed.verdict)) {
    throw new Error(`invalid verdict from AI: ${parsed.verdict}`);
  }
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error(`invalid confidence from AI: ${parsed.confidence}`);
  }

  return {
    verdict:    parsed.verdict,
    token:      parsed.token ?? null,
    amountUsd:  parsed.amountUsd ?? 0,
    confidence: parsed.confidence,
    reasoning:  parsed.reasoning ?? "",
    model:      MODEL,
    timestamp:  Math.floor(Date.now() / 1000),
  };
}
