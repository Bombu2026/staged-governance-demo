# Staged governance: a concept demo

> Independent concept demo. The simulation runs in your browser; the optional live mode uses Solana devnet only, where SOL has no value. Not affiliated with or endorsed by slop.cash.

A one-page interactive companion to a governance proposal for an open-source bounty platform. It lets a reader click through a staged path and feel the difference at each step:

1. **Guard the upgrade key.** Compare today's single owner key, which upgrades the vault logic instantly, with a 2-of-3 multisig plus a 48 h timelock and an emergency pause. Try a stolen key in both setups and watch the exit window that the timelock gives funders.
2. **Proof of Love vote.** Voting power comes from soulbound accepted-work Points and depends on the proposal's domain: Points in that domain count 1.0, Points in the other three count 0.25, and power is the square root of the result, so specialists weigh more on their own domain and volume alone does not decide. Three sample proposals each keep their own ballots, a 40% quorum of the power available on that proposal applies, and a comparison line shows what 1 Point = 1 vote would have decided on the same ballots. The result is advisory and moderators adopt or veto it.
3. **Token governance.** Not simulated: a short list of the design questions to answer before a token exists.

The simulation has no wallet, no blockchain and no backend. Its state lives in React memory and is gone on reload. Every signer, contributor, balance and Points figure is sample data.

## Live mode on Solana devnet

Below the stage 1 simulation, a panel titled "Run it for real on Solana devnet" lets a visitor play the same story with real transactions on devnet, using their Phantom wallet. It relies on the existing [Squads Protocol v4](https://github.com/Squads-Protocol/v4) multisig program (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, the address the Squads repository lists for devnet) and adds no custom on-chain program: every refusal the visitor sees comes from Squads.

1. The visitor connects Phantom. The page generates two throwaway demo keys, B and C, held only in the tab's sessionStorage so a reload can resume the demo.
2. One Phantom prompt sends three System Program transfers: 0.05 SOL to the multisig vault and 0.015 SOL to each demo key for fees and rent. Demo key B then creates the multisig without a prompt: members are the visitor, B and C, any 2 of 3 approve, 60 s time lock, no config authority.
3. A second prompt proposes a vault transaction (0.01 SOL from the vault back to the visitor's wallet, standing in for an upgrade) and approves it with the visitor's key. Executions are submitted by demo key B: at 1 of 2 the program refuses with `InvalidProposalStatus`; after B approves, it refuses with `TimeLockNotReleased` until the 60 s time lock has passed on the chain clock; then it executes.
4. Stolen key: demo key C proposes a vault drain and approves it alone. Executing fails with `InvalidProposalStatus` and approving again fails with `AlreadyApproved`.

Every confirmed or refused transaction lands in the event log with a Solana Explorer link (`?cluster=devnet`). The Solana and Squads libraries load only when the visitor opens the panel.

Safety rules in the code (`src/lib/devnet/`):

- The RPC URL is a constant (`https://api.devnet.solana.com`); there is no setting, environment variable or control for another cluster. Before the first request, the page checks the devnet genesis hash (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, from the Anza cluster docs) and that the Squads program is executable there.
- Phantom is used for `connect` and `signTransaction` only. The page never calls `signMessage` or `signAndSendTransaction`, checks that the signed message is byte-for-byte the one it built, and sends it to devnet itself. A transaction built on a devnet blockhash is not valid on mainnet.
- Before each Phantom prompt the panel lists exactly what the transaction does. Nothing about the visitor's wallet is stored beyond its public key in memory.

Getting devnet SOL: in November 2026 the public devnet RPC answers `requestAirdrop` with HTTP 410 ("The RPC faucet is closed on this cluster"), so the panel has no airdrop button. It links to [faucet.solana.com](https://faucet.solana.com) and offers a "Refresh balance" button.

### Headless check

`bun run devnet:check` runs `scripts/devnet-check.mjs`, which proves the same rules on devnet without a browser: it generates throwaway keys in memory, funds them, creates a 2-of-3 multisig with a 30 s time lock, funds the vault, then shows that execution fails at 1 of 2 approvals, fails again before the time lock, and succeeds after it, printing every signature as an explorer link and a final PASS or FAIL. It refuses to run unless the RPC returns the devnet genesis hash. It never reads a wallet, keypair file or secret. When the RPC faucet refuses the airdrop, it prints the first key's address and waits up to 3 minutes for someone to fund it from faucet.solana.com.

## Knowledge vault window

A button in the header and another under the introduction open a read-only window onto the author's notes on DAO governance, laid out like Obsidian: a file tree with title and tag search on the left, the rendered note in the centre, and linked mentions plus a small local graph on the right. Wikilinks between notes work inside the window, and `#vault/<note-id>` in the URL opens a given note.

The notes come from [`Bombu2026/dao-vault`](https://github.com/Bombu2026/dao-vault) under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). They are not copied into this repository. `scripts/build-vault.mjs` reads the `Knowledge/` folder at a pinned commit and writes a generated, git-ignored snapshot to `public/vault/`: a compact `index.json` and one Markdown file per note, without front matter. The window fetches those static files only once it is opened. Each note links back to its source on GitHub at the same commit.

Note content is treated as untrusted text. It is rendered with `marked`, raw HTML from a note is escaped and shown as text, only `http`, `https` and `mailto` links are kept, and images are shown as links instead of being loaded.

The generator looks for the vault in this order: the `VAULT_DIR` environment variable, a sibling checkout at `../dao-vault`, then a shallow `git fetch` of the pinned commit into `.vault-cache/`. It stops with an error if it finds fewer than 1,000 notes.

## Run it

Requires [Bun](https://bun.sh) and Node.js (the generator is a plain Node script).

```sh
bun install
bun run vault      # generate public/vault from the pinned vault commit
bun run dev        # http://localhost:3000
bun run test       # Vitest: state machine, Markdown safety, vault index helpers, devnet helpers
bun run typecheck
bun run build      # runs the generator, then next build
bun run devnet:check   # headless Squads v4 check on Solana devnet (needs devnet SOL, see above)
```

Without `bun run vault`, the page still works and the vault window explains that its data has not been generated.

## Layout

- `src/lib/governance.ts` holds the pure state machine (`initialState`, `reduce`, `refusal`). Every rule lives there or in `src/lib/vote.ts` (sample contributors and proposals, effective Points, power, tallies and the 1 Point = 1 vote comparison), and a refused action only appends a log line with the reason. `src/lib/governance.test.ts` and `src/lib/vote.test.ts` cover those rules.
- `src/lib/vault-index.ts` parses the compact index and holds backlinks, wikilink resolution and search; `src/lib/vault-markdown.ts` is the Markdown renderer. Both have tests next to them.
- `src/lib/devnet/` holds the live mode: `chain.ts` takes a `Connection` and signer callbacks so it can be driven from tests or scripts, and the other files are pure helpers (formatting, error names, time lock countdown, sessionStorage format) covered by `devnet.test.ts`. Its dependencies are `@solana/web3.js` 1.x (the API the Squads SDK is built on), `@sqds/multisig`, and `buffer`, which supplies the global `Buffer` that the Squads SDK's serializer expects in the browser.
- `src/components/` holds the client UI, with the vault window under `src/components/vault/` and the live mode under `src/components/devnet/`; `src/app/page.tsx` renders it.
- `next.config.ts` sends a Content-Security-Policy header. It has no `script-src` directive, because the statically generated page relies on inline bootstrap scripts from Next.js that a `'self'`-only policy blocks, and no `connect-src`, so the live mode can reach the devnet RPC.

## Next step

An open-source governance agent that answers questions grounded in the vault is planned. It is not built yet.

## Licence

The code in this repository is under the MIT licence (see `LICENSE`). The vault notes are not part of it and remain under CC BY-SA 4.0 in their own repository.
