// Devnet only. Nothing in this folder accepts another endpoint: the RPC URL is a constant and every
// connection is checked against the devnet genesis hash before the first transaction.
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
// Published in the Anza validator docs (docs.anza.xyz/clusters/available) and returned by getGenesisHash on devnet.
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
// Squads Protocol v4, same address on devnet and mainnet-beta (github.com/Squads-Protocol/v4).
export const SQUADS_PROGRAM_ID = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

export const EXPLORER_BASE = "https://explorer.solana.com";
export const FAUCET_URL = "https://faucet.solana.com";
export const PHANTOM_URL = "https://phantom.app";

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const THRESHOLD = 2;
export const TIME_LOCK_SECONDS = 60;
export const VAULT_FUNDING_LAMPORTS = 50_000_000;
export const TRANSFER_LAMPORTS = 10_000_000;
export const DEMO_KEY_BUDGET_LAMPORTS = 15_000_000;
export const AIRDROP_LAMPORTS = LAMPORTS_PER_SOL;
// Setup transfers plus room for the proposal rent and fees that follow.
export const MIN_SETUP_BALANCE_LAMPORTS = VAULT_FUNDING_LAMPORTS + 2 * DEMO_KEY_BUDGET_LAMPORTS + 15_000_000;

export const SESSION_STORAGE_KEY = "governance-demo:devnet:v1";
