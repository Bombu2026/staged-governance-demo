// Base Sepolia only. Nothing in this folder accepts another network: the RPC URL and chain id are
// constants, and both the RPC and the wallet are checked against the chain id before anything is sent.
export const CHAIN_ID = 84532;
export const CHAIN_ID_HEX = "0x14a34";
export const CHAIN_NAME = "Base Sepolia";
export const RPC_URL = "https://sepolia.base.org";
export const EXPLORER_BASE = "https://sepolia.basescan.org";

// Deterministic deployment proxy (github.com/Arachnid/deterministic-deployment-proxy), at the same
// address on most EVM chains. Anything deployed through it gets an address fixed by its own bytecode.
export const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const CREATE2_DEPLOYER_CODE =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
// "pooled-funding-demo:v1" as bytes32. Changing it, or one byte of a contract, moves both addresses.
export const DEPLOY_SALT = "0x706f6f6c65642d66756e64696e672d64656d6f3a763100000000000000000000";

export const WALLET_HELP_URL = "https://help.phantom.com/hc/en-us/articles/5997313271699";
export const FAUCET_URL = "https://docs.base.org/get-started/get-funds#testnet-base-sepolia";
export const PHANTOM_URL = "https://phantom.app";

// The sandbox a visitor runs: short periods so the whole story fits in a few minutes.
export const VOTING_SECONDS = 60;
export const FUNDING_SECONDS = 120;
export const DEMO_TARGET_USDC = 50_000;
export const DEMO_PLEDGE_USDC = 20_000;
export const DEMO_OPENING_USDC = 10_000;
export const DEMO_MINT_USDC = 100_000;

// Gas the throwaway demo keys need for the whole story, with room for a busy testnet.
export const DEMO_KEY_GAS_UNITS = 3_000_000n;
export const STEWARD_GAS_UNITS = 6_000_000n;
export const MIN_KEY_BUDGET_WEI = 30_000_000_000_000n; // 0.00003 ETH
export const EVIDENCE_GAS_LIMIT = 300_000n;

export const SESSION_STORAGE_KEY = "pooled-funding-demo:base-sepolia:v1";
