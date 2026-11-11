// What survives a reload in sessionStorage: the throwaway demo keys and the sandbox they created.
// Nothing about the visitor's wallet is stored.

import type { Hex } from "viem";

export const DEMO_ROLES = ["steward", "contributorA", "contributorB", "contributorC", "companyB", "companyC", "fees"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export interface StoredDemo {
  keys: Record<DemoRole, Hex>;
  spaceId: bigint | null;
  // True once the sandbox is fully set up: Points recorded, demo USDC minted, sample pools opened.
  ready: boolean;
}

const PRIVATE_KEY = /^0x[0-9a-f]{64}$/;

export function serializeDemo(demo: StoredDemo): string {
  return JSON.stringify({ v: 2, keys: demo.keys, spaceId: demo.spaceId === null ? null : demo.spaceId.toString(), ready: demo.ready });
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
  const { v, keys, spaceId, ready } = data as Record<string, unknown>;
  if (v !== 2 || typeof keys !== "object" || keys === null || typeof ready !== "boolean") return null;
  const parsed = {} as Record<DemoRole, Hex>;
  for (const role of DEMO_ROLES) {
    const key = (keys as Record<string, unknown>)[role];
    if (typeof key !== "string" || !PRIVATE_KEY.test(key)) return null;
    parsed[role] = key as Hex;
  }
  if (new Set(Object.values(parsed)).size !== DEMO_ROLES.length) return null;
  if (spaceId !== null && (typeof spaceId !== "string" || !/^[1-9][0-9]{0,30}$/.test(spaceId))) return null;
  if (ready && spaceId === null) return null;
  return { keys: parsed, spaceId: spaceId === null ? null : BigInt(spaceId), ready };
}
