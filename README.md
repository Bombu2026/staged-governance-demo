# Staged governance: a concept demo

> Independent concept demo. The governance stages are simulated in your browser: no wallet, no chain, no funds. Not affiliated with or endorsed by slop.cash.

A one-page interactive companion to a governance proposal for an open-source bounty platform. It lets a reader click through a staged path and feel the difference at each step:

1. **Guard the upgrade key.** Compare today's single owner key, which upgrades the vault logic instantly, with a 2-of-3 multisig plus a 48 h timelock and an emergency pause. Try a stolen key in both setups and watch the exit window that the timelock gives funders.
2. **Advisory contributor vote.** Contributors vote with their accepted-work Points, a 40% quorum applies, and moderators adopt or veto the advisory result.
3. **Token governance.** Not simulated: a short list of the design questions to answer before a token exists.

The simulation has no wallet, no blockchain and no backend. Its state lives in React memory and is gone on reload. Every signer, contributor, balance and Points figure is sample data.

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
bun run test       # Vitest: state machine, Markdown safety, vault index helpers
bun run typecheck
bun run build      # runs the generator, then next build
```

Without `bun run vault`, the page still works and the vault window explains that its data has not been generated.

## Layout

- `src/lib/governance.ts` holds the pure state machine (`initialState`, `reduce`, `refusal`). Every rule lives there, and a refused action only appends a log line with the reason. `src/lib/governance.test.ts` covers those rules.
- `src/lib/vault-index.ts` parses the compact index and holds backlinks, wikilink resolution and search; `src/lib/vault-markdown.ts` is the Markdown renderer. Both have tests next to them.
- `src/components/` holds the client UI, with the vault window under `src/components/vault/`; `src/app/page.tsx` renders it.
- `next.config.ts` sends a Content-Security-Policy header. It has no `script-src` directive, because the statically generated page relies on inline bootstrap scripts from Next.js that a `'self'`-only policy blocks.

## Next step

An open-source governance agent that answers questions grounded in the vault is planned. It is not built yet.

## Licence

The code in this repository is under the MIT licence (see `LICENSE`). The vault notes are not part of it and remain under CC BY-SA 4.0 in their own repository.
