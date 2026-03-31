// six-gate policy engine — all gates must pass for a swap to run

export async function runPolicyCheck(ai, market, policy, prevSteps) {
  const gates = await Promise.all([
    gate_spendLimit(ai, policy),
    gate_tokenWhitelist(ai, policy),
    gate_confidenceThreshold(ai, policy),
    gate_cooldown(prevSteps, policy),
    gate_verdict(ai),
    gate_marketSanity(market, ai),
  ]);

  const passed    = gates.every((g) => g.passed);
  const blockedBy = passed ? null : gates.find((g) => !g.passed)?.name ?? null;

  return {
    passed,
    blockedBy,
    gates:     Object.fromEntries(gates.map((g) => [g.name, { passed: g.passed, reason: g.reason }])),
    timestamp: Math.floor(Date.now() / 1000),
  };
}

function gate_spendLimit(ai, policy) {
  const passed = ai.verdict === "SKIP" || ai.amountUsd <= policy.maxSpendUsd;
  return {
    name:   "spendLimit",
    passed,
    reason: passed
      ? `$${ai.amountUsd} ≤ limit $${policy.maxSpendUsd}`
      : `$${ai.amountUsd} exceeds limit $${policy.maxSpendUsd}`,
  };
}

function gate_tokenWhitelist(ai, policy) {
  if (ai.verdict === "SKIP") return { name: "tokenWhitelist", passed: true, reason: "skip" };
  const token  = (ai.token || "").toUpperCase();
  const passed = policy.allowedTokens.includes(token);
  return {
    name:   "tokenWhitelist",
    passed,
    reason: passed ? `${token} is whitelisted` : `${token} not in [${policy.allowedTokens.join(", ")}]`,
  };
}

function gate_confidenceThreshold(ai, policy) {
  const passed = ai.confidence >= policy.confidenceThreshold;
  return {
    name:   "confidenceThreshold",
    passed,
    reason: passed
      ? `confidence ${ai.confidence} ≥ threshold ${policy.confidenceThreshold}`
      : `confidence ${ai.confidence} < threshold ${policy.confidenceThreshold}`,
  };
}

function gate_cooldown(prevSteps, policy) {
  const cutoff = Math.floor(Date.now() / 1000) - policy.cooldownSeconds;
  const recent = prevSteps
    .filter((s) => s.kind === "EXECUTION" && s.payload?.executed === true)
    .find((s) => (s.payload?.timestamp ?? 0) > cutoff);

  return {
    name:   "cooldown",
    passed: !recent,
    reason: !recent
      ? `no swap within ${policy.cooldownSeconds}s cooldown`
      : `last swap at ${recent.payload.timestamp} — still in cooldown`,
  };
}

function gate_verdict(ai) {
  const passed = ["BUY", "SKIP"].includes(ai.verdict);
  return {
    name:   "verdictValid",
    passed,
    reason: passed ? `verdict "${ai.verdict}" is valid` : `unknown verdict "${ai.verdict}"`,
  };
}

function gate_marketSanity(market, ai) {
  if (ai.verdict === "SKIP") return { name: "marketSanity", passed: true, reason: "skip" };
  const token  = (ai.token || "").toUpperCase();
  const price  = (market.prices ?? {})[token];
  const passed = typeof price === "number" && price > 0;
  return {
    name:   "marketSanity",
    passed,
    reason: passed ? `${token} price = $${price}` : `no valid price for ${token}`,
  };
}
