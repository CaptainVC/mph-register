const { setTimeout: delay } = require("node:timers/promises");

async function openList(control) {
  if (await control.getAttribute("aria-expanded") !== "true") await control.click();
  const id = await control.getAttribute("aria-controls");
  return control.page().locator(`#${id}:popover-open`);
}

async function dropdownOption(control, value) {
  return (await openList(control)).locator(`[role="option"][data-value=${JSON.stringify(String(value))}]`);
}

async function chooseDropdown(control, value) {
  await (await dropdownOption(control, value)).click();
}

const dropdownValue = (control) => control.evaluate((button) => button.value);

async function dropdownValues(control) {
  const list = await openList(control);
  await list.waitFor();
  const values = await list.getByRole("option").evaluateAll((options) => options.map((option) => option.dataset.value));
  await control.press("Escape");
  return values;
}

async function waitForDropdownValues(control, check) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check(await dropdownValues(control))) return;
    await delay(100);
  }
  throw new Error(`Expected dropdown options were not loaded: ${control}`);
}

module.exports = { chooseDropdown, dropdownOption, dropdownValue, dropdownValues, waitForDropdownValues };
