// Run against a fresh test data directory; this scenario creates its own parties and entries.
// An all-zero slip's D.N. ("INW NO 547") is linked to the earlier month's entry: the LINKED ENTRY column, the side window, the
// link back from the earlier entry, the Check link filter and the check while a new entry is typed.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "LINKED UI PARTY";
const OTHER = "LINKED UI OTHER";

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function seed() {
  await call("/api/masters/group", "POST", { name: "LINKED UI GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: "LINKED UI FINISH", active: true, group: "LINKED UI GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "LINKED UI STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo", lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  for (const name of [PARTY, OTHER]) {
    await call("/api/masters/party", "POST", { name, active: true, discount: 0, billingStyle: "LINKED UI STYLE", color: "black" });
  }
  const entry = (registerMonth, inwardNo, party, than, designNo = "") => call("/api/entries", "POST", {
    registerMonth, inwardNo, entryDate: `${registerMonth}-24`, party, designNo, than, finish: than ? "LINKED UI FINISH" : "",
    dispatches: than ? [{ qty: Math.min(20, than), gatePass: "GP77", date: `${registerMonth}-25` }] : [],
  });
  await entry("2026-06", 547, PARTY, 48, "D-2210");
  await entry("2026-06", 553, OTHER, 30, "D-2217");
  await entry("2026-07", 3, PARTY, 0, "INW NO 547");
  await entry("2026-07", 20, PARTY, 0, "INW NO,553");
  await entry("2026-07", 21, PARTY, 0, "INW NO,999");
  await entry("2026-07", 22, PARTY, 5, "D-1");
}

// The Month list closes after each pick: open it again for the next one.
async function toggleMonth(page, label) {
  await page.locator("#registerViewMonth").click();
  await page.locator('li[role="option"]', { hasText: label }).first().click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#registerViewMonth + .combo-list:popover-open"));
}

(async () => {
  await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    await page.locator('[data-view="register"]').click();
    await page.locator(".colset button", { hasText: "Main" }).first().click();
    await toggleMonth(page, "Jul 2026");
    // The month's rows are read and drawn after the list closes.
    await page.locator("#registerTable thead th").first().waitFor();

    // The column is in Main (and All), right after BILL NO.; the D.N. stays plain text.
    const headers = await page.locator("#registerTable thead th").evaluateAll((cells) => cells.filter((c) => c.offsetParent).map((c) => c.textContent.trim()));
    assert.equal(headers[headers.indexOf("BILL NO.") + 1], "LINKED ENTRY", headers.join() || `no visible register headers, page: ${page.url()}, view: ${await page.evaluate(() => document.querySelector(".tab[aria-selected=true]")?.textContent)}`);
    const row = (inw) => page.locator("#registerTable tbody tr[data-entry-id]", { has: page.locator(`td:first-child:text-is("${inw}")`) });
    const linkCell = (inw) => row(inw).locator("td.link-cell");
    assert.equal(await row(3).locator("td:nth-child(4)").textContent(), "INW NO 547", "the D.N. is not changed");
    assert.equal(await row(3).locator("td:nth-child(4) a").count(), 0, "no link in the D.N.");
    assert.equal(await linkCell(3).textContent(), "← Jun · INW 547");
    assert.equal(await linkCell(20).textContent(), "⚠ ← Jun · INW 553");
    assert.equal(await linkCell(21).textContent(), "⚠ INW 999 not found");
    assert.equal(await linkCell(22).textContent(), "", "an entry with THAN is not linked");

    // Click: the earlier entry in a side window, read only.
    const drawer = page.locator("#linkedDrawer");
    const field = (title) => drawer.locator(".field", { has: page.locator(`.label:text-is("${title}")`) }).locator("output");
    const closeDrawer = async () => {
      await drawer.locator(".drawer-foot").getByRole("button", { name: "Close" }).click();
      await page.waitForFunction(() => !document.getElementById("linkedDrawer").open);
    };
    await linkCell(3).locator("a").click();
    await page.waitForFunction(() => document.getElementById("linkedDrawer").open);
    assert.match(await drawer.locator(".drawer-head h2").textContent(), /^Linked entry/);
    assert.match(await drawer.locator(".drawer-head .sub").textContent(), /INW\. NO\. 547 — Jun 2026 register/);
    assert.match(await drawer.locator(".link-note").textContent(), /Pointed to by INW\. NO\. 3 of the Jul 2026 register.*“INW NO 547”/);
    assert.equal(await field("PARTY").textContent(), PARTY);
    assert.equal(await field("THAN").textContent(), "48");
    assert.equal(await field("D.N.").textContent(), "D-2210");
    assert.match(await drawer.locator("p.muted").textContent(), /20 NAG on gate pass GP77/);
    await closeDrawer();

    // Another party: the window sets the two side by side and offers to correct the D.N.
    await linkCell(20).locator("a").click();
    await page.waitForFunction(() => document.getElementById("linkedDrawer").open);
    assert.match(await drawer.locator(".drawer-head h2").textContent(), /^Check this link/);
    assert.equal(await field("INW. NO. 20 (JUL 2026)").textContent(), PARTY);
    assert.equal(await field("INW. NO. 553 (JUN 2026)").textContent(), OTHER);
    await drawer.getByRole("button", { name: "Correct the D.N. of INW. NO. 20" }).click();
    await page.waitForFunction(() => document.getElementById("view-entry").classList.contains("active"));
    assert.equal(await page.locator("#inwardNo").inputValue(), "20", "opened for correction");
    assert.equal(await page.locator("#designNo").inputValue(), "INW NO,553");
    await page.locator("#linkPreview .link-line.warn").waitFor();
    assert.match(await page.locator("#linkPreview").textContent(), /INW\. NO\. 553 · Jun 2026 register · LINKED UI OTHER.*another party/);
    await page.locator("#cancelEdit").click();
    await page.waitForFunction(() => document.getElementById("view-register").classList.contains("active"));

    // Not found: an explanation.
    await linkCell(21).locator("a").click();
    await page.waitForFunction(() => document.getElementById("linkedDrawer").open);
    assert.match(await drawer.locator(".drawer-head h2").textContent(), /^No linked entry found/);
    assert.match(await drawer.locator(".link-note").textContent(), /No slip numbered 999 in the registers before Jul 2026/);
    await closeDrawer();

    // The same link opens the entry for correction and comes back to the register.
    await linkCell(3).locator("a").click();
    await page.waitForFunction(() => document.getElementById("linkedDrawer").open);
    await drawer.getByRole("button", { name: "Open this entry" }).click();
    await page.waitForFunction(() => document.getElementById("view-entry").classList.contains("active"));
    assert.equal(await page.locator("#inwardNo").inputValue(), "547");
    await page.locator("#cancelEdit").click();
    await page.waitForFunction(() => document.getElementById("view-register").classList.contains("active"));

    // The other direction: the June entries show the zero slips that name them.
    await toggleMonth(page, "Jul 2026");
    await toggleMonth(page, "Jun 2026");
    await page.waitForFunction(() => document.querySelectorAll("#registerTable tbody tr[data-entry-id]").length === 2);
    assert.equal(await linkCell(547).textContent(), "→ Jul · INW 3");
    assert.equal(await linkCell(553).textContent(), "⚠ → Jul · INW 20");
    await linkCell(547).locator("a").click();
    await page.waitForFunction(() => document.getElementById("linkedDrawer").open);
    assert.match(await drawer.locator(".drawer-head .sub").textContent(), /INW\. NO\. 3 — Jul 2026 register/);
    assert.match(await drawer.locator(".link-note").textContent(), /named by the all-zero slip INW\. NO\. 3 of the Jul 2026 register.*“INW NO 547”/);
    await closeDrawer();

    // Check link: only the slips whose link needs a look (both directions), over every month.
    await toggleMonth(page, "All months");
    await page.locator("#registerFiltersToggle").click();
    const check = page.locator('#registerFilters [data-filter="linkCheck"]');
    assert.equal(await check.locator(".chip-count").textContent(), "3");
    await check.click();
    await page.waitForFunction(() => [...document.querySelectorAll("#registerTable tbody tr[data-entry-id] td:first-child")].map((td) => td.textContent.trim()).sort().join() === "20,21,553");
    await check.click();

    // New entry: the check while the D.N. is typed.
    await page.locator('[data-view="entry"]').click();
    const preview = page.locator("#linkPreview");
    await page.locator("#party").fill(PARTY);
    await page.locator("#party").press("Enter");
    await page.fill("#entryDate", "2026-07-24");
    await page.dispatchEvent("#entryDate", "change");
    await page.locator("#designNo").fill("INW NO 547");
    await page.locator("#than").fill("0");
    await page.locator("#linkPreview .link-line.ok").waitFor();
    assert.match(await preview.textContent(), /^✓ INW\. NO\. 547 · Jun 2026 register · LINKED UI PARTY · 24\/Jun\/26 · 48 THAN$/);
    await page.locator("#designNo").fill("INW NO 999");
    await page.locator("#linkPreview .link-line.warn").waitFor();
    assert.match(await preview.textContent(), /^⚠ INW\. NO\. 999 not found in the registers before/);
    await page.locator("#than").fill("5");
    await page.waitForFunction(() => document.getElementById("linkPreviewField").classList.contains("hidden"));

    assert.deepEqual(errors, []);
    console.log("Linked entry UI checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
