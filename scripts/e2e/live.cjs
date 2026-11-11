// Drives the live panel in a real browser, with no testnet involved: requests to the Base Sepolia RPC
// are routed to a local anvil chain with the same chain id, and a stand-in wallet (announced as
// "Phantom" through EIP-6963) forwards the page's requests to one of anvil's unlocked accounts.
// It deploys both contracts from the page, then plays three pools: paid out, refunded after a missed
// target, and closed by vote.
//
//   bun run dev            (in another terminal)
//   bun run e2e:live       (BASE_URL defaults to http://localhost:3000)
//
// Needs Playwright with a Chromium build (`bun add -d playwright && bunx playwright install chromium`).
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const assert = require("node:assert");

const REPO = require("node:path").join(__dirname, "../..");
const PORT = 8599;
const RPC = `http://127.0.0.1:${PORT}`;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const CREATE2_CODE = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

(async () => {
  const base = process.env.BASE_URL || "http://localhost:3000";
  const anvil = spawn(`${REPO}/node_modules/.bin/anvil`, ["--port", String(PORT), "--chain-id", "84532", "--silent"], { stdio: "ignore" });
  let browser;
  try {
    for (let i = 0; ; i++) {
      try { await rpc("eth_chainId"); break; } catch (e) { if (i > 100) throw e; await new Promise((r) => setTimeout(r, 50)); }
    }
    await rpc("anvil_setCode", [CREATE2_DEPLOYER, CREATE2_CODE]);
    const [visitor] = await rpc("eth_accounts");

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    const walletCalls = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

    // The page only ever talks to the constant Base Sepolia RPC URL: every such request lands on anvil.
    await context.route("https://sepolia.base.org/**", async (route) => {
      const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() });
      await route.fulfill({ status: 200, contentType: "application/json", body: await response.text() });
    });
    await page.exposeFunction("__walletRpc", async (method, params) => {
      walletCalls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [visitor];
      if (method === "eth_chainId") return "0x14a34";
      if (method === "eth_sendTransaction") return rpc("eth_sendTransaction", params);
      throw Object.assign(new Error(`The stand-in wallet does not support ${method}`), { code: 4200 });
    });
    await page.addInitScript(() => {
      const provider = { request: ({ method, params }) => window.__walletRpc(method, params ?? []), on() {}, removeListener() {} };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "e2e", name: "Phantom", rdns: "app.phantom", icon: "" }, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });

    await page.goto(base + "/", { waitUntil: "networkidle" });
    // Everything below happens inside the live panel; the simulation above has buttons with the same names.
    const live = page.locator("section").filter({ has: page.getByRole("heading", { name: "Run it for real on Base Sepolia" }) }).last();
    const press = async (name, opts = {}) => {
      const loc = live.getByRole("button", { name, ...opts }).first();
      await loc.waitFor({ timeout: 30000 });
      await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await loc.click();
    };
    const seen = (text, timeout = 30000) => live.getByText(text).first().waitFor({ timeout });
    const idle = () => live.getByRole("status").waitFor({ state: "detached", timeout: 60000 });
    const shots = process.env.E2E_SHOTS;
    const shot = async (name) => { if (!shots) return; await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/live-${name}.png` }); };
    const logTop = () => page.locator("aside ol li").first().innerText();
    const warp = async (seconds) => { await rpc("evm_increaseTime", [seconds]); await rpc("evm_mine"); };

    await press("Start the live testnet demo");
    await press("Connect Phantom");
    await seen("Not deployed");
    await shot("1-connect");

    await press("Deploy the contracts");
    await idle();
    await seen("Set up your sandbox");
    assert.match(await logTop(), /Deployed PooledFunding at 0x/);
    await shot("2-deployed");

    await press("Set up the sandbox");
    await idle();
    await seen("Open a pool, from either side");
    assert.match(await logTop(), /Minted 100,000 demo USDC/);
    await shot("3-sandbox");

    // A request, opened by the visitor's wallet with a first pledge.
    await press("Open a request with a first pledge");
    await idle();
    await seen("Contributors vote (Proof of Love)");
    assert.match(await logTop(), /Opened a request for 50,000 demo USDC with a first pledge of 10,000/);
    await press("Try to close the vote now");
    await idle();
    assert.match(await logTop(), /Refused on-chain, VoteStillOpen/);
    await press("For", { exact: true });
    await idle();
    await live.getByRole("button", { name: "For", exact: true }).nth(1).click();
    await idle();
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
    assert.match(await logTop(), /Pledged 20,000 demo USDC to pool #1/);
    await shot("5-funding");
    await seen("The pool is full");
    await press("Launch the build");
    await idle();
    assert.match(await logTop(), /Launched pool #1: it held its full 50,000 demo USDC/);
    await press("Pay contributors by Points");
    await idle();
    await seen("Paid out by share of project Points");
    await seen("Contributor A: 160 Points (47.1%) → 23,058.82 demo USDC");
    await seen("Fee wallet: 1,000 demo USDC (2%)");
    await shot("6-paid");

    // The other direction: a community proposal that is listed, then misses its target and refunds.
    await press("Open another pool");
    await press("Propose a build as contributor A");
    await idle();
    await press("For", { exact: true });
    await idle();
    await live.getByRole("button", { name: "For", exact: true }).nth(2).click();
    await idle();
    await press("Close the vote", { exact: true });
    await idle();
    await press("Pledge as you");
    await idle();
    await press("Company B pledges");
    await idle();
    await warp(200);
    await seen("Missed its target: every pledge is refundable", 30000);
    await shot("7-missed");
    await press("Refund everyone");
    await idle();
    await seen("Everyone has been refunded in full.");
    assert.match(await logTop(), /Refunded 20,000 demo USDC to Company B from pool #2, in full/);

    // A launched pool closed by vote before payout.
    await press("Open another pool");
    await press("Propose a build as contributor A");
    await idle();
    await press("For", { exact: true });
    await idle();
    await live.getByRole("button", { name: "For", exact: true }).nth(1).click();
    await idle();
    await press("Close the vote", { exact: true });
    await idle();
    for (const who of ["Pledge as you", "Company B pledges", "Company C pledges"]) { await press(who); await idle(); }
    // Only what was still missing is taken from the last pledge.
    assert.match(await logTop(), /Company C[\s\S]*Pledged 10,000 demo USDC to pool #3/);
    await press("Launch the build");
    await idle();
    await press("Company B asks for a closure vote");
    await idle();
    await seen("Closure vote.");
    await press("For", { exact: true });
    await idle();
    await live.getByRole("button", { name: "For", exact: true }).nth(1).click();
    await idle();
    await press("Close the vote", { exact: true });
    await idle();
    await seen("Closed by vote: every pledge is refundable");
    await press("Refund everyone");
    await idle();
    await seen("Everyone has been refunded in full.");
    await shot("8-closed");

    // The wallet was only ever asked for accounts, the chain id and transactions.
    const methods = [...new Set(walletCalls)].sort();
    assert.deepStrictEqual(methods, ["eth_chainId", "eth_requestAccounts", "eth_sendTransaction"]);
    // A reload resumes the sandbox from sessionStorage.
    await page.reload({ waitUntil: "networkidle" });
    await press("Connect Phantom");
    await seen("Resumed the sandbox saved in this browser tab.");
    const real = errors.filter((e) => !/hmr|WebSocket/.test(e));
    console.log("LIVE E2E PASS; wallet methods:", methods.join(", "), "; console errors:", JSON.stringify(real));
    if (real.length) process.exitCode = 1;
  } catch (e) {
    console.error("LIVE E2E FAIL", e);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    anvil.kill("SIGTERM");
  }
})();
