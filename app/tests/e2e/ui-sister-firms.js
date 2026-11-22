// Run against a fresh test data directory; this scenario creates parties and a sister-firm group.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";
const PARTIES = ["SISTER UI A", "SISTER UI B", "SISTER UI C"];

async function call(path, method = "GET", body) {
  const response = await fetch(BASE + path, {
    method, headers: { "X-MPH-Request": "1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function seed() {
  await call("/api/masters/style", "POST", {
    name: "SISTER UI STYLE", gpnColumn: "gatePass", dnColumn: "designNo", lotColumn: "lotNo",
    lines: "onePerEntry", order: "inward", combineSmallEntries: false,
  });
  for (const name of PARTIES) await call("/api/masters/party", "POST", { name, active: true, discount: 0, billingStyle: "SISTER UI STYLE", color: "black" });
}

(async () => {
  await seed();
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => document.documentElement.classList.contains("ready"));

    await page.locator('[data-view="masters"]').click();
    const tabs = await page.locator('.subtabs[data-group="masters"] .subtab:visible').allTextContents();
    assert.equal(tabs[0], "Parties");
    assert.equal(tabs[1], "Sister firms");
    await page.locator('.subtab[data-sub="sisters"]').click();
    await page.locator("#sisterTable").waitFor();
    const existingGroups = await page.locator("#sisterTable tbody tr").count();

    // Add a group with two parties.
    await page.locator("#addSister").click();
    await page.locator("#sf-name").fill("UI FAMILY");
    await page.locator("#sf-search").fill("ui a");
    assert.equal(await page.locator("#sisterForm .sister-row:visible").count(), 1);
    await page.locator('#sisterForm .sister-row:visible input').check();
    await page.locator("#sf-search").fill("");
    await page.locator('#sisterForm .sister-row', { hasText: "SISTER UI B" }).locator("input").check();
    assert.equal(await page.locator("#sf-count").textContent(), "2 selected");
    await page.locator("#sf-save").click();
    const row = page.locator('#sisterTable tbody tr[data-sister="UI FAMILY"]');
    await row.waitFor();
    assert.equal(await page.locator("#sisterTable tbody tr").count(), existingGroups + 1);
    assert.equal(await row.locator("td").nth(1).textContent(), "2");
    assert.equal(await row.locator("td").nth(2).textContent(), "SISTER UI A, SISTER UI B");
    assert.equal(await page.locator("#sisterForm .form-message").textContent(), "Saved ✓ UI FAMILY");

    // The Parties tab shows the same group.
    assert.equal((await call("/api/masters/full")).parties.filter((p) => p.sisterGroup === "UI FAMILY").length, 2);

    // Rename and swap a member.
    await page.locator("#sf-name").fill("UI CLAN");
    await page.locator('#sisterForm .sister-row', { hasText: "SISTER UI A" }).locator("input").uncheck();
    await page.locator('#sisterForm .sister-row', { hasText: "SISTER UI C" }).locator("input").check();
    await page.locator("#sf-save").click();
    await page.locator('#sisterTable tbody tr[data-sister="UI CLAN"]').waitFor();
    assert.equal(await page.locator("#sisterTable tbody tr").count(), existingGroups + 1);
    assert.equal(await page.locator('#sisterTable tbody tr[data-sister="UI CLAN"] td').nth(2).textContent(), "SISTER UI B, SISTER UI C");

    // A name that is already used is refused with a message.
    await page.locator("#sisterForm .icon-btn").click();
    await page.locator("#addSister").click();
    await page.locator("#sf-name").fill("ui clan");
    await page.locator('#sisterForm .sister-row', { hasText: "SISTER UI A" }).locator("input").check();
    await page.locator("#sf-save").click();
    await page.locator("#sisterForm .form-message.err").waitFor();
    assert.match(await page.locator("#sisterForm .form-message").textContent(), /already exists/);
    await page.locator("#sisterForm .icon-btn").click();
    await page.locator("#appDialogConfirm").click();

    // Delete the group.
    await page.locator('#sisterTable tbody tr[data-sister="UI CLAN"]').click();
    await page.locator("#sf-delete").click();
    await page.locator("#appDialogConfirm").click();
    await page.locator('#sisterTable tbody tr[data-sister="UI CLAN"]').waitFor({ state: "detached" });
    assert.equal(await page.locator("#sisterTable tbody tr").count(), existingGroups);
    assert.equal((await call("/api/masters/full")).parties.filter((p) => PARTIES.includes(p.name) && p.sisterGroup).length, 0);
    assert.deepEqual(errors, []);
    console.log("Sister firms tab: OK");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
