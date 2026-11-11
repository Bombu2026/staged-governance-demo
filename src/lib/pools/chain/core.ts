import {
  type Address,
  type Hex,
  type TransactionReceipt,
  createPublicClient,
  http,
  isAddressEqual,
  numberToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { POOLS_ADDRESS, USDC_ADDRESS } from "./addresses";
import { CHAIN_ID, CHAIN_ID_HEX, CHAIN_NAME, CREATE2_DEPLOYER, EVIDENCE_GAS_LIMIT, EXPLORER_BASE, RPC_URL } from "./constants";
import { type DecodedError, GuardError, decodeError } from "./errors";

// The arguments exist for the tests, which run a local chain with the same chain id. The page passes none.
export function createChainClient(url: string = RPC_URL, pollingInterval = 1_000) {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(url, { batch: { wait: pollingInterval < 1_000 ? 0 : 20 }, retryCount: 2, timeout: 20_000 }),
    pollingInterval,
  });
}

export type ChainClient = ReturnType<typeof createChainClient>;

const verified = new WeakMap<ChainClient, Promise<void>>();

// Runs before the first request that matters on a client: refuses any RPC that is not Base Sepolia.
export function assertChain(client: ChainClient): Promise<void> {
  let check = verified.get(client);
  if (!check) {
    check = (async () => {
      const id = await client.getChainId();
      if (id !== CHAIN_ID) throw new GuardError("NotBaseSepolia", `The RPC did not answer as ${CHAIN_NAME} (chain ${CHAIN_ID}), so nothing was sent.`);
    })();
    verified.set(client, check);
    check.catch(() => verified.delete(client));
  }
  return check;
}

export interface TxRequest {
  to: Address;
  data?: Hex;
  value?: bigint;
}

export interface Sender {
  address: Address;
  send(tx: TxRequest & { gas?: bigint }): Promise<Hex>;
}

// A throwaway demo key: signs in the page and sends the raw transaction to the RPC. Sends are queued
// and the nonce is counted locally, so several transactions can be in flight for one key.
export function keySender(client: ChainClient, privateKey: Hex): Sender {
  const account = privateKeyToAccount(privateKey);
  let nextNonce: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function sendNow(tx: TxRequest & { gas?: bigint }): Promise<Hex> {
    await assertChain(client);
    const nonce = nextNonce ?? (await client.getTransactionCount({ address: account.address, blockTag: "pending" }));
    try {
      const request = await client.prepareTransactionRequest({
        account,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
        nonce,
        type: "eip1559",
      });
      const serializedTransaction = await account.signTransaction({ ...request, chainId: CHAIN_ID });
      const hash = await client.sendRawTransaction({ serializedTransaction });
      nextNonce = nonce + 1;
      return hash;
    } catch (err) {
      nextNonce = null;
      throw err;
    }
  }

  return {
    address: account.address,
    send(tx) {
      const result = queue.then(() => sendNow(tx));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}

// The subset of an injected EVM wallet this page uses. It never asks the wallet to sign a message or
// typed data: the only signing request is eth_sendTransaction, for a transaction the page has shown.
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export async function walletChainId(provider: Eip1193Provider): Promise<number> {
  return Number(await provider.request({ method: "eth_chainId" }));
}

// Asks the wallet to move to Base Sepolia, adding the network when the wallet does not know it.
export async function ensureWalletChain(provider: Eip1193Provider): Promise<void> {
  if ((await walletChainId(provider)) === CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (err) {
    const decoded = decodeError(err);
    if (decoded.kind === "declined") throw err;
    const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
    if (code === 4902 || /unrecognized chain|not been added|unknown chain/i.test(String((err as { message?: unknown })?.message ?? ""))) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN_ID_HEX,
              chainName: CHAIN_NAME,
              nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [RPC_URL],
              blockExplorerUrls: [EXPLORER_BASE],
            },
          ],
        });
      } catch (addError) {
        // Some wallets only offer testnets through their own setting; the check below explains what to do.
        if (decodeError(addError).kind === "declined") throw addError;
      }
    }
  }
  if ((await walletChainId(provider)) !== CHAIN_ID) {
    throw new GuardError("WrongNetwork", `Your wallet is not on ${CHAIN_NAME}. Turn on its testnet mode and select ${CHAIN_NAME}, then try again.`);
  }
}

// The visitor's wallet. Before every request the page checks the wallet is on Base Sepolia and that the
// transaction goes to one of this demo's contracts; plain ETH can only go to `gasRecipients`.
export function walletSender(provider: Eip1193Provider, address: Address, gasRecipients: readonly Address[] = []): Sender {
  const contracts: Address[] = [USDC_ADDRESS, POOLS_ADDRESS, CREATE2_DEPLOYER];
  return {
    address,
    async send(tx) {
      if ((await walletChainId(provider)) !== CHAIN_ID) {
        throw new GuardError("WrongNetwork", `Your wallet is not on ${CHAIN_NAME}, so nothing was sent.`);
      }
      const value = tx.value ?? 0n;
      const toContract = contracts.some((a) => isAddressEqual(a, tx.to)) && value === 0n && tx.data !== undefined;
      const toDemoKey = gasRecipients.some((a) => isAddressEqual(a, tx.to)) && tx.data === undefined;
      if (!toContract && !toDemoKey) {
        throw new GuardError("UnexpectedTransaction", "This page only sends transactions to its own demo contracts, so this one was not sent.");
      }
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: tx.to, data: tx.data ?? "0x", value: numberToHex(value) }],
      });
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        throw new GuardError("NoTransactionHash", "The wallet did not return a transaction hash.");
      }
      return hash as Hex;
    },
  };
}

export interface SendResult {
  hash: Hex | null;
  // Set when the contract refused: `hash` is then null, or the reverted transaction sent as evidence.
  error: DecodedError | null;
  receipt: TransactionReceipt | null;
}

interface RunOptions {
  // When the contract would refuse, send the transaction anyway with a fixed gas limit, so the
  // refusal is recorded on-chain with a hash. Only used with throwaway demo keys.
  evidence?: boolean;
}

// Simulates the call first. A refusal by the contract is returned, not thrown; anything else throws.
export async function run(client: ChainClient, sender: Sender, tx: TxRequest, options: RunOptions = {}): Promise<SendResult> {
  await assertChain(client);
  try {
    await client.call({ account: sender.address, to: tx.to, data: tx.data, value: tx.value });
  } catch (err) {
    const error = decodeError(err);
    if (error.kind !== "contract") throw err;
    if (!options.evidence) return { hash: null, error, receipt: null };
    const hash = await sender.send({ ...tx, gas: EVIDENCE_GAS_LIMIT });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
    return { hash, error, receipt };
  }
  const hash = await sender.send(tx);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") {
    return { hash, error: { kind: "contract", name: "Reverted", message: "The transaction was mined but reverted." }, receipt };
  }
  return { hash, error: null, receipt };
}
