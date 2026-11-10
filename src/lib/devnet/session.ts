// What survives a reload in sessionStorage: the two throwaway demo keys, nothing about the visitor's wallet.
// The multisig address is derived from key B (it doubles as the Squads `createKey`), so it needs no storage.

export interface StoredDemo {
  keyB: Uint8Array;
  keyC: Uint8Array;
}

const SECRET_KEY_BYTES = 64;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const s = atob(text);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function serializeDemo(demo: StoredDemo): string {
  return JSON.stringify({ v: 1, b: toBase64(demo.keyB), c: toBase64(demo.keyC) });
}

export function parseDemo(raw: string | null): StoredDemo | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { v, b, c } = data as Record<string, unknown>;
  if (v !== 1 || typeof b !== "string" || typeof c !== "string" || b === c) return null;
  const keyB = fromBase64(b);
  const keyC = fromBase64(c);
  if (keyB?.length !== SECRET_KEY_BYTES || keyC?.length !== SECRET_KEY_BYTES) return null;
  return { keyB, keyC };
}
