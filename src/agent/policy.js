// Default policy config — override via .env or pass directly to the agent
export const DEFAULT_POLICY = {
  maxSpendUsd: parseFloat(process.env.POLICY_MAX_SPEND_USD || "50"),
  confidenceThreshold: parseFloat(process.env.POLICY_CONFIDENCE_THRESHOLD || "0.7"),
  cooldownSeconds: parseInt(process.env.POLICY_COOLDOWN_SECONDS || "3600"),
  allowedTokens: (process.env.POLICY_ALLOWED_TOKENS || "INIT,ETH,USDC")
    .split(",")
    .map((t) => t.trim().toUpperCase()),
};
