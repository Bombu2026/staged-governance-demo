// Drives the pools page with a connected wallet in a real browser, end to end: the sandbox setup, the
// two sample pools (a company request paid by Points, a contributor proposal listed by vote), then one
// pool opened from each side with the wallet (a proposal that misses its target and refunds, a request
// closed by vote). A stand-in wallet, announced as "Phantom" through EIP-6963, answers the page.
//
// Local mode (default) needs no testnet: requests to the Base Sepolia RPC are routed to a local anvil
// chain with the same chain id, the wallet is one of anvil's unlocked accounts, and the contracts are
// deployed from the page.
//
//   bun run dev            (in another terminal)
//   bun run e2e:live       (BASE_URL defaults to http://localhost:3000)
//
// Real mode runs the same page against the real network, with nothing intercepted. The stand-in wallet
// signs with a key that holds about 0.001 Base Sepolia ETH (a key for testnet ETH only):
//
//   E2E_NETWORK=base-sepolia E2E_PRIVATE_KEY=0x... bun run e2e:live
//
// Needs Playwright with a Chromium build (`bun add -d playwright && bunx playwright install chromium`).
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const assert = require("node:assert");

const REPO = require("node:path").join(__dirname, "../..");
const REAL = process.env.E2E_NETWORK === "base-sepolia";
const PORT = 8599;
const LOCAL_RPC = `http://127.0.0.1:${PORT}`;
const PUBLIC_RPC = "https://sepolia.base.org";
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const CREATE2_CODE = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
// The real network confirms in seconds, not instantly.
const WAIT = REAL ? 120_000 : 30_000;

async function rpc(method, params = []) {
  const r = await fetch(LOCAL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

// What answers eth_sendTransaction: an unlocked anvil account, or a local key on the real network.
async function standInWallet() {
  if (!REAL) {
    const [address] = await rpc("eth_accounts");
    return { address, send: (params) => rpc("eth_sendTransaction", params) };
  }
  const key = process.env.E2E_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Set E2E_PRIVATE_KEY to a key that holds a little Base Sepolia ETH.");
  const { createWalletClient, http } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");
  const { baseSepolia } = require("viem/chains");
  const account = privateKeyToAccount(key);
  const client = createWalletClient({ account, chain: baseSepolia, transport: http(PUBLIC_RPC) });
  return {
    address: account.address,
    send: ([tx]) => client.sendTransaction({ to: tx.to, data: tx.data && tx.data !== "0x" ? tx.data : undefined, value: BigInt(tx.value ?? "0x0") }),
  };
}

(async () => {
  const base = process.env.BASE_URL || "http://localhost:3000";
  const anvil = REAL ? null : spawn(`${REPO}/node_modules/.bin/anvil`, ["--port", String(PORT), "--chain-id", "84532", "--silent"], { stdio: "ignore" });
  let browser;
  try {
    if (!REAL) {
      for (let i = 0; ; i++) {
        try { await rpc("eth_chainId"); break; } catch (e) { if (i > 100) throw e; await new Promise((r) => setTimeout(r, 50)); }
      }
      await rpc("anvil_setCode", [CREATE2_DEPLOYER, CREATE2_CODE]);
    }
    const wallet = await standInWallet();
    console.log(`${REAL ? "Base Sepolia (real network)" : "local chain"}, wallet ${wallet.address}, page ${base}`);

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    const walletCalls = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

    if (!REAL) {
      // The page only ever talks to the constant Base Sepolia RPC URL: every such request lands on anvil.
      await context.route(`${PUBLIC_RPC}/**`, async (route) => {
        const response = await fetch(LOCAL_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() });
        await route.fulfill({ status: 200, contentType: "application/json", body: await response.text() });
      });
    }
    await page.exposeFunction("__walletRpc", async (method, params) => {
      walletCalls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet.address];
      if (method === "eth_chainId") return "0x14a34";
      if (method === "eth_sendTransaction") return wallet.send(params);
      throw Object.assign(new Error(`The stand-in wallet does not support ${method}`), { code: 4200 });
    });
    await page.addInitScript(() => {
      const provider = { request: ({ method, params }) => window.__walletRpc(method, params ?? []), on() {}, removeListener() {} };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "e2e", name: "Phantom", rdns: "app.phantom", icon: "" }, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });

    await page.goto(base + "/", { waitUntil: REAL ? "load" : "networkidle" });
    const main = page.locator("main");
    const press = async (name, opts = {}) => {
      const loc = main.getByRole("button", { name, ...opts }).first();
      await loc.waitFor({ timeout: WAIT });
      await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
      // Blocked buttons are marked aria-disabled and still take the click, which records the refusal.
      await loc.click({ force: true });
    };
    const seen = (text, timeout = WAIT) => main.getByText(text).first().waitFor({ timeout });
    // One action at a time: the page shows what is in flight until the chain has been re-read.
    const idle = async () => {
      await page.waitForTimeout(150);
      await page.getByRole("status").filter({ hasText: /confirm in your wallet|waiting for Base Sepolia/ }).waitFor({ state: "detached", timeout: WAIT * 4 });
    };
    const act = async (name, opts) => { await press(name, opts); await idle(); };
    const lastEvent = () => main.locator("[data-activity] li").first().innerText();
    const shots = process.env.E2E_SHOTS;
    const shot = async (name) => { if (!shots) return; await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/live-${name}.png` }); };
    const step = (text) => console.log(`  ${text}`);
    const poolLink = (title) => main.getByRole("link", { name: title }).first();
    const links = new Set();
    const collect = async () => { for (const href of await main.locator('[data-activity] a[href^="https://sepolia.basescan.org/tx/0x"]').evaluateAll((as) => as.map((a) => a.href))) links.add(href); };
    const home = async () => { await collect(); await page.goto(`${base}/#/`); await main.getByRole("heading", { name: "Pools" }).waitFor({ timeout: WAIT }); };

    // The wallet sits top right. Connecting leads to the sandbox setup.
    await page.getByRole("button", { name: /Connect Phantom/ }).click();
    const deployButton = main.getByRole("button", { name: "Deploy the contracts" });
    await Promise.race([deployButton.waitFor({ timeout: WAIT }), main.getByRole("button", { name: "Set up the sandbox" }).waitFor({ timeout: WAIT })]);
    if (await deployButton.isVisible()) {
      await act("Deploy the contracts");
      step("deployed both contracts from the page");
    } else {
      assert.ok(REAL, "a fresh local chain cannot have the contracts already");
      step("contracts already deployed");
    }
    await shot("1-setup");
    await press("Set up the sandbox");
    await main.getByRole("heading", { name: "Pools" }).waitFor({ timeout: WAIT * 6 });
    await idle();
    await page.getByRole("button", { name: new RegExp(`Wallet ${wallet.address.slice(0, 6)}`, "i") }).waitFor({ timeout: WAIT });
    // The board must show the two sample pools as soon as the setup is over, without waiting for a refresh.
    assert.equal(await main.locator('a[href^="#/pool/"]').count(), 2);
    await collect();
    await shot("2-board");
    step("sandbox ready: your own space, Points and demo USDC for the wallet, two sample pools open");

    // The sample company request: refused while partial, filled, launched, paid by Points.
    await poolLink(/e-invoicing engine/).click();
    await seen("Open for pledges");
    await act("Launch the build");
    assert.match(await lastEvent(), /Refused on-chain, TargetNotReached/);
    await act(/^Pledge 10,000 USDC/);
    assert.match(await lastEvent(), /You[\s\S]*Pledged 10,000 demo USDC/);
    await act("Company B pledges");
    await act("Company C pledges");
    await seen("Full: ready to launch");
    await act("Launch the build");
    await seen("If paid now");
    await shot("3-building");
    await act("Pay contributors by Points");
    await seen("Paid by Points");
    const paid = await main.locator("table").innerText();
    assert.match(paid, /You/);
    assert.match(paid, /49,000/);
    await shot("4-paid");
    step("company request: launch refused on-chain while partial, filled by three funders, paid by Points with the wallet among the payees");

    // The sample contributor proposal: the wallet votes with its Points, contributors list it.
    await home();
    await poolLink(/feature-flag service/).click();
    await seen("Listing vote open");
    await act("For", { exact: true });
    assert.match(await lastEvent(), /You[\s\S]*Voted for/);
    await act("Close the vote");
    assert.match(await lastEvent(), /Refused on-chain, VoteStillOpen/);
    await act("They vote For");
    await act("Close the vote");
    await seen("Open for pledges");
    await shot("5-listed");
    step("contributor proposal: the wallet votes with its Points, closing early is refused on-chain, contributors list it");

    // The wallet proposes a build as a contributor, with a one-minute window: it misses and refunds.
    await collect();
    await page.goto(`${base}/#/new/proposal`);
    await seen("Open a pool");
    await main.getByLabel("Funding window").selectOption("1m");
    await act("Propose the build");
    await seen("Listing vote open");
    assert.match(await main.locator("h1").innerText(), /status page/i);
    await act("They vote For");
    await act("Close the vote");
    await seen("Open for pledges");
    await act(/^Pledge 10,000 USDC/);
    await shot("6-proposed");
    if (!REAL) {
      await rpc("evm_increaseTime", [90]);
      await rpc("evm_mine");
    }
    await seen("Missed its target", REAL ? 120_000 : WAIT);
    await act("Refund every pledge");
    await seen("Every pledge has been refunded.");
    assert.match(await lastEvent(), /Refunded 10,000 demo USDC to you/);
    await shot("7-refunded");
    step("wallet proposes a build with no money down: listed, misses its target at the deadline, refunded in full");

    // The wallet requests a build as a company; the build is closed by vote before payout.
    await collect();
    await page.goto(`${base}/#/new/request`);
    await seen("Open a pool");
    await act("Open the request");
    await seen("Listing vote open");
    assert.match(await main.locator("h1").innerText(), /PDF signing/i);
    await act("They vote For");
    await act("Close the vote");
    await act("Company B pledges");
    await act("Company C pledges");
    await seen("Full: ready to launch");
    await act("Launch the build");
    await seen("If paid now");
    await act("Company B asks for a closure vote");
    await seen("Closure vote open");
    await act("Pay contributors by Points");
    assert.match(await lastEvent(), /Refused on-chain, ClosureVoteOpen/);
    await act("They vote For");
    await act("Close the vote");
    await seen("Closed by vote");
    await act("Refund every pledge");
    await seen("Every pledge has been refunded.");
    await shot("8-closed");
    step("wallet requests a build with a first pledge: listed, filled, launched, closed by vote, three funders refunded");

    // The wallet was only ever asked for accounts, the chain id and transactions.
    const methods = [...new Set(walletCalls)].sort();
    assert.deepStrictEqual(methods, ["eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
    await home();
    assert.equal(await main.locator('a[href^="#/pool/"]').count(), 4);
    await collect();
    assert.ok(links.size >= 40, `expected the activity log to link its transactions, found ${links.size} links`);
    // A reload resumes the sandbox from sessionStorage once the wallet is connected again.
    await page.reload({ waitUntil: REAL ? "load" : "networkidle" });
    await page.getByRole("button", { name: /Connect Phantom/ }).click();
    await main.locator('a[href^="#/pool/"]').nth(3).waitFor({ timeout: WAIT });
    await poolLink(/e-invoicing engine/).click();
    await seen("Paid by Points");
    assert.match(await main.locator("table").innerText(), /49,000/);
    // The public endpoint answers 429 when it is busy and the page retries; those are counted, not failures.
    const busy = REAL ? errors.filter((e) => /status of 429/.test(e)).length : 0;
    const real = errors.filter((e) => !/hmr|WebSocket/.test(e) && !(REAL && /status of 429/.test(e)));
    console.log(`LIVE E2E PASS${REAL ? ` on the real network; requests answered 429 and retried: ${busy}` : ""}; ${links.size} transactions linked in the activity log; wallet methods: ${methods.join(", ")}; console errors: ${JSON.stringify(real)}`);
    if (real.length) process.exitCode = 1;
  } catch (e) {
    console.error("LIVE E2E FAIL", e);
    if (browser && process.env.E2E_SHOTS) {
      try { await browser.contexts()[0].pages()[0].screenshot({ path: `${process.env.E2E_SHOTS}/live-fail.png` }); } catch {}
    }
    process.exitCode = 1;
  } finally {
    await browser?.close();
    anvil?.kill("SIGTERM");
  }
})();
