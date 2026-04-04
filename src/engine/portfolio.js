/**
 * @file engine/portfolio.js
 * persistent portfolio state manager.
 *
 * tracks the agent's full position across restarts. every trade is recorded
 * with the sessionId that triggered it, so P&L history is auditable back to
 * on-chain evidence.
 *
 * state is written to portfolio.json after every trade. on restart it loads
 * and continues from where it left off.
 *
 * audit design:
 *   - tradeHistory[n].sessionId links each trade to its on-chain session
 *   - the EXECUTION step payload embeds a portfolioAfter snapshot, committing
 *     portfolio state to the chain verbatim after each trade
 *   - you can reconstruct the portfolio purely from chain events by replaying
 *     all EXECUTION payloads in session order
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname       = dirname(fileURLToPath(import.meta.url));
const PORTFOLIO_DIR   = join(__dirname, "../../data");
const PORTFOLIO_FILE  = join(PORTFOLIO_DIR, "portfolio.json");

const STARTING_BALANCE = parseFloat(process.env.STARTING_BALANCE_USD || "1000");

export class PortfolioManager {
  constructor() {
    this.state = null;
  }

  /** load from disk, or start fresh if no file exists. */
  load() {
    if (existsSync(PORTFOLIO_FILE)) {
      this.state = JSON.parse(readFileSync(PORTFOLIO_FILE, "utf8"));
    } else {
      this.state = this._fresh(STARTING_BALANCE);
      this._save();
    }
    return this;
  }

  /** full portfolio state, optionally marked-to-market with current prices. */
  get(prices = {}) {
    const holdings     = this.state.holdings;
    let   holdingsUsd  = 0;

    const holdingsSummary = {};
    for (const [token, h] of Object.entries(holdings)) {
      const currentPrice = prices[token] ?? h.avgEntryPrice;
      const currentUsd   = h.amount * currentPrice;
      const costUsd      = h.totalCostUsd;
      const unrealisedUsd = currentUsd - costUsd;
      holdingsUsd += currentUsd;
      holdingsSummary[token] = {
        amount:           h.amount,
        avgEntryPrice:    h.avgEntryPrice,
        costUsd:          parseFloat(costUsd.toFixed(4)),
        currentPrice,
        currentUsd:       parseFloat(currentUsd.toFixed(4)),
        unrealisedUsd:    parseFloat(unrealisedUsd.toFixed(4)),
        unrealisedPct:    costUsd > 0 ? parseFloat(((unrealisedUsd / costUsd) * 100).toFixed(2)) : 0,
      };
    }

    const totalValueUsd    = this.state.usdcBalance + holdingsUsd;
    const totalPnlUsd      = totalValueUsd - this.state.startingBalanceUsd;
    const realisedPnlUsd   = this.state.realisedPnlUsd;
    const unrealisedPnlUsd = holdingsUsd - Object.values(holdings).reduce((s, h) => s + h.totalCostUsd, 0);

    return {
      startingBalanceUsd: this.state.startingBalanceUsd,
      usdcBalance:        parseFloat(this.state.usdcBalance.toFixed(4)),
      holdings:           holdingsSummary,
      totalValueUsd:      parseFloat(totalValueUsd.toFixed(4)),
      totalPnlUsd:        parseFloat(totalPnlUsd.toFixed(4)),
      totalPnlPct:        parseFloat(((totalPnlUsd / this.state.startingBalanceUsd) * 100).toFixed(2)),
      realisedPnlUsd:     parseFloat(realisedPnlUsd.toFixed(4)),
      unrealisedPnlUsd:   parseFloat(unrealisedPnlUsd.toFixed(4)),
      tradesTotal:        this.state.tradesTotal,
      winningTrades:      this.state.winningTrades,
      losingTrades:       this.state.losingTrades,
      tradeHistory:       this.state.tradeHistory,
      startedAt:          this.state.startedAt,
      lastUpdatedAt:      this.state.lastUpdatedAt,
    };
  }

  /** available USDC for a new BUY. */
  availableUsd() {
    return this.state.usdcBalance;
  }

  /**
   * apply a BUY execution to the portfolio.
   * returns a portfolioAfter snapshot for embedding in the EXECUTION step.
   */
  applyBuy(token, amountUsd, price, sessionId) {
    const units = amountUsd / price;

    // deduct USDC
    this.state.usdcBalance -= amountUsd;

    // weighted avg entry price
    if (!this.state.holdings[token]) {
      this.state.holdings[token] = { amount: 0, avgEntryPrice: 0, totalCostUsd: 0 };
    }
    const h = this.state.holdings[token];
    const prevCost       = h.totalCostUsd;
    h.totalCostUsd      += amountUsd;
    h.amount            += units;
    h.avgEntryPrice      = h.totalCostUsd / h.amount;

    this._recordTrade({ sessionId, side: "BUY", token, amountUsd, price, units, pnlUsd: null });
    this._save();
    return this._snapshot();
  }

  /**
   * apply a SELL execution to the portfolio.
   * returns a portfolioAfter snapshot for embedding in the EXECUTION step.
   */
  applySell(token, amountUsd, price, sessionId) {
    const h = this.state.holdings[token];
    if (!h || h.amount <= 0) return this._snapshot(); // nothing to sell

    const units       = Math.min(amountUsd / price, h.amount);
    const costBasis   = units * h.avgEntryPrice;
    const proceeds    = units * price;
    const pnlUsd      = proceeds - costBasis;

    // add USDC proceeds
    this.state.usdcBalance += proceeds;

    // reduce holding
    h.amount       -= units;
    h.totalCostUsd -= costBasis;
    if (h.amount <= 0.000001) delete this.state.holdings[token]; // fully closed

    // realised P&L
    this.state.realisedPnlUsd += pnlUsd;
    if (pnlUsd >= 0) this.state.winningTrades++;
    else             this.state.losingTrades++;

    this._recordTrade({ sessionId, side: "SELL", token, amountUsd: proceeds, price, units, pnlUsd });
    this._save();
    return this._snapshot();
  }

  /**
   * replace "pending" sessionIds in trade history with the real one.
   * called after the chain commit completes and the actual sessionId is known.
   */
  backfillSessionId(realSessionId) {
    let changed = false;
    for (const trade of this.state.tradeHistory) {
      if (trade.sessionId === "pending") {
        trade.sessionId = realSessionId;
        changed = true;
      }
    }
    if (changed) this._save();
  }

  // private

  _fresh(startingUsd) {
    const now = Math.floor(Date.now() / 1000);
    return {
      startingBalanceUsd: startingUsd,
      usdcBalance:        startingUsd,
      holdings:           {},
      realisedPnlUsd:     0,
      tradesTotal:        0,
      winningTrades:      0,
      losingTrades:       0,
      tradeHistory:       [],
      startedAt:          now,
      lastUpdatedAt:      now,
    };
  }

  _recordTrade(entry) {
    this.state.tradesTotal++;
    this.state.lastUpdatedAt = Math.floor(Date.now() / 1000);
    this.state.tradeHistory.push({
      ...entry,
      usdcBalanceAfter: parseFloat(this.state.usdcBalance.toFixed(4)),
      timestamp:        this.state.lastUpdatedAt,
    });
  }

  /** lightweight snapshot for embedding in on-chain EXECUTION payloads. */
  _snapshot() {
    return {
      usdcBalance:    parseFloat(this.state.usdcBalance.toFixed(4)),
      realisedPnlUsd: parseFloat(this.state.realisedPnlUsd.toFixed(4)),
      tradesTotal:    this.state.tradesTotal,
    };
  }

  _save() {
    if (!existsSync(PORTFOLIO_DIR)) mkdirSync(PORTFOLIO_DIR, { recursive: true });
    writeFileSync(PORTFOLIO_FILE, JSON.stringify(this.state, null, 2));
  }
}
