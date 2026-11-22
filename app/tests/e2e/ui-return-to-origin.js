// Run against a fresh test data directory; this scenario creates its own party, entries and one saved bill.
// A bill opened from a BILL NO. link, or an entry opened from its INW. NO., goes back to the tab it was opened from,
// with the search, filters and scroll position as they were, once it is closed or finished.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "RETURN TRIP PARTY";
const MONTH = "2026-11";
const FIRST = 7401;
const COUNT = 40;
const BILLED = 7430;

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function seed() {
  await call("/api/masters/group", "POST", { name: "RETURN TRIP GROUP", active: true });
  await call("/api/masters/finish", "POST", { name: "RETURN TRIP FINISH", active: true, group: "RETURN TRIP GROUP", color: "black" });
  await call("/api/masters/style", "POST", {
    name: "RETURN TRIP STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  await call("/api/masters/party", "POST", { name: PARTY, active: true, discount: 0, billingStyle: "RETURN TRIP STYLE", color: "black" });
  await call("/api/masters/party/rate", "PUT", { party: PARTY, finish: "RETURN TRIP FINISH", rate: 100 });
  let billedId = 0;
  for (let i = 0; i < COUNT; i++) {
    const inwardNo = FIRST + i;
    const entry = await call("/api/entries", "POST", {
      registerMonth: MONTH, inwardNo, entryDate: `${MONTH}-02`, party: PARTY,
      designNo: `RT${inwardNo}`, lotNo: `L${inwardNo}`, than: 10, finish: "RETURN TRIP FINISH",
      dispatches: [{ qty: 10, gatePass: `GP${inwardNo}`, date: `${MONTH}-03` }],
    });
    if (inwardNo === BILLED) billedId = entry.id;
  }
  const drafts = await call("/api/billing/build", "POST", {
    party: PARTY, month: MONTH, entryIds: [billedId], billDate: `${MONTH}-30`, periodFrom: `${MONTH}-01`, periodTo: `${MONTH}-30`,
  });
  const [bill] = await call("/api/billing/save", "POST", { invoices: drafts });
  return bill;
}

(async () => {
  const bill = await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    const activeView = () => page.evaluate(() => document.querySelector(".view.active")?.id);
    const scrollOf = (view) => page.evaluate((id) => {
      const wrap = document.querySelector(`#${id} .table-wrap`);
      return { top: wrap.scrollTop, left: wrap.scrollLeft };
    }, view);
    // The tab draws its rows again first, then the scroll position is put back.
    const scrollSettles = (view, { top, left }) => page.waitForFunction(({ view, top, left }) => {
      const wrap = document.querySelector(`#${view} .table-wrap`);
      return Math.abs(wrap.scrollTop - top) <= 2 && Math.abs(wrap.scrollLeft - left) <= 2;
    }, { view, top, left }, { timeout: 3000 }).catch(() => {});
    const waitForView = (view) => page.waitForFunction((id) => document.getElementById(id).classList.contains("active"), view);
    const rowOf = (table, inwardNo) => page.locator(`#${table} tbody tr`).filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${inwardNo}$`) }) });
    const closeBill = () => page.locator("#invoiceEditor .drawer-foot button").filter({ hasText: /^Close$/ }).click();
    const waitForBill = () => page.locator("#invoiceDrawer[open] #ie-save").waitFor();

    // The Register is searched and scrolled down (and across) before the bill is opened.
    await page.locator('[data-view="register"]').click();
    await page.locator("#registerSearch").fill("RETURN TRIP");
    await rowOf("registerTable", FIRST + COUNT - 1).waitFor();
    await page.evaluate(() => {
      const wrap = document.querySelector("#view-register .table-wrap");
      wrap.scrollTop = wrap.scrollHeight;
      wrap.scrollLeft = 40;
    });
    const billLink = (table) => rowOf(table, BILLED).locator("a.bill-link");
    // Clicking first scrolls a link that is hidden (or under the sticky header) into view, so the link is put mid-screen.
    await billLink("registerTable").evaluate((link) => link.scrollIntoView({ block: "center", inline: "nearest" }));
    let before = await scrollOf("view-register");
    assert.ok(before.top > 100, `the register scrolls (scrollTop ${before.top})`);
    const expectRegisterAsLeft = async (message) => {
      await waitForView("view-register");
      await page.waitForFunction(() => !document.getElementById("invoiceDrawer").open);
      assert.equal(await page.locator("#registerSearch").inputValue(), "RETURN TRIP", `${message}: the search is kept`);
      await scrollSettles("view-register", before);
      const after = await scrollOf("view-register");
      assert.ok(Math.abs(after.top - before.top) <= 2, `${message}: scrollTop ${after.top} is back at ${before.top}`);
      assert.ok(Math.abs(after.left - before.left) <= 2, `${message}: scrollLeft ${after.left} is back at ${before.left}`);
    };

    // Close button.
    await billLink("registerTable").click();
    await waitForBill();
    assert.equal(await activeView(), "view-bills");
    assert.match(await page.locator("#invoiceEditor").textContent(), new RegExp(bill.invoiceNo.replace(/\\/g, "\\\\")));
    await closeBill();
    await expectRegisterAsLeft("Close");

    // Escape and the × in the title bar.
    await billLink("registerTable").click();
    await waitForBill();
    await page.keyboard.press("Escape");
    await expectRegisterAsLeft("Escape");
    await billLink("registerTable").click();
    await waitForBill();
    await page.locator("#invoiceEditor .drawer-head .icon-btn").click();
    await expectRegisterAsLeft("×");

    // Keeping unsaved changes keeps the bill open on Saved bills; discarding them goes back.
    await billLink("registerTable").click();
    await waitForBill();
    await page.locator("#ie-notes").fill("not saved");
    await closeBill();
    await page.locator("#appDialogCancel").click();
    assert.equal(await page.locator("#invoiceDrawer").evaluate((d) => d.open), true, "Keep editing keeps the bill open");
    assert.equal(await activeView(), "view-bills");
    await closeBill();
    await page.locator("#appDialogConfirm").click();
    await expectRegisterAsLeft("Discard changes");

    // An entry opened from its INW. NO.: Cancel, Escape and Save correction each go back to the Register.
    const openEntry = async (inwardNo) => {
      const cell = rowOf("registerTable", inwardNo).locator("td").first();
      await cell.evaluate((td) => td.scrollIntoView({ block: "center", inline: "nearest" }));
      before = await scrollOf("view-register");
      await cell.click();
      await page.waitForFunction((no) => document.getElementById("formTitle").textContent.startsWith(`Correcting INW. NO. ${no}`), inwardNo);
      assert.equal(await activeView(), "view-entry");
    };
    await openEntry(FIRST + COUNT - 2);
    await page.locator("#cancelEdit").click();
    await expectRegisterAsLeft("Cancel edit");
    await openEntry(FIRST + COUNT - 2);
    await page.keyboard.press("Escape");
    await expectRegisterAsLeft("Escape on the entry");
    await openEntry(FIRST + COUNT - 2);
    await page.locator("#designNo").fill("RTCHANGED");
    await page.locator("#saveButton").click();
    await expectRegisterAsLeft("Save correction");
    await page.waitForFunction(() => document.getElementById("toasts").textContent.includes("Corrected ✓"));
    assert.match(await rowOf("registerTable", FIRST + COUNT - 2).textContent(), /RTCHANGED/, "the register shows the correction");

    // Picking another tab by hand while correcting forgets the way back.
    await openEntry(FIRST + COUNT - 2);
    await page.locator('[data-view="partywise"]').click();
    await page.locator('[data-view="entry"]').click();
    await page.locator("#cancelEdit").click();
    assert.equal(await activeView(), "view-entry", "the entry stays on New entry after a tab was picked by hand");

    // Party-wise: the expanded party is kept and the bill closes back onto it.
    await page.locator('[data-view="partywise"]').click();
    const partyBar = page.locator("#partyTable tr.group").filter({ hasText: PARTY }).locator("button.group-bar");
    await partyBar.waitFor();
    if ((await partyBar.getAttribute("aria-expanded")) !== "true") await partyBar.click();
    await billLink("partyTable").evaluate((link) => link.scrollIntoView({ block: "center", inline: "nearest" }));
    const partyBefore = await scrollOf("view-partywise");
    // A DOM click: Playwright would first scroll the link clear of the sticky party and finish bars.
    await billLink("partyTable").evaluate((link) => link.click());
    await waitForBill();
    await closeBill();
    await waitForView("view-partywise");
    await scrollSettles("view-partywise", partyBefore);
    assert.equal(await partyBar.getAttribute("aria-expanded"), "true", "the party stays expanded");
    assert.equal(await billLink("partyTable").isVisible(), true);
    const partyAfter = await scrollOf("view-partywise");
    assert.ok(Math.abs(partyAfter.top - partyBefore.top) <= 2, `Party-wise scrollTop ${partyAfter.top} is back at ${partyBefore.top}`);

    // A bill opened from Saved bills itself closes onto Saved bills.
    await page.locator('[data-view="bills"]').click();
    await page.locator('.subtab[data-sub="saved"]').click();
    await page.locator(`#invoiceTable tbody tr[data-id="${bill.id}"]`).click();
    await waitForBill();
    await closeBill();
    await page.waitForFunction(() => !document.getElementById("invoiceDrawer").open);
    assert.equal(await activeView(), "view-bills", "Saved bills stays on Saved bills");

    assert.deepEqual(errors, []);
    console.log("PASS: bills and entries opened from another tab close back to where they were opened.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
