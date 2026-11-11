// Clicks through the pools page on its sample data, in a real browser: both directions, the
// all-or-nothing launch, payout by Points, a listing vote, a missed target with refunds, a closure
// vote, and one new pool from each side.
//
//   bun run dev            (in another terminal)
//   bun run e2e:sim        (BASE_URL defaults to http://localhost:3000)
//
// Needs Playwright with a Chromium build (`bun add -d playwright && bunx playwright install chromium`).
// Use localhost, not 127.0.0.1: the Next.js dev server only serves its scripts to its own origin.
const { chromium } = require("playwright");
const assert = require("node:assert");
(async () => {
  const base = process.env.BASE_URL || "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/hmr|WebSocket/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  const shots = process.env.E2E_SHOTS;
  const shot = async (name) => { if (shots) { await page.waitForTimeout(250); await page.screenshot({ path: `${shots}/sim-${name}.png` }); } };
  const step = (text) => console.log(`  ${text}`);

  const main = page.locator("main");
  const press = async (name, opts = {}) => {
    const loc = main.getByRole("button", { name, ...opts }).first();
    await loc.waitFor({ timeout: 10_000 });
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    // Blocked buttons are marked aria-disabled and still take the click, which records the refusal.
    await loc.click({ force: true });
  };
  const seen = (text) => main.getByText(text).first().waitFor({ timeout: 10_000 });
  const lastEvent = () => main.locator("[data-activity] li").first().innerText();
  const open = async (id) => { await page.goto(`${base}/#/pool/${id}`); await main.getByText(`Pool #${id}`, { exact: true }).waitFor({ timeout: 10_000 }); };
  const actAs = async (who) => {
    await page.getByRole("button", { name: /Acting as/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${who}`) }).click();
    await page.getByRole("button", { name: new RegExp(`Acting as ${who}`) }).waitFor();
  };

  await page.goto(base + "/", { waitUntil: "networkidle" });

  // The board: five sample pools, one at each stage, in both directions.
  assert.equal(await main.locator('a[href^="#/pool/"]').count(), 5);
  await press(/^Company requests/);
  assert.equal(await main.locator('a[href^="#/pool/"]').count(), 3);
  await press(/^Contributor proposals/);
  assert.equal(await main.locator('a[href^="#/pool/"]').count(), 2);
  await press(/^All/);
  await shot("1-board");
  step("board: five sample pools, three company requests and two contributor proposals");

  // All or nothing: a partial pool cannot launch. Then it fills, launches and is paid by Points.
  await main.getByRole("link", { name: /e-invoicing engine/ }).click();
  await seen("Open for pledges");
  await press("Launch the build");
  assert.match(await lastEvent(), /TargetNotReached/);
  await press(/^Pledge 10,000 USDC/);
  assert.match(await lastEvent(), /company-a.*pledged 10,000/is);
  await press("They fill the pool");
  await seen("Full: ready to launch");
  await shot("2-full");
  await press("Launch the build");
  await seen("Building");
  await press("Pay contributors by Points");
  assert.match(await lastEvent(), /NoAcceptedWork/);
  await press("Accept a batch of work");
  await seen("If paid now");
  await press("Pay contributors by Points");
  await seen("Paid by Points");
  assert.match(await main.locator("table").innerText(), /49,000/);
  await shot("3-paid");
  step("company request: refused while partial, filled by four companies, launched, paid 49,000 by Points after the 2% fee");

  // A contributor proposal: only contributors vote, then companies fund it.
  await open(4);
  await seen("Listing vote open");
  await press("For", { exact: true });
  assert.match(await main.getByText(/company-a is a company/).first().innerText(), /Only contributors with Points vote/);
  await actAs("contributor-a");
  await press("For", { exact: true });
  assert.match(await lastEvent(), /contributor-a.*Voted For/is);
  await press("Close the vote");
  assert.match(await lastEvent(), /VoteStillOpen/);
  await press("They vote For");
  await press("Close the vote");
  await seen("Open for pledges");
  await shot("4-listed");
  step("contributor proposal: a company's vote is refused, contributors list it");

  // It misses its target: the only pledge goes back in full.
  await actAs("company-a");
  await press(/^Pledge 10,000 USDC/);
  assert.match(await lastEvent(), /company-a.*pledged 10,000/is);
  for (let i = 0; i < 5; i++) await press("+7 days");
  await seen("Missed its target");
  await press("Refund every pledge");
  assert.match(await lastEvent(), /refunded.*10,000/is);
  await seen("Every pledge has been refunded.");
  await shot("5-refunded");
  step("missed target: 10,000 of 30,000 at the deadline, refunded in full");

  // One new pool from each side.
  await actAs("contributor-d");
  await page.goto(`${base}/#/new/proposal`);
  await seen("Open a pool");
  await press("Propose the build");
  await seen("Pool #6");
  await seen("Listing vote open");
  await actAs("company-d");
  await page.goto(`${base}/#/new/request`);
  await press("Open the request");
  assert.match(await main.getByText(/company-d holds/).first().innerText(), /less than this first pledge/);
  await main.getByLabel("Your first pledge in USDC").fill("2000");
  await press("Open the request");
  await seen("Pool #7");
  assert.match(await main.locator("h1").innerText(), /PDF signing/i);
  await shot("6-opened");
  step("new pools: a contributor proposes with no money down, a company requests with a first pledge");

  // A stalled build is closed by vote and refunded.
  await open(5);
  await seen("Building");
  await actAs("company-c");
  await press("Ask for a closure vote");
  await seen("Closure vote open");
  await press("Pay contributors by Points");
  assert.match(await lastEvent(), /ClosureVoteOpen/);
  await press("They vote For");
  await press("Close the vote");
  await seen("Closed by vote");
  await press("Refund every pledge");
  await seen("Every pledge has been refunded.");
  await shot("7-closed");
  step("closure vote: asked by a funder, passed by contributors, 24,000 refunded to three companies");

  // Reset goes back to the five sample pools.
  await page.getByRole("button", { name: /Acting as/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset the sample data" }).click();
  await page.goto(base + "/#/");
  await main.locator('a[href^="#/pool/"]').nth(4).waitFor();
  assert.equal(await main.locator('a[href^="#/pool/"]').count(), 5);

  console.log(`SIM E2E PASS; console errors: ${JSON.stringify(errors)}`);
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("SIM E2E FAIL:", e.message);
  process.exit(1);
});
