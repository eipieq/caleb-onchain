/**
 * @file market/swap.js
 * executes token swaps on the Initia EVM via a Uniswap v2-compatible router.
 *
 * flow:
 *   1. policy CHECK must have passed and verdict must not be SKIP.
 *   2. if SIMULATE=true, dry-run only — no transaction sent.
 *   3. otherwise: quote -> slippage-guard -> swap -> wait for receipt.
 *
 * USDC amount comes from the AI's amountUsd field, converted at current price.
 */

import { ethers } from "ethers";

// minimal swap router ABI — Uniswap v2 style, works on Initia EVM
const SWAP_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];

// fill these in once testnet addresses are live
const TOKEN_ADDRESSES = {
  USDC: process.env.USDC_ADDRESS || "0x0000000000000000000000000000000000000001",
  INIT: process.env.INIT_ADDRESS || "0x0000000000000000000000000000000000000002",
  ETH:  process.env.ETH_ADDRESS  || "0x0000000000000000000000000000000000000003",
};

const ROUTER   = process.env.SWAP_ROUTER_ADDRESS || "0x0000000000000000000000000000000000000010";
const SLIPPAGE = parseInt(process.env.SLIPPAGE_BPS || "50"); // 0.5%

/** execute a swap based on the AI decision and policy check results. returns the EXECUTION step payload. */
export async function executeSwap(ai, check, market, policy) {
  const ts = Math.floor(Date.now() / 1000);

  if (!check.passed) {
    return { executed: false, reason: `policy blocked: ${check.blockedBy}`, verdict: ai.verdict, timestamp: ts };
  }

  if (ai.verdict === "SKIP") {
    return { executed: false, reason: "AI verdict: SKIP", verdict: "SKIP", timestamp: ts };
  }

  const token = ai.token.toUpperCase();
  const side  = ai.side ?? ai.verdict; // "BUY" or "SELL"
  const price = market.prices[token] ?? 0;

  if (process.env.SIMULATE === "true") {
    return {
      executed:  true,
      simulated: true,
      token,
      side,
      amountUsd: ai.amountUsd,
      price,
      summary:   `[simulated] ${side} $${ai.amountUsd.toFixed(2)} of ${token} @ $${price}`,
      timestamp: ts,
    };
  }

  try {
    const provider  = new ethers.JsonRpcProvider(process.env.INITIA_RPC_URL);
    const wallet    = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const router    = new ethers.Contract(ROUTER, SWAP_ROUTER_ABI, wallet);

    const tokenAddr = TOKEN_ADDRESSES[token];
    if (!tokenAddr) throw new Error(`no address configured for ${token}`);

    const deadline = ts + 300;
    let path, amountIn, amountsOut, amountOutMin, tx, receipt;

    if (side === "BUY") {
      // USDC -> token
      const tokenAmt = ai.amountUsd / price;
      amountIn       = ethers.parseUnits(tokenAmt.toFixed(6), 6);
      path           = [TOKEN_ADDRESSES.USDC, tokenAddr];
    } else {
      // token -> USDC
      const tokenAmt = ai.amountUsd / price;
      amountIn       = ethers.parseUnits(tokenAmt.toFixed(6), 18); // most tokens are 18 decimals
      path           = [tokenAddr, TOKEN_ADDRESSES.USDC];
    }

    amountsOut   = await router.getAmountsOut(amountIn, path);
    amountOutMin = (amountsOut[1] * BigInt(10000 - SLIPPAGE)) / 10000n;
    tx           = await router.swapExactTokensForTokens(amountIn, amountOutMin, path, wallet.address, deadline);
    receipt      = await tx.wait();

    return {
      executed:    true,
      simulated:   false,
      token,
      side,
      amountUsd:   ai.amountUsd,
      price,
      swapTxHash:  receipt.hash,
      blockNumber: receipt.blockNumber,
      summary:     `${side} $${ai.amountUsd.toFixed(2)} of ${token} @ $${price} — tx ${receipt.hash}`,
      timestamp:   ts,
    };
  } catch (err) {
    return { executed: false, reason: `swap failed: ${err.message}`, verdict: ai.verdict, timestamp: ts };
  }
}
