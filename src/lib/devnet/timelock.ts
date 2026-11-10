// Squads lets a proposal execute once `clock.unix_timestamp - approvedAt >= timeLock`, using the on-chain
// clock. The countdown therefore runs on chain time: local time plus the skew last measured from the Clock sysvar.

const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

export function parseClockUnixTimestamp(data: Uint8Array): number {
  if (data.length < CLOCK_UNIX_TIMESTAMP_OFFSET + 8) throw new Error("Clock sysvar data is too short");
  return Number(new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(CLOCK_UNIX_TIMESTAMP_OFFSET, true));
}

export const clockSkewSeconds = (chainUnixTimestamp: number, localNowMs: number) => chainUnixTimestamp - localNowMs / 1000;

export const chainNowSeconds = (localNowMs: number, skewSeconds: number) => localNowMs / 1000 + skewSeconds;

export const releaseAt = (approvedAt: number, timeLockSeconds: number) => approvedAt + timeLockSeconds;

export function secondsRemaining(approvedAt: number, timeLockSeconds: number, chainNow: number): number {
  return Math.max(0, Math.ceil(releaseAt(approvedAt, timeLockSeconds) - chainNow));
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
