// The real names for the suites that run on the real workbooks. They live next to the workbooks in
// Workbooks/private-test-data.json (or MPH_PRIVATE_TEST_DATA), never in git: git holds test data only
// (scripts/privacy_check.py). A suite that needs them calls load(), which skips the suite when the file is missing.
//
// The file: { "seed": "v04-real-seed.db", "corrections": "history-corrections.json",
//             "sisterGroups": "history-sister-groups.json", "parties": { "<alias>": "<real name>" },
//             "gstins": { ... }, "firm": { ... }, "values": { ... } }  (paths are relative to the Workbooks folder)
//
// Shell scripts: `node private-data.js <name>` prints one value: seed, corrections, sisterGroups or workbooks
// (absolute paths) or section.key (e.g. parties.bigParty). It prints SKIPPED and exits 3 when the file is missing:
//   SEED=$(node private-data.js seed) || exit $(( $? == 3 ? 0 : 1 ))
const fs = require("fs");
const path = require("path");

const workbooks = process.env.MPH_WORKBOOKS || path.resolve(__dirname, "../../../../Workbooks");
const file = process.env.MPH_PRIVATE_TEST_DATA || path.join(workbooks, "private-test-data.json");
const skipped = () => `SKIPPED: ${file} is not on this machine (the real-workbook suites need it).`;
const PATHS = { seed: "v04-real-seed.db", corrections: "history-corrections.json", sisterGroups: "history-sister-groups.json" };

function read() {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const strict = (section) => new Proxy(data[section] || {}, {
    get(target, key) {
      if (typeof key === "symbol" || key in target) return target[key];
      throw new Error(`${path.basename(file)} has no ${section}.${String(key)}`);
    },
  });
  const paths = Object.fromEntries(Object.entries(PATHS).map(([k, d]) => [k, path.resolve(workbooks, data[k] || d)]));
  return { P: strict("parties"), GSTIN: strict("gstins"), FIRM: strict("firm"), V: strict("values"), ...paths, workbooks, data };
}

function load() {
  if (!fs.existsSync(file)) {
    console.log(skipped());
    process.exit(0);
  }
  return read();
}

if (require.main === module) {
  if (!fs.existsSync(file)) {
    console.error(skipped());
    process.exit(3);
  }
  const name = process.argv[2] || "";
  const d = read();
  const [section, key] = name.split(".");
  const value = key === undefined ? (name === "workbooks" || name in PATHS ? d[name] : undefined) : d.data[section]?.[key];
  if (typeof value !== "string") {
    console.error(`${path.basename(file)} has no ${name || "(no name given)"}`);
    process.exit(1);
  }
  console.log(value);
}

module.exports = { load, file, workbooks };
