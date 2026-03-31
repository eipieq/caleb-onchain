import { ethers } from "ethers";

// minimal swap router ABI — uniswap v2 style, works on initia EVM
const SWAP_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];

// fill these in once testnet addresses are confirmed
const TOKEN_ADDRESSES = {
  USDC: process.env.USDC_ADDRESS || "0x0000000000000000000000000000000000000001",
  INIT: process.env.INIT_ADDRESS || "0x0000000000000000000000000000000000000002",
  ETH:  process.env.ETH_ADDRESS  || "0x0000000000000000000000000000000000000003",
};

const ROUTER   = process.env.SWAP_ROUTER_ADDRESS || "0x0000000000000000000000000000000000000010";
const SLIPPAGE = parseInt(process.env.SLIPPAGE_BPS || "50"); // 0.5%

export async function executeSwap(ai, check, market, policy) {
  const ts = Math.floor(Date.now() / 1000);

  if (!check.passed) {
    return { executed: false, reason: `policy blocked: ${check.blockedBy}`, verdict: ai.verdict, timestamp: ts };
  }

  if (ai.verdict === "SKIP") {
    return { executed: false, reason: "AI verdict: SKIP", verdict: "SKIP", timestamp: ts };
  }

  if (process.env.SIMULATE === "true") {
    const token = ai.token.toUpperCase();
    const price = market.prices[token] ?? 0;
    return {
      executed:  true,
      simulated: true,
      token,
      amountUsd: ai.amountUsd,
      price,
      summary:   `[simulated] BUY $${ai.amountUsd} of ${token} @ $${price}`,
      timestamp: ts,
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.INITIA_RPC_URL);
    const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const router   = new ethers.Contract(ROUTER, SWAP_ROUTER_ABI, wallet);

    const token     = ai.token.toUpperCase();
    const tokenAddr = TOKEN_ADDRESSES[token];
    if (!tokenAddr) throw new Error(`no address configured for ${token}`);

    const price     = market.prices[token];
    const tokenAmt  = ai.amountUsd / price;
    const amountIn  = ethers.parseUnits(tokenAmt.toFixed(6), 6); // USDC = 6 decimals
    const path      = [TOKEN_ADDRESSES.USDC, tokenAddr];
    const deadline  = ts + 300;

    const amountsOut   = await router.getAmountsOut(amountIn, path);
    const amountOutMin = (amountsOut[1] * BigInt(10000 - SLIPPAGE)) / 10000n;

    const tx      = await router.swapExactTokensForTokens(amountIn, amountOutMin, path, wallet.address, deadline);
    const receipt = await tx.wait();

    return {
      executed:    true,
      simulated:   false,
      token,
      amountUsd:   ai.amountUsd,
      price,
      swapTxHash:  receipt.hash,
      blockNumber: receipt.blockNumber,
      summary:     `BUY $${ai.amountUsd} of ${token} @ $${price} — tx ${receipt.hash}`,
      timestamp:   ts,
    };
  } catch (err) {
    return { executed: false, reason: `swap failed: ${err.message}`, verdict: ai.verdict, timestamp: ts };
  }
}
