# Pooled funding and staged governance: two concept demos for Slop

> Independent concept demos. The simulations run in your browser. The optional live modes use test networks only (Base Sepolia and Solana devnet), where nothing has value. Not affiliated with or endorsed by slop.cash. The contracts are not audited.

Two interactive pages that accompany a proposal to the Slop team:

- **`/` Pooled funding.** Several funders fill one pool for an open-source build, all or nothing. Contributors list the pool with a Proof of Love vote. A full pool is paid to contributors by Points; any other pool is refunded in full.
- **`/governance` Staged governance.** Who can change the code and rules around funders' money: a multisig and a timelock on upgrades, an advisory Proof of Love vote, token governance later.

## Pooled funding

### The idea

Today one project owner funds a project's monthly pool on Slop. Pooled funding lets several parties fund one build together, from either side:

- **Request.** A company needs something built. It posts the need and a budget and puts in the first pledge. Other companies with the same need add theirs.
- **Community proposal.** A contributor with Points proposes a build and a budget, with no money down. Funders who want it fill the pool.

Both follow the same path:

1. **Propose.** A request with a first pledge, or a community proposal with none.
2. **Contributors vote.** A Proof of Love vote lists the pool or not. Power comes from Points earned through accepted work, never from money.
3. **The pool fills, or not.** Funders pledge until the deadline. Pledges are locked meanwhile, so the total everyone sees is real.
4. **Paid by Points, or refunded.** Full by the deadline: the build launches and the pool is paid to contributors by share of project Points, less the 2% fee Slop publishes for payouts. Not full: every pledge goes back, with no fee.

### The rules

| Rule | What it means | Refusal in the contract |
| --- | --- | --- |
| All or nothing | A pool launches only when it holds its full target. | `TargetNotReached` |
| Refund in full | Not listed, missed its target or closed by vote: each funder gets back exactly what they put in. Anyone can trigger a refund and it can only go to the funder. | `RefundNotAvailable`, `NothingToRefund` |
| Pledges are locked while the pool is open | Nobody can pull out before the deadline. A pledge larger than what is missing is cut down to it. | `RefundNotAvailable`, `PoolFull` |
| Contributors list the pool | Only accounts with Points vote. Power is the square root of effective Points on the pool's domain (Points in the domain × 1.0, in the three others × 0.25). Quorum is 40% of the power available. A vote closes after its period, or earlier once the result can no longer change. | `NoVotingPower`, `VoteStillOpen` |
| A stalled build can be closed | Before payout, a funder of the pool or a contributor can ask for a closure vote. If it passes, the whole pool is refunded. No payout while it is open. After a failed closure vote, the next one waits one voting period, so repeated votes cannot block a payout. | `ClosureVoteOpen`, `ClosureCooldown` |
| Paid by share of project Points | The record of accepted work is posted by the space's steward, as Slop's scoring does today. The split, the 2% fee and the rounding are computed by the contract. | `NoAcceptedWork`, `NotSteward` |
| No admin key | No owner, no pause, no upgrade path. | none: the functions do not exist |

The weights, the square root, the 40% quorum, the voting and funding periods and the 2% fee are sample parameters of this demo.

### The simulation

The page starts with two sample pools, one per direction: a listed request of 50,000 USDC opened by `company-a` with 10,000, and a community proposal of 30,000 USDC whose listing vote is open. You pledge as any of four sample companies, vote as any of seven sample contributors, move a simulated clock, accept sample work, pay out, ask for a closure vote, or open your own pool from a form. Every action lands in an event log, refused ones included with the reason.

State lives in React memory and is gone on reload. Companies, contributors, wallets and Points are sample data.

### The contracts

`contracts/PooledFunding.sol` holds the pools, the votes and the money. `contracts/DemoUSDC.sol` is a stand-in for USDC with an open faucet. Both are plain Solidity with no dependency.

- A **space** is one community with its own Points book. Its steward writes Points (`setPoints`) and posts the payout record (`payOut`); Slop's scoring pipeline would hold that role. Points are soulbound: no function moves them between accounts.
- `propose` opens a pool and its listing vote, `vote` and `finalize` run the vote, `pledge`, `launch` and `refund` move the money, `openClosure` starts a closure vote.
- Money is in integer units of a 6-decimal token. A payout rounds down for each payee and the last one takes the remainder, so the pool always empties exactly.

The compiled ABI and bytecode are committed in `src/lib/pools/generated/contracts.ts` (solc 0.8.38, optimizer 200 runs, `evmVersion: paris`, no metadata), and a test fails if they differ from a fresh compile. `paris` keeps the bytecode free of newer opcodes, so the same build runs on Base, Ethereum and Robinhood Chain.

Both contracts are deployed through the [deterministic deployment proxy](https://github.com/Arachnid/deterministic-deployment-proxy) with a fixed salt, so their addresses derive from the committed bytecode:

| Contract | Address on Base Sepolia |
| --- | --- |
| Demo USDC | `0x92CC1185715c0BF1d6248440014B0E674fdD4301` |
| PooledFunding | `0xf7421ED306bdF20D97918982577b820c1c2e4F71` |

Whoever sends the deployment, a contract found at one of these addresses can only be this code. Changing one byte of a contract moves both addresses; a test pins them.

**Deployment status.** On 11 November 2026 nothing is deployed at these addresses yet: no testnet ETH was available when this was built. The deployment is two transactions that anyone can send once, for everyone:

- from the page: connect a wallet in the live panel and press "Deploy the contracts", or
- from a terminal: `DEPLOYER_PRIVATE_KEY=0x... bun run contracts:deploy`, with a throwaway key that only holds Base Sepolia ETH.

### Live mode on Base Sepolia

Below the simulation, a panel runs the same story with real transactions on Base Sepolia. You connect a browser wallet such as Phantom (testnet mode on) and play one funder, "Company A". Throwaway keys generated in the tab play the steward, three contributors and two other companies; they are kept in `sessionStorage` so a reload can resume the sandbox.

1. **Connect.** The page lists the wallets it finds (EIP-6963, then `window.phantom.ethereum` and `window.ethereum`), asks for the account and asks the wallet to switch to Base Sepolia.
2. **Contracts.** If they are not deployed yet, two prompts deploy them (see above).
3. **Sandbox.** One prompt sends a little testnet ETH to the steward key for gas. With no further prompt, that key forwards gas to the other keys, creates a space with 60 s votes, records sample Points for three contributors and mints 100,000 demo USDC to you and to companies B and C.
4. **Open a pool**, from either side: a request from your wallet with a first pledge of 10,000 (two prompts: an approval for exactly that amount, then `propose`), or a community proposal signed in the page by contributor A. The target is 50,000 demo USDC and the funding window is 120 s.
5. **Vote.** The three contributors vote from the page. The contract computes each power from the Points it stores. Closing the vote too early is refused with `VoteStillOpen`.
6. **Fill the pool, or let it miss.** You pledge from your wallet (approval, then `pledge`), companies B and C from the page. Launching a partial pool is refused with `TargetNotReached`, refunding an open pool with `RefundNotAvailable`. If the deadline passes below the target, one button refunds everyone.
7. **Build, then pay by Points.** The steward posts a sample record of accepted work and the contract pays the three contributors and the fee wallet. Or company B asks for a closure vote, and if it passes everyone is refunded.

The refusals the panel invites you to try (closing a vote early, launching a partial pool, refunding an open pool) are also sent on-chain with a fixed gas limit, so each one is recorded as a reverted transaction with a BaseScan link in the event log.

Safety rules in the code (`src/lib/pools/chain/`):

- The RPC URL and the chain id are constants (`https://sepolia.base.org`, 84532); the page has no setting for another network. Before anything is sent, the page checks that the RPC answers with that chain id.
- The wallet is used for `eth_requestAccounts`, `eth_chainId`, the network switch and `eth_sendTransaction` only. The page never asks for a message or typed-data signature.
- Before every wallet request the page checks that the wallet is on Base Sepolia and that the transaction goes to one of the two demo contracts or the deployment proxy with no ETH attached. Plain ETH can only go to the steward demo key.
- Approvals are for the exact amount about to be pledged, never unlimited.
- Before each prompt the panel lists what the transaction does. Nothing about your wallet is stored beyond its address in memory.

You need a little Base Sepolia ETH for gas; the page links to the [list of faucets](https://docs.base.org/get-started/get-funds#testnet-base-sepolia). In Phantom, Base Sepolia appears once Testnet Mode is on (Settings → Developer Settings).

### Where it meets Slop today

Checked on 11 November 2026 against Slop's [token transparency filing](https://blockworks.com/token-transparency/filing/slop-cash) (self-reported, as of 25 October 2026), the public [project list](https://slop.cash/api/v1/projects) and the [auction press release](https://cryptobriefing.com/slop-cash-from-elizaos-creator-shaw-walters-opens-public-bidding-on-umia-after-passing-its-400k-minimum/) of 7 November 2026:

- Slop's vault contracts are deployed on Base, Ethereum, Solana and Robinhood Chain. Of 33 listed projects, 18 declare a USDC pool on Base, 12 a pool on Solana and 2 a USDG pool on Robinhood Chain. That is why the pool contract is EVM and the live mode uses Base Sepolia.
- `$SLOP` is deployed on Robinhood Chain, an Ethereum layer 2, not on Solana or Base. Holders steer the treasury through Umia decision markets, and the token has no say over payouts, scores or merges. This concept does not touch it: Proof of Love here is a separate contributor vote with two powers only, listing a pool and closing one before it is paid.
- Payouts by Points and the 2% payout fee are Slop's own rules, reused as they are.
- The `$SLOP` auction had a minimum raise below which every bid would have been refunded. Pooled funding applies the same rule to a build.

### Open questions

- Who accepts the work on a pooled build: maintainers named in the proposal, the funders, or a contributor vote. The demo takes the record as given.
- One payout or monthly cycles. The demo pays once; cycles with a cap would let a closure vote return only what is unspent.
- Points snapshots. Here a ballot uses the voter's Points when it is cast, and the quorum uses the power available when the vote opened.
- A launched pool that is neither paid nor closed stays locked. A production version needs a rule for that, such as a build deadline after which funders can leave.
- What pledges are legally: invoicing, tax and custody for companies that pool money.

## Staged governance

The second page lets a reader click through a staged path:

1. **Guard the upgrade key.** Compare a single owner key, which upgrades the vault logic instantly, with a 2-of-3 multisig plus a 48 h timelock and an emergency pause. Try a stolen key in both setups and watch the exit window that the timelock gives funders.
2. **Proof of Love vote.** Voting power comes from soulbound accepted-work Points and depends on the proposal's domain. Three sample proposals each keep their own ballots, a 40% quorum applies, and a comparison line shows what 1 Point = 1 vote would have decided on the same ballots. The result is advisory and moderators adopt or veto it.
3. **Token governance.** Not simulated: a short list of design questions.

### Live mode on Solana devnet

Below the stage 1 simulation, a panel plays the same story with real transactions on Solana devnet through a Phantom wallet. It relies on the existing [Squads Protocol v4](https://github.com/Squads-Protocol/v4) multisig program (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`) and adds no on-chain program: every refusal comes from Squads. The visitor and two throwaway demo keys form a 2-of-3 multisig with a 60 s time lock; executing at 1 of 2 approvals fails with `InvalidProposalStatus`, executing before the time lock fails with `TimeLockNotReleased`, and a stolen key acting alone gets nowhere.

Slop's vault contracts run on Base, Ethereum, Robinhood Chain and Solana. This example uses the Solana side; on the EVM networks the same guard is a multisig wallet with a timelock in front of the upgrade key.

Safety rules in the code (`src/lib/devnet/`): the RPC URL is a constant (`https://api.devnet.solana.com`), the page checks the devnet genesis hash before the first request, Phantom is used for `connect` and `signTransaction` only, and the page checks that the signed message is byte for byte the one it built before sending it to devnet itself.

The public devnet RPC refuses `requestAirdrop` ("The RPC faucet is closed on this cluster"), so the panel links to [faucet.solana.com](https://faucet.solana.com). `bun run devnet:check` proves the same rules from a terminal with throwaway keys; it waits up to 3 minutes for someone to fund its first key from the faucet.

## Knowledge vault window

A button in the header opens a read-only window onto the author's notes on DAO governance, laid out like Obsidian: a file tree with search, the rendered note, and linked mentions with a small local graph. `#vault/<note-id>` in the URL opens a given note.

The notes come from [`Bombu2026/dao-vault`](https://github.com/Bombu2026/dao-vault) under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). They are not copied into this repository. `scripts/build-vault.mjs` reads the `Knowledge/` folder at a pinned commit and writes a generated, git-ignored snapshot to `public/vault/`. Note content is treated as untrusted text: raw HTML is escaped, only `http`, `https` and `mailto` links are kept, and images are shown as links.

The generator looks for the vault in this order: the `VAULT_DIR` environment variable, a sibling checkout at `../dao-vault`, then a shallow `git fetch` of the pinned commit into `.vault-cache/`.

## Run it

Requires [Bun](https://bun.sh) and Node.js.

```sh
bun install
bun run vault            # generate public/vault from the pinned vault commit
bun run dev              # http://localhost:3000
bun run test             # Vitest, including the contracts on a local chain
bun run typecheck
bun run build            # runs the vault generator, then next build
bun run contracts        # recompile contracts/ into src/lib/pools/generated/contracts.ts
bun run contracts:check  # fail if the committed bytecode differs from a fresh compile
bun run contracts:deploy # deploy both contracts to Base Sepolia (needs DEPLOYER_PRIVATE_KEY)
bun run devnet:check     # headless Squads v4 check on Solana devnet (needs devnet SOL)
```

Without `bun run vault`, both pages still work and the vault window explains that its data has not been generated.

## Tests

`bun run test` needs no network and no testnet funds.

- `src/lib/pools/sim.test.ts` and `math.test.ts` cover the simulation and the integer rules: square roots, power, quorum, early closing, fee and split.
- `src/lib/pools/contract.test.ts` starts a local chain (anvil, a dev dependency, answering with the Base Sepolia chain id) and drives the real contracts with the same client code the page uses: deployment at the derived addresses, every refusal by name, exact payouts and refunds, and the wallet guard.
- The last test of that file replays one story, action by action, in the simulation and on the contract, and compares every tally, status, balance, payout and refund. The simulation and the contract are two implementations of one set of rules, and this test keeps them equal.
- `src/lib/pools/chain/chain.test.ts` covers address derivation, error decoding, wallet discovery, the network switch and the session format.
- The remaining test files cover the governance state machine, the Proof of Love comparison, the vault index and Markdown safety, and the Solana devnet helpers.

Two browser tests click through the pages. They need Playwright with a Chromium build (`bun add -d playwright && bunx playwright install chromium`) and a running `bun run dev`:

```sh
bun run e2e:sim    # the whole simulation
bun run e2e:live   # the live panel, end to end
```

`e2e:live` uses no testnet: it routes the page's requests for the Base Sepolia RPC to a local anvil chain and injects a stand-in wallet announced as "Phantom". It deploys both contracts from the page, then plays three pools: paid out, refunded after a missed target, and closed by vote. It also checks that the wallet was only ever asked for accounts, the chain id and transactions.

What has not been run: the live panel against the real Base Sepolia network with a real Phantom wallet. That needs testnet ETH.

## Layout

- `contracts/` holds the two Solidity sources; `scripts/compile-contracts.mjs` compiles them with the pinned solc-js and `scripts/deploy-contracts.ts` deploys them.
- `src/lib/pools/math.ts` holds the integer rules shared by the simulation, the live mode and the tests. `src/lib/pools/sim.ts` is the simulation's pure state machine (`initialState`, `reduce`, `refusal`), with refusals named like the contract's errors.
- `src/lib/pools/chain/` holds the live mode: constants, address derivation, the RPC and wallet guards (`core.ts`), transaction builders and readers (`actions.ts`), error decoding, wallet discovery and the session format. Functions take a client and a sender, so the tests and the deploy script drive them without a browser.
- `src/components/pools/` holds the page: `pools-demo.tsx`, the pool detail, the new-pool form and, under `live/`, the testnet panel, which loads viem only when opened.
- `src/lib/governance.ts` and `src/lib/vote.ts` hold the staged-governance state machine and the Proof of Love comparison; `src/lib/devnet/` holds the Solana live mode; `src/components/demo.tsx` and its stage components render that page.
- `src/lib/vault-index.ts` and `src/lib/vault-markdown.ts` serve the vault window under `src/components/vault/`.
- `next.config.ts` sends a Content-Security-Policy header. It has no `script-src` directive, because the statically generated pages rely on inline bootstrap scripts from Next.js, and no `connect-src`, so the live modes can reach their RPC endpoints.

## Next steps

- Deploy the two contracts on Base Sepolia and verify their source on BaseScan.
- Run the live panel once on the real network with Phantom.
- An open-source governance agent that answers questions grounded in the vault is planned. It is not built yet.

## Licence

The code in this repository, contracts included, is under the MIT licence (see `LICENSE`). The vault notes are not part of it and remain under CC BY-SA 4.0 in their own repository.
