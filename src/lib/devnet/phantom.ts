// The subset of Phantom's injected provider this page uses. signMessage and signAndSendTransaction are
// deliberately absent: transactions are only signed by the wallet, then sent by the page to the devnet RPC.

export interface PhantomPublicKey {
  toBase58(): string;
}

export interface SerializableTransaction {
  serialize(): Uint8Array;
}

type Listener = (publicKey: PhantomPublicKey | null) => void;

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: PhantomPublicKey | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PhantomPublicKey }>;
  disconnect(): Promise<void>;
  signTransaction<T extends SerializableTransaction>(transaction: T): Promise<T>;
  on(event: "accountChanged" | "disconnect", listener: Listener): void;
  removeListener?(event: "accountChanged" | "disconnect", listener: Listener): void;
}

export function getPhantom(win: unknown): PhantomProvider | null {
  const provider = (win as { phantom?: { solana?: PhantomProvider } } | null)?.phantom?.solana;
  return provider?.isPhantom === true ? provider : null;
}
