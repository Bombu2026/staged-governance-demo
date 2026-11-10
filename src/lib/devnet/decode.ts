import { SYSTEM_PROGRAM_ID } from "./constants";

export interface DecodedTransfer {
  from: string;
  to: string;
  lamports: bigint;
}

const SYSTEM_TRANSFER = 2;

// Reads a System Program transfer out of a compiled instruction (as stored in a Squads vault transaction).
export function decodeSystemTransfer(
  accountKeys: readonly string[],
  instruction: { programIdIndex: number; accountIndexes: ArrayLike<number>; data: ArrayLike<number> },
): DecodedTransfer | null {
  if (accountKeys[instruction.programIdIndex] !== SYSTEM_PROGRAM_ID) return null;
  const data = Uint8Array.from(instruction.data);
  if (data.length !== 12) return null;
  const view = new DataView(data.buffer);
  if (view.getUint32(0, true) !== SYSTEM_TRANSFER) return null;
  const from = accountKeys[instruction.accountIndexes[0]];
  const to = accountKeys[instruction.accountIndexes[1]];
  if (!from || !to) return null;
  return { from, to, lamports: view.getBigUint64(4, true) };
}
