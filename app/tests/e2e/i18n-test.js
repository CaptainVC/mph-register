// Translation checks run without a server or browser, including in CI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// The translation scripts, in the order the pages load them.
const I18N = ["texts-main.js", "texts-masters.js", "texts-messages.js", "patterns.js", "i18n.js"];
const sources = I18N.map((file) => fs.readFileSync(path.join(__dirname, "../../src/frontend/js/i18n", file), "utf8"));
const storage = new Map();
const events = [];
const context = vm.createContext({
  window: {},
  document: {
    readyState: "loading", title: "MPH Register", body: null,
    documentElement: { dataset: {} },
    addEventListener() {},
    querySelectorAll: () => [],
    getElementById: () => null,
    dispatchEvent: (event) => events.push(event),
  },
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
  MutationObserver: class { takeRecords() {} observe() {} disconnect() {} },
  CustomEvent: class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  },
});
for (const source of sources) vm.runInContext(source, context);
const { t, applyLanguage, getLanguage } = context.window;
assert.equal(getLanguage(), "en");

const cases = [
  ["Print / Save PDF", "Print / PDF Save करें"],
  ["Period total", "अवधि का कुल जोड़"],
  ["By party / group", "पार्टी / Group के हिसाब से"],
  ["Sister firms grouped", "Sister Firms Group में"],
  ["7 arrival days", "7 Aawak वाले दिन"],
  ["7 days", "7 दिन"],
  ["Search lorry wala totals", "लॉरी वाले के जोड़ में Search करें"],
  ["Could not load totals: Network error", "जोड़ नहीं खुला: Network error"],
  ["New Entry", "नई Entry"],
  ["Menu", "मेन्यू"],
  ["Export to Excel…", "Excel में Export करें…"],
  ["Written 30.11.26", "30.11.26 को लिखा"],
  ["Nothing new — all 12 bills are already in the app", "कुछ नया नहीं — सभी 12 बिल पहले से App में हैं"],
  ["Open menu", "मेन्यू खोलें"],
  ["All (like Excel)", "सभी (Excel जैसे)"],
  ["4 entries ticked", "4 Entries Tick की गईं"],
  ["Mark all 4 sent in full", "सभी 4 को पूरा भेजा गया Mark करें"],
  ["Press Enter to send all 57", "सभी 57 भेजने के लिए Enter दबाएँ"],
  ["Saved ✓ 1 entry sent in full: INW. NO. 7 · gate pass 4145 · 27/Sep/26", "Save हो गया ✓ 1 Entry पूरी भेजी गईं: आवक सं. 7 · गेट पास 4145 · 27/Sep/26"],
  ["Saved ✓ 2 entries sent in full: INW. NO. 7, 8 · gate pass 4145 · 27/Sep/26", "Save हो गया ✓ 2 Entries पूरी भेजी गईं: आवक सं. 7, 8 · गेट पास 4145 · 27/Sep/26"],
  ["Theme (also in the right-side menu)", "Theme (दाईं ओर के मेन्यू में भी)"],
  ["Language (also in the right-side menu)", "Language (दाईं ओर के मेन्यू में भी)"],
  ["1 entry", "1 Entry"],
  ["3 months selected", "3 Month चुने गए"],
  ["No entries in these months.", "इन Months में कोई Entry नहीं है।"],
  ["Set bill dates", "बिल की Dates Set करें"],
  ["Review entries and make bills", "Entries Check करें और बिल बनाएँ"],
  ["Make 3 bills", "3 बिल बनाएँ"],
  ["Make 1 bill", "1 बिल बनाएँ"],
  ["Make bills: 2 entries (40 THAN)", "बिल बनाएँ: 2 Entries (40 थान)"],
  ["2 selected entries have not been dispatched yet.", "2 चुनी गई Entries की अभी जावक नहीं हुई है।"],
  ["Check in Masters → Parties: No rates", "Masters → पार्टियाँ में Check करें: कोई Rate नहीं"],
  ["Save", "Save करें"],
  ["Save changes", "बदलाव Save करें"],
  ["Edit", "Edit करें"],
  ["Delete", "Delete करें"],
  ["Delete entry", "Entry Delete करें"],
  ["Deleted entries", "Delete की गई Entries"],
  ["Deleted ✓ INW. NO. 5 — TEST PARTY (Oct 2026 register)", "Delete हो गई ✓ आवक सं. 5 — TEST PARTY (Oct 2026 रजिस्टर)"],
  ["Restored ✓ INW. NO. 5 — TEST PARTY (Oct 2026 register)", "वापस आ गई ✓ आवक सं. 5 — TEST PARTY (Oct 2026 रजिस्टर)"],
  ["Cancel", "Cancel करें"],
  ["Save entry (Enter)", "Entry Save करें (Enter)"],
  ["Click a cell to edit it; click INW. NO. to open the whole entry", "Edit करने के लिए Cell पर Click करें; पूरी Entry खोलने के लिए आवक सं. पर Click करें"],
  ["Dispatch not saved: it needs both JAWAK NAG and GATE PASS NO.", "जावक Save नहीं हुई: जावक नग और गेट पास नं. दोनों ज़रूरी हैं।"],
  ["Clearing JAWAK NAG removes dispatch 2 (1,200 JAWAK NAG, gate pass 7653).", "जावक नग खाली करने से जावक 2 हट जाएगी (1,200 जावक नग, गेट पास 7653)।"],
  ["Search", "Search"],
  ["Clear filters", "Filters Clear करें"],
  ["New entries (3)", "नई Entries (3)"],
  ["Updated entries (1)", "Update हुई Entries (1)"],
  ["Show updated entries in the Register", "Update हुई Entries रजिस्टर में दिखाएँ"],
  ["Added by the import of INWARD NOV.xlsm on 22/Nov/26 21:40", "INWARD NOV.xlsm के Import से 22/Nov/26 21:40 को जुड़ी"],
  ["Updated by the import of INWARD NOV.xlsm (Nov 2026) on 22/Nov/26 21:40: THAN 10 → 12",
    "INWARD NOV.xlsm (Nov 2026) के Import से 22/Nov/26 21:40 को Update हुई: THAN 10 → 12"],
  ["Repair filter options", "रिपेयर के Filter Options"],
  ["Repair: Exclude", "रिपेयर: छिपाएँ"],
  ["Excluding: All zero, Repair", "छिपाई गई Rows: सब ज़ीरो, रिपेयर"],
  ["Hide matching rows", "Match होने वाली Rows छिपाएँ"],
  ["Financial year", "Financial Year"],
  ["All financial years", "सभी Financial Years"],
  ["From workbook", "Workbook से"],
  ["No bills match the selected period and search.", "चुनी गई अवधि और Search से कोई बिल Match नहीं हुआ।"],
  ["April to March", "April से March"],
  ["No entries in this financial year.", "इस Financial Year में कोई Entry नहीं है।"],
  ["No entries yet.", "अभी कोई Entry नहीं है।"],
  ["Type to search party", "पार्टी Search करने के लिए लिखें"],
  ["Settings", "Settings"],
  ["Billing styles", "Billing Styles"],
  ["Rates (₹ per THAN)", "Rates (₹ प्रति थान)"],
  ["Group name", "Group का नाम"],
  ["Discount %", "Discount %"],
  ["Save settings", "Settings Save करें"],
  ["Dashboard tab (income, unbilled work, GST and parties)", "Dashboard Tab (आय, बिना बिल का काम, GST और पार्टियाँ)"],
  ["Unsaved changes", "बदलाव Save नहीं हुए"],
  ["Close without saving your changes?", "बदलाव Save किए बिना Close करें?"],
  ["No entries match the search and filters.", "Search और Filters से कोई Entry Match नहीं हुई।"],
  ["New inward entry — Nov 2026 register", "नई आवक Entry — Nov 2026 रजिस्टर"],
  ["3 of 1,200 entries", "1,200 में से 3 Entries"],
  ["3 of 1,200 entries for Save दर", "Save दर के लिए 1,200 में से 3 Entries"],
  ["2 inward entries · 3 parties with a rate", "2 आवक Entries · 3 पार्टियों में Rate"],
  ["2 entries · 40 THAN · 1 not sent", "2 Entries · 40 थान · 1 नहीं भेजे"],
  ["Saved ✓ INW. NO. 23 — Save दर, 40 THAN शैली", "Save हो गया ✓ आवक सं. 23 — Save दर, 40 थान शैली"],
  ["Corrected ✓ INW. NO. 23 — Save दर, 40 THAN शैली", "Correction हो गई ✓ आवक सं. 23 — Save दर, 40 थान शैली"],
  ["Saved ✓ INW. NO. 19 — HARLOW PRODUCT, all zero (slip number only)", "Save हो गया ✓ आवक सं. 19 — HARLOW PRODUCT, सब ज़ीरो (सिर्फ़ Slip नंबर)"],
  ["All zero", "सब ज़ीरो"],
  ["Save an all-zero entry?", "सब ज़ीरो वाली Entry Save करें?"],
  ["Make bills from 2 ticked entries (40 THAN)", "2 चुनी गई Entries से बिल बनाएँ (40 थान)"],
  ["Save and number these 2 bills", "इन 2 बिलों को Save करें और नंबर दें"],
  ["2 bill(s) ready to check. Nothing is saved until you press Save.", "2 बिल Check के लिए तैयार। Save दबाने तक कुछ Save नहीं होगा।"],
  ["Saved 2 bill(s)", "2 बिल Save हो गए"],
  ["Saved ✓ Save दर", "Save हो गया ✓ Save दर"],
  ["No rate for शैली — enter the rate.", "शैली के लिए Rate नहीं है — Rate डालें।"],
  ["No rate for a priced line — enter the rate.", "Rate वाली Line के लिए Rate नहीं है — Rate डालें।"],
  ["Saved the दर rate ✓", "दर का Rate Save हो गया ✓"],
  ["Deleted the दर rate ✓", "दर का Rate Delete हो गया ✓"],
  ["Saved ✓ शैली — the bills of 3 parties follow it", "Save हो गया ✓ शैली — 3 पार्टियों के बिल इसके अनुसार बनेंगे"],
  ["Rate can have at most 2 decimals.", "Rate में ज़्यादा से ज़्यादा 2 Decimal Places हो सकते हैं।"],
  ["No GSTIN, No discount set, Billing style \"शैली\" not found", "GSTIN नहीं है, Discount Set नहीं है, Billing Style \"शैली\" नहीं मिली"],
  ["Colour \"रंग\" not in the colour list", "Colour \"रंग\" Colour List में नहीं है"],
  ["Party \"Save दर\" is not in the party list.", "पार्टी \"Save दर\" पार्टी List में नहीं है।"],
  ["Errors (2)", "Errors (2)"],
  ["Check passed — 3 bills ready to import", "Check Pass — 3 बिल Import के लिए तैयार"],
  ["Excel row 4: Enter a valid date.", "Excel Row 4: Valid Date डालें।"],
  ["40 THAN · 2 lines · 3 of 25 printed rows · limit ₹10,000.00", "40 थान · 2 Lines · 25 में से 3 Print Rows · Limit ₹10,000.00"],
  ["Bill total is ₹10,000.00, not below the ₹5,000.00 limit — split it.", "बिल Total ₹10,000.00 है, जो ₹5,000.00 की Limit से कम नहीं है — इसे Split करें।"],
  ["MPH/26-27/0001 — Save दर — CANCELLED", "MPH/26-27/0001 — Save दर — CANCELLED"],
  ["Cancel bill MPH/26-27/0001?", "बिल MPH/26-27/0001 Cancel करें?"],
  ["Undo save & release number", "Save Undo करें और नंबर वापस लें"],
  ["Never issued - undo save", "बिल जारी नहीं हुआ - Save Undo करें"],
  ["Undo save for bill MPH/26-27/0001?", "बिल MPH/26-27/0001 का Save Undo करें?"],
  ["Undid save for MPH/26-27/0001. Next bill number: 1.", "MPH/26-27/0001 का Save Undo हो गया। अगला बिल नंबर: 1।"],
  ["A later bill exists in this financial year, even if it is cancelled or for another party.", "इस Financial Year में इसके बाद का बिल है, भले ही वह Cancelled हो या दूसरी पार्टी का हो।"],
  ["The bill has changed. Reopen it before undoing the save.", "बिल बदल गया है। Save Undo करने से पहले उसे फिर से खोलें।"],
  ["PDF saved to your Downloads folder.", "PDF आपके Downloads Folder में Save हो गया।"],
  ["  Save changes\n", "  बदलाव Save करें\n"],
  ["Custom party प्रविष्टियाँ दर पंक्ति सहेजें", "Custom party प्रविष्टियाँ दर पंक्ति सहेजें"],
  ["₹1,23,456.78", "₹1,23,456.78"],
];

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
for (const month of months) {
  for (const text of [month, `${month} 2026`, `${month} 2026 (1,200)`, `21/${month}/26`]) {
    cases.push([text, text]);
  }
  cases.push(
    [`New inward entry — ${month} 2026 register`, `नई आवक Entry — ${month} 2026 रजिस्टर`],
    [`Correcting INW. NO. 23 — Save दर (${month} 2026 register, carryover)`,
      `आवक सं. 23 की Correction — Save दर (${month} 2026 रजिस्टर, कैरीओवर)`],
    [`Nothing left to bill with an inward date from 01/${month}/26 to 28/${month}/26.`,
      `01/${month}/26 से 28/${month}/26 के बीच आवक Date वाली कोई Entry बिल के लिए बाकी नहीं है।`],
    [`Nothing left to bill for this party with an inward date from 01/${month}/26 to 28/${month}/26. Move "Period from" back to see older entries.`,
      `01/${month}/26 से 28/${month}/26 के बीच इस पार्टी के लिए बिल बनाने की कोई Entry बाकी नहीं है। पुरानी Entries देखने के लिए "Period से" पीछे करें।`],
  );
}

for (const [en] of cases) assert.equal(t(en), en);
applyLanguage("hi");
assert.equal(getLanguage(), "hi");
assert.equal(storage.get("mph-lang"), "hi");
assert.equal(context.document.documentElement.lang, "hi");
assert.equal(events.at(-1).detail.language, "hi");
for (const [en, hi] of cases) assert.equal(t(en), hi, en);

const explanation = "The number stays used and the bill is marked CANCELLED. Its entries become unbilled so they can be billed again.";
assert.equal(t(`Cancel bill 123?\n${explanation}`), `बिल 123 Cancel करें?\n${t(explanation)}`);
assert.equal(t("Version 0.5 · 1,200 entries · Data folder (set by MPH_DATA_DIR): /tmp/सहेजें दर · data file mph-data.db + config file mph-config.json"),
  "Version 0.5 · 1,200 Entries · Data Folder (MPH_DATA_DIR द्वारा सेट): /tmp/सहेजें दर · Data File mph-data.db + Config File mph-config.json");

applyLanguage("en");
for (const [en] of cases) assert.equal(t(en), en);
assert.equal(storage.get("mph-lang"), "en");
console.log(`Passed ${cases.length + 2} Hinglish translation cases and English/hi locale round trips.`);
