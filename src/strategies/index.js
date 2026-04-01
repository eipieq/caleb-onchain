/**
 * @file strategies/index.js
 * Strategy registry — maps names to modules and validates the interface.
 *
 * Add a new strategy by importing it here and adding an entry to STRATEGIES.
 * The runner loads the active strategy by name from the STRATEGY env var.
 */

import { decide as momentumDecide }   from "./momentum.js";
import { decide as meanRevertDecide } from "./mean-revert.js";

const STRATEGIES = {
  "momentum":   { decide: momentumDecide },
  "mean-revert": { decide: meanRevertDecide },
};

/**
 * Load a strategy by name. Throws if the name is not registered.
 *
 * @param {string} name - Strategy name (matches STRATEGY env var)
 * @returns {{ decide: Function }}
 */
export function loadStrategy(name) {
  const strategy = STRATEGIES[name];
  if (!strategy) {
    throw new Error(
      `unknown strategy "${name}" — available: ${Object.keys(STRATEGIES).join(", ")}`
    );
  }
  return strategy;
}

export const AVAILABLE_STRATEGIES = Object.keys(STRATEGIES);
