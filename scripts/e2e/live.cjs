// Drives the live panel in a real browser, end to end, and plays three pools: paid out by Points,
// refunded after a missed target, and closed by vote. A stand-in wallet, announced as "Phantom" through
// EIP-6963, answers the page's wallet requests.
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
    // Everything below happens inside the live panel; the simulation above has buttons with the same names.
    const live = page.locator("section").filter({ has: page.getByRole("heading", { name: "Run it for real on Base Sepolia" }) }).last();
    const press = async (name, opts = {}) => {
      const loc = live.getByRole("button", { name, ...opts }).first();
      await loc.waitFor({ timeout: WAIT });
      await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await loc.click();
    };
    const seen = (text, timeout = WAIT) => live.getByText(text).first().waitFor({ timeout });
    const idle = () => live.getByRole("status").waitFor({ state: "detached", timeout: WAIT * 2 });
    const shots = process.env.E2E_SHOTS;
    const shot = async (name) => { if (!shots) return; await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/live-${name}.png` }); };
    const logTop = () => page.locator("aside ol li").first().innerText();
    const voteFor = async (nth) => { await live.getByRole("button", { name: "For", exact: true }).nth(nth).click(); await idle(); };
    const step = (text) => console.log(`  ${text}`);

    await press("Start the live testnet demo");
    await press("Connect Phantom");
    await seen("The two contracts");
    await shot("1-connect");
    const deployButton = live.getByRole("button", { name: "Deploy the contracts" });
    await Promise.race([deployButton.waitFor({ timeout: WAIT }), live.getByText("Set up your sandbox").first().waitFor({ timeout: WAIT })]);
    if (await deployButton.isVisible()) {
      await press("Deploy the contracts");
      await idle();
      assert.match(await logTop(), /Deployed PooledFunding at 0x/);
      step("deployed both contracts from the page");
    } else {
      assert.ok(REAL, "a fresh local chain cannot have the contracts already");
      step("contracts already deployed");
    }
    await seen("Set up your sandbox");
    await shot("2-deployed");

    await press("Set up the sandbox");
    await idle();
    await seen("Open a pool, from either side");
    assert.match(await logTop(), /Minted 100,000 demo USDC/);
    step("sandbox ready: gas forwarded, space created, Points recorded, demo USDC minted");
    await shot("3-sandbox");

    // A request, opened by the visitor's wallet with a first pledge, on the default 5 minute window.
    await press("Open a request with a first pledge");
    await idle();
    await seen("Contributors vote (Proof of Love)");
    assert.match(await logTop(), /Opened a request for 50,000 demo USDC with a first pledge of 10,000/);
    await press("Try to close the vote now");
    await idle();
    assert.match(await logTop(), /Refused on-chain, VoteStillOpen/);
    await voteFor(0);
    await voteFor(1);
    await shot("4-vote");
    await press("Close the vote", { exact: true });
    await idle();
    await seen("The listing vote passed. The pool was listed.");

    await press("Try to launch now");
    await idle();
    assert.match(await logTop(), /Refused on-chain, TargetNotReached: All or nothing: 10,000 of 50,000/);
    await press("Try to refund now");
    await idle();
    assert.match(await logTop(), /Refused on-chain, RefundNotAvailable/);
    await press("Company B pledges");
    await idle();
    await press("Pledge as you");
    await idle();
    assert.match(await logTop(), /Pledged 20,000 demo USDC to pool #\d+/);
    await shot("5-funding");
    await seen("The pool is full");
    await press("Launch the build");
    await idle();
    assert.match(await logTop(), /Launched pool #\d+: it held its full 50,000 demo USDC/);
    await press("Pay contributors by Points");
    await idle();
    await seen("Paid out by share of project Points");
    await seen("Contributor A: 160 Points (47.1%) → 23,058.82 demo USDC");
    await seen("Fee wallet: 1,000 demo USDC (2%)");
    step("pool 1: request listed, filled by three funders, launched and paid by Points");
    await shot("6-paid");

    // The other direction: a community proposal on the 1 minute window, listed, then left to miss its target.
    await press("Open another pool");
    await press("1 min", { exact: true });
    await press("Propose a build as contributor A");
    await idle();
    await voteFor(0);
    await voteFor(2);
    await press("Close the vote", { exact: true });
    await idle();
    await press("Pledge as you");
    await idle();
    await press("Company B pledges");
    await idle();
    if (!REAL) {
      await rpc("evm_increaseTime", [200]);
      await rpc("evm_mine");
    }
    await seen("Missed its target: every pledge is refundable", REAL ? 150_000 : WAIT);
    await shot("7-missed");
    await press("Refund everyone");
    await idle();
    await seen("Everyone has been refunded in full.");
    assert.match(await logTop(), /Refunded 20,000 demo USDC to Company B from pool #\d+, in full/);
    step("pool 2: proposal listed, missed its target at the deadline, both funders refunded in full");

    // A launched pool closed by vote before payout.
    await press("Open another pool");
    await press("5 min", { exact: true });
    await press("Propose a build as contributor A");
    await idle();
    await voteFor(0);
    await voteFor(1);
    await press("Close the vote", { exact: true });
    await idle();
    for (const who of ["Pledge as you", "Company B pledges", "Company C pledges"]) { await press(who); await idle(); }
    // Only what was still missing is taken from the last pledge.
    assert.match(await logTop(), /Company C[\s\S]*Pledged 10,000 demo USDC to pool #\d+/);
    await press("Launch the build");
    await idle();
    await press("Company B asks for a closure vote");
    await idle();
    await seen("Closure vote.");
    await voteFor(0);
    await voteFor(1);
    await press("Close the vote", { exact: true });
    await idle();
    await seen("Closed by vote: every pledge is refundable");
    await press("Refund everyone");
    await idle();
    await seen("Everyone has been refunded in full.");
    step("pool 3: launched, closed by vote before payout, three funders refunded in full");
    await shot("8-closed");

    // The wallet was only ever asked for accounts, the chain id and transactions.
    const methods = [...new Set(walletCalls)].sort();
    assert.deepStrictEqual(methods, ["eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
    // A reload resumes the sandbox from sessionStorage.
    await page.reload({ waitUntil: REAL ? "load" : "networkidle" });
    await press("Connect Phantom");
    await seen("Resumed the sandbox saved in this browser tab.");
    const real = errors.filter((e) => !/hmr|WebSocket/.test(e));
    const links = await page.locator("aside ol li a").count();
    console.log(`LIVE E2E PASS${REAL ? ` on the real network (${links} transactions linked in the event log)` : ""}; wallet methods: ${methods.join(", ")}; console errors: ${JSON.stringify(real)}`);
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
