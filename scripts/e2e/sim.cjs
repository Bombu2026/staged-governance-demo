// Clicks through the whole simulation in a real browser: all-or-nothing launch, payout by Points, a
// listing vote, a missed target with refunds, and a new pool from the form.
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
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const log = () => page.locator("aside ol li").first().innerText();
  const press = async (loc) => { await loc.evaluate((el) => el.scrollIntoView({ block: "center" })); await loc.click({ force: true }); };
  const shots = process.env.E2E_SHOTS;
  const shot = (name) => (shots ? page.screenshot({ path: `${shots}/sim-${name}.png` }) : null);

  // 1. All or nothing: launching a partial pool is refused.
  await press(page.getByRole("button", { name: "Launch the build" }));
  assert.match(await log(), /TargetNotReached/);
  assert.match(await log(), /10,000 of 50,000/);

  // 2. Three other companies fill the pool.
  await press(page.getByRole("button", { name: "company-b pledges 10,000 USDC" }));
  await press(page.getByRole("button", { name: "company-b pledges 10,000 USDC" }));
  await press(page.getByRole("button", { name: "Refund company-b" }));
  assert.match(await log(), /RefundNotAvailable/);
  await press(page.getByRole("button", { name: "company-c pledges 10,000 USDC" }));
  await press(page.getByRole("button", { name: "company-d pledges 10,000 USDC" }));
  assert.match(await log(), /50,000 of 50,000.*full/s);
  await page.getByRole("button", { name: "Launch the build" }).scrollIntoViewIfNeeded();
  await shot("full");
  await press(page.getByRole("button", { name: "Launch the build" }));
  assert.match(await log(), /Launched pool #1/);

  // 3. Build and payout.
  await press(page.getByRole("button", { name: "Pay out by Points" }));
  assert.match(await log(), /NoAcceptedWork/);
  await press(page.getByRole("button", { name: "Accept sample work" }));
  await press(page.getByRole("button", { name: "Accept sample work" }));
  await page.getByRole("button", { name: "Pay out by Points" }).scrollIntoViewIfNeeded();
  await shot("building");
  await press(page.getByRole("button", { name: "Pay out by Points" }));
  assert.match(await log(), /Paid pool #1: 49,000 USDC to \d contributors.*1,000 USDC fee/);
  await page.getByText("Paid out: 49,000 USDC").scrollIntoViewIfNeeded();
  await shot("paid");

  // 4. The community proposal: vote, list, then let it miss its target.
  await press(page.getByRole("button", { name: /#2/ }));
  await press(page.getByRole("button", { name: "Close the vote" }));
  assert.match(await log(), /VoteStillOpen/);
  for (const who of ["contributor-b", "contributor-d", "contributor-a", "contributor-e"]) {
    await press(page.getByRole("group", { name: `Vote of ${who}` }).getByRole("button", { name: "For" }));
  }
  await page.getByRole("button", { name: "Close the vote" }).scrollIntoViewIfNeeded();
  await shot("vote");
  await press(page.getByRole("button", { name: "Close the vote" }));
  assert.match(await log(), /Listed: pledges are open until day 30/);
  await press(page.getByRole("button", { name: "company-b pledges 10,000 USDC" }));
  for (let i = 0; i < 5; i++) await press(page.getByRole("button", { name: "+7 days" }));
  assert.match(await log(), /Pool #2 missed its target/);
  await page.getByText("Missed its target: every pledge is refundable").scrollIntoViewIfNeeded();
  await shot("missed");
  await press(page.getByRole("button", { name: "Refund company-b", exact: true }).first());
  assert.match(await log(), /Refunded 10,000 USDC to company-b from pool #2, because it missed its target/);
  assert.ok(await page.getByText("Everyone has been refunded.").isVisible());

  // 5. A new pool from the form.
  await press(page.getByRole("button", { name: "Open a new pool" }));
  await press(page.getByRole("button", { name: "Open the request" }));
  assert.ok(await page.getByText("Give the build a title.", { exact: true }).isVisible());
  await page.getByLabel("What should be built").fill("Self-hosted status page");
  await page.getByRole("button", { name: "Open the request" }).scrollIntoViewIfNeeded();
  await shot("form");
  await press(page.getByRole("button", { name: "Open the request" }));
  assert.match(await log(), /Opened request #3 "Self-hosted status page" for 20,000 USDC with a first pledge of 5,000/);
  assert.ok(await page.getByRole("heading", { name: "Self-hosted status page" }).isVisible());

  // 6. Reset.
  await press(page.getByRole("button", { name: "Reset demo" }));
  assert.match(await log(), /Reset to the sample pools/);
  console.log("SIM E2E PASS; console errors:", JSON.stringify(errors));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error("SIM E2E FAIL", e); process.exit(1); });
