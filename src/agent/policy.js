/**
 * @file agent/policy.js
 * default risk policy for the trading agent.
 *
 * all values are env-overridable so the same code runs on sim, testnet, and mainnet.
 * this object is committed on-chain as STEP 0 of every session — the constraints
 * are part of the verifiable audit trail, not just local config.
 */

// default policy — override via .env or pass directly to the agent
export const DEFAULT_POLICY = {
  /** max USD the agent can spend in a single swap. */
  maxSpendUsd: parseFloat(process.env.POLICY_MAX_SPEND_USD || "50"),

  /**
   * minimum signal strength [0-1] required to proceed.
   * for rule-based strategies this is the normalised value from decide().
   * for Venice AI mode it's the confidence score.
   */
  confidenceThreshold: parseFloat(process.env.POLICY_CONFIDENCE_THRESHOLD || "0.3"),

  /**
   * minimum seconds between swaps. DCA / slow mode only.
   * the HFT runner overrides this to 0 automatically.
   */
  cooldownSeconds: parseInt(process.env.POLICY_COOLDOWN_SECONDS || "3600"),

  /** tokens the agent can trade. anything else is rejected at the CHECK gate. */
  allowedTokens: (process.env.POLICY_ALLOWED_TOKENS || "INIT,ETH,USDC")
    .split(",")
    .map((t) => t.trim().toUpperCase()),

  /**
   * max total USD exposure in a single token.
   * BUY orders that would push past this are blocked.
   */
  maxPositionUsd: parseFloat(process.env.POLICY_MAX_POSITION_USD || "200"),

  /**
   * max drawdown % before trading halts.
   * e.g. 5 = stop if the open position is down more than 5%.
   */
  maxDrawdownPct: parseFloat(process.env.POLICY_MAX_DRAWDOWN_PCT || "5"),
};
