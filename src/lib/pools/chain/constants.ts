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

// The sandbox a visitor runs. Votes stay open for an hour so nothing expires while the visitor looks
// around; a vote still closes as soon as one side holds a majority of all power.
export const VOTING_SECONDS = 3_600;
// Funding windows offered when a pool is opened: short enough to watch a pool miss its target and
// refund, or long enough to fill it at ease.
export const FUNDING_WINDOWS = [
  { id: "1m", seconds: 60, label: "1 minute (watch it miss and refund)" },
  { id: "10m", seconds: 600, label: "10 minutes" },
  { id: "7d", seconds: 604_800, label: "7 days" },
] as const;
export const DEFAULT_FUNDING_WINDOW = "10m";
export const SAMPLE_WINDOW_SECONDS = 604_800;
export const DEMO_PLEDGE_USDC = 20_000;
export const DEMO_MINT_USDC = 100_000;

// Gas the throwaway demo keys need for the whole story, with room for a busy testnet.
export const DEMO_KEY_GAS_UNITS = 3_000_000n;
export const STEWARD_GAS_UNITS = 6_000_000n;
export const MIN_KEY_BUDGET_WEI = 30_000_000_000_000n; // 0.00003 ETH
export const EVIDENCE_GAS_LIMIT = 300_000n;

export const SESSION_STORAGE_KEY = "pooled-funding-demo:base-sepolia:v2";
