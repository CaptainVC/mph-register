// Messages sit along the bottom edge and go away after a few seconds. A plain one must not block clicks on what it covers;
// one with an Undo action takes clicks and can be dismissed.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

const BASE = process.env.MPH_BASE_URL || "http://127.0.0.1:5152";

(async () => {
  const browser = await chromium.launch({ channel: process.env.MPH_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE);
    await page.waitForFunction(() => typeof toast === "function");

    // A test button placed under the toast shows whether clicks reach it.
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "underToast";
      button.textContent = "Under";
      button.style.cssText = "position:fixed;right:40px;bottom:4px;width:200px;height:24px;z-index:1";
      button.addEventListener("click", () => { window.underToastClicks = (window.underToastClicks || 0) + 1; });
      document.body.append(button);
      toast("Undid save for 26-27\\JOB\\285, 26-27\\JOB\\284, 26-27\\JOB\\283. Next bill number: 283.");
    });
    const toastBox = await page.locator(".toast").boundingBox();
    assert.ok(Math.abs(toastBox.y + toastBox.height - 1000) < 1 && toastBox.x === 0 && toastBox.width === 1600 && toastBox.height < 80, "the message lies along the bottom edge");
    const buttonBox = await page.locator("#underToast").boundingBox();
    assert.ok(toastBox.x < buttonBox.x + buttonBox.width && toastBox.x + toastBox.width > buttonBox.x
      && toastBox.y < buttonBox.y + buttonBox.height && toastBox.y + toastBox.height > buttonBox.y, "the toast covers the button");
    await page.mouse.click(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
    assert.equal(await page.evaluate(() => window.underToastClicks), 1, "click passes through a plain toast");

    await page.locator(".toast").waitFor({ state: "detached", timeout: 9000 });

    // An action toast takes clicks and has a working close button.
    await page.evaluate(() => {
      document.getElementById("toasts").replaceChildren();
      toast("Deleted", "ok", { id: "toastUndo", label: "Undo", run: () => { window.undone = true; } });
    });
    await page.locator(".toast .toast-close").click();
    assert.equal(await page.locator(".toast").count(), 0, "close button dismisses the toast");
    assert.equal(await page.evaluate(() => window.undone), undefined);
    await page.evaluate(() => toast("Deleted", "ok", { id: "toastUndo", label: "Undo", run: () => { window.undone = true; } }));
    await page.locator("#toastUndo").click();
    assert.equal(await page.evaluate(() => window.undone), true, "Undo still runs");
    assert.deepEqual(errors, []);
    console.log("PASS: plain toasts are click-through; action toasts keep Undo and can be dismissed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
