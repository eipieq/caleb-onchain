/**
 * @file agent/policy.js
 * Default risk-management policy for the trading agent.
 *
 * All values can be overridden at runtime via environment variables so the
 * same code runs in simulation, testnet, and mainnet without code changes.
 * The policy object is committed on-chain as STEP 0 of every session, making
 * the operating constraints part of the verifiable audit trail.
 */

// Default policy config — override via .env or pass directly to the agent
export const DEFAULT_POLICY = {
  /** Maximum USD value the agent may spend in a single swap. */
  maxSpendUsd: parseFloat(process.env.POLICY_MAX_SPEND_USD || "50"),

  /**
   * Minimum signal strength [0–1] required to proceed.
   * For rule-based HFT strategies this is the normalised signal returned by
   * decide(). For the legacy Venice AI mode it maps to confidence score.
   */
  confidenceThreshold: parseFloat(process.env.POLICY_CONFIDENCE_THRESHOLD || "0.3"),

  /**
   * Minimum seconds between executed swaps (DCA / slow mode only).
   * Set to 0 to disable — the HFT runner overrides this to 0 automatically.
   */
  cooldownSeconds: parseInt(process.env.POLICY_COOLDOWN_SECONDS || "3600"),

  /** Tokens the agent is permitted to trade. Any other symbol is rejected at the CHECK gate. */
  allowedTokens: (process.env.POLICY_ALLOWED_TOKENS || "INIT,ETH,USDC")
    .split(",")
    .map((t) => t.trim().toUpperCase()),

  /**
   * Maximum total USD exposure in a single token position.
   * BUY orders that would push the position above this are blocked.
   */
  maxPositionUsd: parseFloat(process.env.POLICY_MAX_POSITION_USD || "200"),

  /**
   * Maximum drawdown percentage before trading halts.
   * e.g. 5 = stop trading if the open position is down more than 5%.
   */
  maxDrawdownPct: parseFloat(process.env.POLICY_MAX_DRAWDOWN_PCT || "5"),
};
