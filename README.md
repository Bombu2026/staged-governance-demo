# Pooled funding and staged governance: two concept demos for Slop

> Independent concept demos. The simulations run in your browser. The optional live modes use test networks only (Base Sepolia and Solana devnet), where nothing has value. Not affiliated with or endorsed by slop.cash. The contracts are not audited.

Three pages that accompany a proposal to the Slop team:

- **`/` Pools.** Several funders fill one pool for an open-source build, all or nothing. Contributors list the pool with a Proof of Love vote. A full pool is paid to contributors by Points; any other pool is refunded in full. The page works on sample data, or on Base Sepolia once a wallet is connected, top right.
- **`/how-it-works`.** The two ways in, the rules, where the idea meets Slop today and what it leaves open.
- **`/governance` Staged governance.** Who can change the code and rules around funders' money: a multisig and a timelock on upgrades, an advisory Proof of Love vote, token governance later.

## Pooled funding

### The idea

Today one project owner funds a project's monthly pool on Slop. Pooled funding lets several parties fund one build together, from either side:

- **Company request.** A company needs something built. It posts the need and a budget and puts in the first pledge. Other companies with the same need add theirs.
- **Contributor proposal.** A contributor with Points offers to build something and names the budget, with no money down. Funders who want it fill the pool.

Both follow the same path:

1. **Propose.** A request with a first pledge, or a contributor proposal with none.
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

### The pools page

The page is laid out like slop.cash: a header with the wallet on the right, a board of pool cards under a "Pools" heading with an "Open a pool" button, and one page per pool with its vault bar, figures, funders, vote and payout.

- **The board** filters company requests and contributor proposals. Each card shows the target, what the pool holds, its status and its clock.
- **A pool page** has one action card for what you can do now (vote, pledge, launch, refund, pay, ask for a closure vote) and a card marked "Demo" for the rest of the cast: the other contributors, the other companies, the maintainers. Other people would act on their own; here you play them with one click.
- **Open a pool** offers both directions side by side: "Request a build" for a company, with a first pledge, or "Propose a build" for a contributor, with no money down.
- **Activity** lists every action, refused ones included with the reason. A blocked button still takes the click, so you can read why the rules refuse.

Two engines feed the same interface (`src/components/pools/app/`):

**Sample data** (no wallet). Five sample pools, one at each stage: a company request open for pledges, a contributor proposal in its listing vote, a build ready to be paid, a pool already paid by Points, and a proposal that missed its target and was refunded. They are built by replaying real actions, and a test checks the rules refuse none of them. You act as one sample person at a time, chosen top right: four companies and seven contributors. A company can request and pledge, a contributor can propose and vote. A simulated clock moves the deadlines. State lives in React memory and is gone on reload.

**Base Sepolia** (wallet connected). Described under "Live mode" below.

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

**Deployment status.** Both contracts are deployed on Base Sepolia since 11 November 2026, and their source is verified on Sourcify and Blockscout:

| Contract | Deployment | Verified source |
| --- | --- | --- |
| Demo USDC | [transaction](https://sepolia.basescan.org/tx/0x75c118ed90298b59be299b9abad0366644c52c891788b6864dc300da45269018) | [Blockscout](https://base-sepolia.blockscout.com/address/0x92CC1185715c0BF1d6248440014B0E674fdD4301?tab=contract), [Sourcify](https://repo.sourcify.dev/84532/0x92CC1185715c0BF1d6248440014B0E674fdD4301) |
| PooledFunding | [transaction](https://sepolia.basescan.org/tx/0x45ec40be0a08cb085e35c6238e834d3c80b0f72f77a3f9e49b6663b282ec2f59) | [Blockscout](https://base-sepolia.blockscout.com/address/0xf7421ED306bdF20D97918982577b820c1c2e4F71?tab=contract), [Sourcify](https://repo.sourcify.dev/84532/0xf7421ED306bdF20D97918982577b820c1c2e4F71) |

They were deployed with `DEPLOYER_PRIVATE_KEY=0x... bun run contracts:deploy` and verified with `bun run contracts:verify`. On a chain where the addresses are still empty, the deployment is two transactions that anyone can send once, for everyone: from a terminal with that command and a throwaway key, or from the page, which offers "Deploy the contracts" when a connected wallet finds them missing.

### Live mode on Base Sepolia

Connect a browser wallet such as Phantom with the button top right, and the same page runs on the contract. Your wallet is both a company and a contributor: it holds demo USDC and Points, so it can request a build, propose a build, pledge and vote itself. Throwaway keys generated in the tab play the steward, three sample contributors and two other companies; they are kept in `sessionStorage` so a reload can resume the sandbox.

1. **Connect.** The page finds wallets through EIP-6963, then `window.phantom.ethereum` and `window.ethereum`, asks for the account and asks the wallet to be on Base Sepolia.
2. **Set up your sandbox.** One prompt sends a little testnet ETH to the steward key for gas. With no further prompt, the demo keys create your own space on the contract, record sample Points for you and three contributors, mint 100,000 demo USDC to you and to companies B and C, and open two sample pools: a company request of 50,000 with a first pledge of 10,000, already listed, and a contributor proposal of 30,000 whose listing vote is open.
3. **Use the page.** Vote with your Points (one prompt), pledge (two prompts: an approval for exactly that amount, then `pledge`), open a request (approval, then `propose`) or propose a build (one prompt, no money). Steps anyone may take, such as closing a vote, launching a full pool or refunding, are sent by a demo key with no prompt. The steward key posts the sample record of accepted work at payout; your wallet is one of the payees.
4. **Play the rest of the cast** from the "Demo" card: the sample contributors vote, companies B and C pledge, company B asks for a closure vote.

Votes stay open for an hour, so nothing expires while you look around; a vote still closes as soon as one side holds a majority of all power. When you open a pool you choose its funding window: 1 minute to watch it miss its target and refund, 10 minutes, or 7 days.

A blocked step that a demo key would send (closing a vote early, launching a partial pool, refunding an open pool, paying during a closure vote) is still sent on-chain with a fixed gas limit, so the refusal is recorded as a reverted transaction with a BaseScan link in the activity list. A blocked step your wallet would sign is not sent: the page says why and asks for nothing.

Safety rules in the code (`src/lib/pools/chain/`):

- The RPC URL and the chain id are constants (`https://sepolia.base.org`, 84532); the page has no setting for another network. Before anything is sent, the page checks that the RPC answers with that chain id.
- The wallet is used for `eth_requestAccounts`, `eth_chainId`, the network switch and `eth_sendTransaction` only. The page never asks for a message or typed-data signature.
- Before every wallet request the page checks that the wallet is on Base Sepolia and that the transaction goes to one of the two demo contracts or the deployment proxy with no ETH attached. Plain ETH can only go to the steward demo key.
- Approvals are for the exact amount about to be pledged, never unlimited.
- Next to each button the page says how many prompts it takes and who signs. Nothing about your wallet is stored beyond its address in memory.

You need a little Base Sepolia ETH for gas; the page links to the [list of faucets](https://docs.base.org/get-started/get-funds#testnet-base-sepolia). In Phantom, open Settings → Developer Settings, turn on Testnet Mode and choose Base Sepolia as the test network: Phantom shows and uses only the test network chosen there, and does not follow a page that asks it to switch.

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
bun run contracts:verify # publish their source on Sourcify and Blockscout, once deployed
bun run sepolia:check    # play three pools on the real Base Sepolia, no browser (needs CHECK_PRIVATE_KEY)
bun run devnet:check     # headless Squads v4 check on Solana devnet (needs devnet SOL)
```

Without `bun run vault`, both pages still work and the vault window explains that its data has not been generated.

## Tests

`bun run test` needs no network and no testnet funds.

- `src/lib/pools/sim.test.ts` and `math.test.ts` cover the simulation and the integer rules: square roots, power, quorum, early closing, fee and split.
- `src/lib/pools/contract.test.ts` starts a local chain (anvil, a dev dependency, answering with the Base Sepolia chain id) and drives the real contracts with the same client code the page uses: deployment at the derived addresses, every refusal by name, exact payouts and refunds, and the wallet guard.
- The last test of that file replays one story, action by action, in the simulation and on the contract, and compares every tally, status, balance, payout and refund. The simulation and the contract are two implementations of one set of rules, and this test keeps them equal.
- `src/lib/pools/chain/chain.test.ts` covers address derivation, error decoding, wallet discovery, the network switch and the session format.
- `src/lib/pools/demo-seed.test.ts` checks that the five sample pools are built by actions the rules accept, and that they show one pool at each stage.
- The remaining test files cover the governance state machine, the Proof of Love comparison, the vault index and Markdown safety, and the Solana devnet helpers.

Two browser tests click through the pages. They need Playwright with a Chromium build (`bun add -d playwright && bunx playwright install chromium`) and a running `bun run dev`:

```sh
bun run e2e:sim    # the pools page on its sample data
bun run e2e:live   # the pools page with a connected wallet, end to end
```

`e2e:sim` plays both directions as sample people: a company request refused while partial, filled, launched and paid by Points; a contributor proposal that a company cannot vote on, listed by contributors, then missing its target and refunded; one new pool from each side; and a build closed by vote.

By default `e2e:live` uses no testnet: it routes the page's requests for the Base Sepolia RPC to a local anvil chain and injects a stand-in wallet announced as "Phantom". It deploys both contracts from the page, sets up the sandbox, plays the two sample pools (the request paid by Points with the wallet among the payees, the proposal listed after the wallet's vote), then opens one pool from each side with the wallet: a proposal that misses its one-minute window and refunds, and a request closed by vote. It also checks that the wallet was only ever asked for accounts, the chain id and transactions, and that a reload resumes the sandbox.

Two checks run on the real network, with a key that holds about 0.001 Base Sepolia ETH (a key for testnet ETH only):

```sh
CHECK_PRIVATE_KEY=0x... bun run sepolia:check
E2E_NETWORK=base-sepolia E2E_PRIVATE_KEY=0x... bun run e2e:live
```

`sepolia:check` needs no browser. It deploys the contracts if they are missing, creates throwaway keys and plays the same three pools with the page's client code, printing every transaction as a BaseScan link, refusals included as reverted transactions, and sends the unspent gas back at the end. The second command runs the browser test against the real network with nothing intercepted; the stand-in wallet signs with the given key.

On 11 November 2026 `sepolia:check` passed on Base Sepolia with 60 transactions. Three of them: the [payout by Points](https://sepolia.basescan.org/tx/0x7f21bcc8e12d009f2e1e00b64d0cdf8454fec7235154bce626312c47c5021ab8) of the first pool (23,058.823529, 8,647.058823 and 17,294.117648 demo USDC, plus the 1,000 fee), the [refund](https://sepolia.basescan.org/tx/0x0759a64bf1913ad4200468a78e389b0466e948ad2ddcf626b912ca6dd1ae6767) after the second pool missed its target, and the refused [second refund](https://sepolia.basescan.org/tx/0x355989aba13aae39bdf5acaca6c5b52d83ef938dece8e2c8187edaefcfdee249) of the same pledge (`NothingToRefund`).

The same day `e2e:live` passed against the real network with the current interface and nothing intercepted: the sandbox setup, the two sample pools, then one pool opened from each side by the wallet, with 45 transactions linked in the activity list. A first run had shown an empty board for a few seconds after the setup; that is fixed. The public endpoint answered 429 (too many requests) to 29 of the page's requests in that run; the page retried each of them. The page has since been made to ask less often.

What has not been run to the end: the pools page with a real Phantom wallet. A first real connection showed that Phantom must have Base Sepolia chosen as its test network; the page and this README now say so.

## Layout

- `contracts/` holds the two Solidity sources; `scripts/compile-contracts.mjs` compiles them with the pinned solc-js, `scripts/deploy-contracts.ts` deploys them and `scripts/verify-contracts.ts` publishes their source to explorers with the same compiler input.
- `src/lib/pools/math.ts` holds the integer rules shared by the simulation, the live mode and the tests. `src/lib/pools/sim.ts` is the simulation's pure state machine (`initialState`, `reduce`, `refusal`), with refusals named like the contract's errors.
- `src/lib/pools/chain/` holds the live mode: constants, address derivation, the RPC and wallet guards (`core.ts`), transaction builders and readers (`actions.ts`), error decoding, wallet discovery and the session format. Functions take a client and a sender, so the tests and the deploy script drive them without a browser.
- `src/lib/pools/demo-seed.ts` replays the actions that build the five sample pools.
- `src/components/pools/app/` holds the pools page. `engine.ts` is the view model; `use-demo-engine.ts` feeds it from the simulation and `use-live.ts` from the contract. The screens (`home-view.tsx`, `pool-view.tsx`, `open-pool.tsx`, `setup-view.tsx`) and the header's `wallet-menu.tsx` only know the view model. `src/components/pools/how-it-works.tsx` is the explanation page.
- `src/lib/governance.ts` and `src/lib/vote.ts` hold the staged-governance state machine and the Proof of Love comparison; `src/lib/devnet/` holds the Solana live mode; `src/components/demo.tsx` and its stage components render that page.
- `src/lib/vault-index.ts` and `src/lib/vault-markdown.ts` serve the vault window under `src/components/vault/`.
- `next.config.ts` sends a Content-Security-Policy header. It has no `script-src` directive, because the statically generated pages rely on inline bootstrap scripts from Next.js, and no `connect-src`, so the live modes can reach their RPC endpoints.

## Next steps

- Play the pools page to the end on the real network with a real Phantom wallet.
- An open-source governance agent that answers questions grounded in the vault is planned. It is not built yet.

## Licence

The code in this repository, contracts included, is under the MIT licence (see `LICENSE`). The vault notes are not part of it and remain under CC BY-SA 4.0 in their own repository.
