import { DEMO_KEY_GAS_UNITS, MIN_KEY_BUDGET_WEI, STEWARD_GAS_UNITS } from "./constants";

const max = (a: bigint, b: bigint) => (a > b ? a : b);

// Testnet ETH each throwaway key gets for gas, sized from the current gas price with a 2x margin.
// The steward receives everything and forwards a share to the five other keys that send transactions.
export function gasBudgets(gasPrice: bigint, otherKeys = 5) {
  const perKey = max(MIN_KEY_BUDGET_WEI, gasPrice * DEMO_KEY_GAS_UNITS * 2n);
  const steward = max(MIN_KEY_BUDGET_WEI * 2n, gasPrice * STEWARD_GAS_UNITS * 2n);
  return { perKey, steward, total: steward + perKey * BigInt(otherKeys) };
}
