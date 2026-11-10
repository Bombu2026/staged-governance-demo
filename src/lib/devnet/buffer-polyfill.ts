// @metaplex-foundation/beet (used by @sqds/multisig) calls the global `Buffer`, which browsers lack.
import { Buffer } from "buffer";

const scope = globalThis as { Buffer?: typeof Buffer };
scope.Buffer ??= Buffer;
