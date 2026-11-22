// Run against a fresh test data directory; this scenario creates entries and saves bills.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { chooseDropdown, dropdownOption, dropdownValue, dropdownValues } = require("./dropdown-helpers");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTY = "ROW MOVE TEST";
const SISTER = "ROW MOVE SISTER";
const PERIOD = "from=2026-11-01&to=2026-11-30";

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function seed() {
  const settings = await call("/api/settings");
  await call("/api/settings", "PUT", { billRules: { ...settings.billRules, rowsPerBill: 5 } });
  await call("/api/masters/group", "POST", { name: "ROW MOVE GROUP", active: true });
  for (const name of ["MOVE FINISH", "OTHER FINISH"]) {
    await call("/api/masters/finish", "POST", { name, active: true, group: "ROW MOVE GROUP", color: "black" });
  }
  await call("/api/masters/style", "POST", {
    name: "ROW MOVE STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  await call("/api/masters/party", "POST", { name: PARTY, active: true, discount: 0, billingStyle: "ROW MOVE STYLE", color: "black", sisterGroup: "MOVE SISTERS" });
  await call("/api/masters/party", "POST", { name: SISTER, active: true, discount: 10, billingStyle: "ROW MOVE STYLE", color: "black", sisterGroup: "MOVE SISTERS" });
  await call("/api/masters/party/rate", "PUT", { party: SISTER, finish: "MOVE FINISH", rate: 125 });
  for (const [finish, rate] of [["MOVE FINISH", 100], ["OTHER FINISH", 80]]) {
    await call("/api/masters/party/rate", "PUT", { party: PARTY, finish, rate });
  }
  const entries = [];
  for (let i = 1; i <= 9; i++) {
    const entry = await call("/api/entries", "POST", {
      registerMonth: "2026-11", inwardNo: 8100 + i, entryDate: "2026-11-02", party: PARTY,
      designNo: `D${i}`, lotNo: `L${i}`, than: 10, finish: i === 9 ? "OTHER FINISH" : "MOVE FINISH",
      dispatches: [{ qty: 10, gatePass: `G${i}`, date: "2026-11-03" }],
    });
    entries.push(entry.id);
  }
  return entries;
}

(async () => {
  const entries = await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1268, height: 768 } });
    await page.clock.install({ time: new Date("2026-11-21T12:00:00") });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));
    await page.locator('[data-view="bills"]').click();
    await page.locator("#toBillList button").filter({ hasText: PARTY }).click();
    const drafts = page.locator("#draftArea .draft");
    const row = async (bill, design) => {
      const index = await drafts.nth(bill).locator("tbody tr").evaluateAll((rows, dn) => rows.findIndex((r) => r.querySelector(".g-dn")?.value === dn), design);
      assert.notEqual(index, -1, `${design} should be on bill ${bill + 1}`);
      return drafts.nth(bill).locator("tbody tr").nth(index);
    };
    const move = async (from, design, to, message = `Row moved to Bill ${to + 1}.`, failed = false) => {
      await page.evaluate(() => document.getElementById("toasts").replaceChildren());
      await chooseDropdown((await row(from, design)).locator(".move-bill-row"), to === await drafts.count() ? "new" : String(to));
      await page.locator("#saveBills:enabled").waitFor();
      // A failure stays in the layout; a completed move is announced by a toast.
      if (failed) assert.equal(await page.locator("#billMessage").textContent(), message);
      else {
        await page.locator(".toast", { hasText: message }).waitFor();
        assert.equal(await page.locator("#billMessage").textContent(), "");
      }
    };
    const detailDesigns = (bill) => drafts.nth(bill).locator(".k-detail .g-dn").evaluateAll((inputs) => inputs.map((input) => input.value));
    await page.locator("#candNone").click();
    for (const id of entries.slice(0, 2)) await page.locator(`#candidateTable .cand[data-id="${id}"]`).check();
    await page.locator("#makeBills").click();
    await drafts.first().waitFor();
    assert.equal(await drafts.count(), 1);
    await move(0, "D1", 1);
    assert.equal(await drafts.count(), 2);
    assert.equal(await drafts.nth(0).locator(".sum .g-qty").inputValue(), "10");
    assert.deepEqual(await detailDesigns(1), ["D1"], "a moved entry keeps its own detail row");
    const newSubtotal = drafts.nth(1).locator(".k-detail + .k-priced");
    assert.equal(await newSubtotal.locator(".g-dn").inputValue(), "");
    assert.equal(await newSubtotal.locator(".g-finish").inputValue(), "MOVE FINISH");
    assert.equal(await newSubtotal.locator(".g-rate").inputValue(), "100");
    assert.equal(await newSubtotal.locator(".amount").textContent(), "₹1,000.00");
    await move(1, "D1", 0, "Row moved to Bill 1. The empty draft was removed.");
    assert.equal(await drafts.count(), 1, "moving the last row removes its draft");
    assert.deepEqual(await detailDesigns(0), ["D2", "D1"]);
    assert.equal(await drafts.first().locator(".sum .g-qty").inputValue(), "20");
    await page.locator("#discardBills").click();

    for (const id of entries.slice(2, 5)) await page.locator(`#candidateTable .cand[data-id="${id}"]`).check();
    await page.locator("#makeBills").click();
    await drafts.nth(1).waitFor();
    assert.equal(await drafts.nth(1).locator(".k-priced .g-dn").inputValue(), "D5");
    await move(0, "D1", 1);
    assert.deepEqual(await detailDesigns(1), ["D5", "D1"], "a standalone priced entry can start a shared finish block");
    assert.equal(await drafts.nth(1).locator(".sum .g-qty").inputValue(), "20");
    await page.locator("#discardBills").click();

    await page.locator("#candAll").check();
    await page.locator("#makeBills").click();
    await drafts.nth(2).waitFor();
    assert.equal(await drafts.count(), 3);
    const [used, available] = await drafts.first().locator(".bill-card").evaluate((card) => [card.scrollWidth, card.clientWidth]);
    assert.ok(used <= available + 1, `move controls fit on a typical desktop (${used}px in ${available}px)`);
    assert.equal(await drafts.nth(0).locator(".k-priced .move-bill-row").count(), 0, "subtotal stays with its details");
    // A bill at its printed-row limit cannot be chosen as a target.
    const d1Move = (await row(0, "D1")).locator(".move-bill-row");
    const fullOption = await dropdownOption(d1Move, "1");
    assert.equal(await fullOption.textContent(), "Bill 2 (full)");
    assert.equal(await fullOption.isDisabled(), true);
    assert.equal(await (await dropdownOption(d1Move, "2")).isDisabled(), false);
    // Even when the menu is bypassed the move is refused and nothing changes.
    await d1Move.press("Escape");
    await d1Move.evaluate((control) => { control.value = "1"; control.dispatchEvent(new Event("change")); });
    await page.locator("#billMessage", { hasText: "Bill 2 is full (5 printed rows). The row was not moved." }).waitFor();
    assert.equal(await drafts.count(), 3);
    assert.equal(await drafts.nth(0).locator("tr.k-detail").count(), 4);
    assert.equal(await drafts.nth(1).locator("tr.k-detail").count(), 4);

    // A failed recalculation must leave both drafts intact and allow a retry.
    await page.route("**/api/billing/compute", (route) => route.fulfill({ status: 400, json: { errors: ["Test calculation failed."] } }), { times: 1 });
    await move(0, "D1", 2, "Test calculation failed.", true);
    assert.equal(await (await row(0, "D1")).locator(".g-qty").inputValue(), "10");
    const lot = (await row(0, "D1")).locator(".g-lot");
    await lot.fill("EDITED LOT");
    await lot.press("Tab");
    await move(0, "D1", 2);
    assert.equal(await (await row(2, "D1")).locator(".g-lot").inputValue(), "EDITED LOT");
    assert.equal(await drafts.nth(0).locator(".sum .g-qty").inputValue(), "30");
    await move(2, "D1", 0);

    await move(0, "D2", 3);
    await move(1, "D5", 3);
    assert.deepEqual(await detailDesigns(3), ["D2", "D5"], "moves from different bills append in arrival order");
    assert.equal(await drafts.nth(3).locator(".sum .g-qty").inputValue(), "20");
    const newRate = drafts.nth(3).locator(".g-rate");
    await newRate.fill("125");
    await newRate.press("Tab");
    await move(1, "D6", 3);
    assert.deepEqual(await detailDesigns(3), ["D2", "D5", "D6"]);
    assert.deepEqual(await drafts.nth(3).locator(".g-rate").evaluateAll((inputs) => inputs.map((input) => input.value)), ["125", "100"], "different rates stay in separate blocks");
    await page.locator("#discardBills").click();
    await page.locator("#makeBills").click();
    await drafts.nth(2).waitFor();

    await (await row(0, "D1")).locator(".g-lot").fill("EDITED LOT");
    await (await row(0, "D1")).locator(".g-lot").press("Tab");
    await move(0, "D1", 2);
    const separateSubtotal = drafts.nth(2).locator(".k-detail + .k-priced");
    assert.equal(await separateSubtotal.locator(".g-finish").inputValue(), "MOVE FINISH");
    assert.equal(await separateSubtotal.locator(".g-rate").inputValue(), "100");
    assert.equal(await separateSubtotal.locator(".amount").textContent(), "₹1,000.00");
    await move(2, "D1", 0);
    assert.deepEqual(await detailDesigns(0), ["D2", "D3", "D4", "D1"], "a matching finish uses only one remaining row");
    const d9Move = (await row(2, "D9")).locator(".move-bill-row");
    assert.equal(await (await dropdownOption(d9Move, "0")).isDisabled(), true, "bill 1 is full again");
    await d9Move.press("Escape");
    const secondDetail = drafts.nth(0).locator("tr.k-detail").nth(1);
    await secondDetail.getByRole("button", { name: "merge ↑" }).click();
    const gatePass = (await row(2, "D9")).locator(".g-gpn");
    const originalGatePass = await gatePass.inputValue();
    await gatePass.fill("9".repeat(60));
    await gatePass.press("Tab");
    await move(2, "D9", 0, "Bill 1 is full (5 printed rows). The row was not moved.", true);
    assert.equal(await drafts.count(), 3, "a wrapped priced row still needs more than one printed row");
    await gatePass.fill(originalGatePass);
    await gatePass.press("Tab");
    await move(2, "D9", 0, "Row moved to Bill 1. The empty draft was removed.");
    const compact = await row(0, "D9");
    assert.equal(await compact.getAttribute("class"), "k-priced", "a new finish uses one priced row when only one printed row is left");
    assert.equal(await compact.locator(".g-finish").inputValue(), "OTHER FINISH");
    assert.equal(await compact.locator(".g-rate").inputValue(), "80");
    assert.equal(await compact.locator(".amount").textContent(), "₹800.00");
    assert.equal(await drafts.count(), 2);
    assert.match(await page.locator("#saveBills").textContent(), /these 2 bills/);
    assert.doesNotMatch(await drafts.nth(0).locator(".warnings").textContent(), /printed rows/);

    const recipient = drafts.nth(1).locator(".draft-recipient");
    assert.deepEqual(await dropdownValues(recipient), [PARTY, SISTER]);
    await chooseDropdown(recipient, SISTER);
    await page.locator("#saveBills:enabled").waitFor();
    assert.equal(await dropdownValue(recipient), SISTER);
    assert.equal(await dropdownValue(drafts.first().locator(".draft-recipient")), PARTY);
    assert.equal(await drafts.nth(1).locator(".k-priced .g-rate").inputValue(), "125");
    const forSisters = (bill) => bill.party === PARTY || bill.party === SISTER;
    assert.equal((await call("/api/invoices")).filter(forSisters).length, 0);
    await page.locator("#saveBills").click();
    await page.getByRole("heading", { name: "Saved 2 bill(s)" }).waitFor();
    const saved = (await call("/api/invoices")).filter(forSisters).sort((a, b) => a.id - b.id);
    assert.equal(saved.length, 2);
    const actual = await Promise.all(saved.map(({ id }) => call(`/api/invoices/${id}`)));
    const links = (bill) => bill.lines.flatMap(({ entryIds }) => entryIds).sort((a, b) => a - b);
    assert.deepEqual(links(actual[0]), [...entries.slice(0, 4), entries[8]]);
    assert.deepEqual(links(actual[1]), entries.slice(4, 8));
    assert.equal(actual[0].lines.find(({ dn }) => dn === "D1").lot, "EDITED LOT");
    assert.deepEqual(actual.map(({ party, than, gross, discount }) => [party, than, gross, discount]), [[PARTY, 50, 4800, 0], [SISTER, 40, 5000, 500]]);
    assert.equal((await call(`/api/billing/candidates?party=${encodeURIComponent(PARTY)}&${PERIOD}`)).entries.length, 0);
    assert.deepEqual(errors, []);
    console.log("PASS: draft row moves, subtotal and rate preservation, rollback, row limits, empty draft removal and saved entry links.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
