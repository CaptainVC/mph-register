"use strict";

// Hinglish for texts with numbers or names in them: [pattern, translation] pairs, tried in order after the exact texts.
(() => {
  const EXACT = window.mphI18n.exact;
  const translateCore = (core) => window.mphI18n.translateCore(core);

  const FOLDER_SOURCE_HI = {
    "next to the app": "ऐप के पास",
    "in Documents": "Documents में",
    "set by MPH_DATA_DIR": "MPH_DATA_DIR द्वारा सेट",
  };

  function trStyleSummary(text) {
    // Only translate generated style summaries (not custom free-text style descriptions from config).
    if (/^(G\.P\.N\.|D\.N\.|LOT)/.test(text) && !text.includes("column:")) {
      return text
        .split(" · ")
        .map((part) => {
          if (part === "same lot on one line") return "एक ही लॉट एक Line में";
          if (part === "same gate pass on one line") return "एक ही गेट पास एक Line में";
          if (part === "sorted by number") return "नंबर के अनुसार क्रम";
          if (part === "by inward date") return "आवक Date के अनुसार";
          if (part === "small entries apart") return "छोटी Entries अलग";
          return part.replace(/=gate pass\b/g, "=गेट पास").replace(/=lot\b/g, "=लॉट");
        })
        .join(" · ");
    }
    return text;
  }

  function trProblemItem(item) {
    if (EXACT[item]) return EXACT[item];
    let m = /^Billing style "(.+)" not found$/.exec(item);
    if (m) return `Billing Style "${m[1]}" नहीं मिली`;
    m = /^Bill-to party "(.+)" not found$/.exec(item);
    if (m) return `बिल-टू पार्टी "${m[1]}" नहीं मिली`;
    m = /^Colour "(.+)" not in the colour list$/.exec(item);
    if (m) return `Colour "${m[1]}" Colour List में नहीं है`;
    return item;
  }

  function trProblemList(str) {
    return str.split(", ").map(trProblemItem).join(", ");
  }

  const PATTERNS = [
    // Table headers with numbers
    [/^JAWAK NAG (\d+)$/, (_, n) => `जावक नग ${n}`],
    [/^GATE PASS NO (\d+)$/, (_, n) => `गेट पास नं. ${n}`],
    [/^DATE (\d+)$/, (_, n) => `Date ${n}`],
    [/^([\d,]+) entries ticked$/, (_, n) => `${n} Entries Tick की गईं`],
    [/^([\d,]+) NAG$/, (_, n) => `${n} नग`],
    [/^Mark all ([\d,]+) sent in full$/, (_, n) => `सभी ${n} को पूरा भेजा गया Mark करें`],
    [/^Press Enter to send all ([\d,]+)$/, (_, n) => `सभी ${n} भेजने के लिए Enter दबाएँ`],
    [/^Saved ✓ (1 entry|[\d,]+ entries) sent in full: INW\. NO\. (.+) · gate pass (.+) · (.+)$/,
      (_, count, numbers, gatePass, date) => `Save हो गया ✓ ${count.replace(/ entry$/, " Entry").replace(/ entries$/, " Entries")} पूरी भेजी गईं: आवक सं. ${numbers} · गेट पास ${gatePass} · ${date}`],
    [/^Already billed: INW\. NO\. (.+)\. Changing an entry does not change its bill\.$/,
      (_, numbers) => `पहले से बिल बन चुका है: आवक सं. ${numbers}। Entry बदलने से उसका बिल नहीं बदलता।`],
    [/^Not saved for INW\. NO\. (\d+): (.+)$/, (_, n, message) => `आवक सं. ${n} Save नहीं हुई: ${translateCore(message)}`],

    // Row filter states and options
    [/^(.+) filter options$/, (_, label) => `${translateCore(label)} के Filter Options`],
    [/^(.+): (Any|Include|Exclude)$/, (_, label, mode) => `${translateCore(label)}: ${EXACT[mode]}`],
    [/^Excluding: (.+)$/, (_, labels) => `छिपाई गई Rows: ${labels.split(", ").map(translateCore).join(", ")}`],
    [/^(.+)\. Click to include\.$/, (_, tip) => `${translateCore(tip)}। शामिल करने के लिए Click करें।`],
    [/^(.+)\. Click to clear this filter\.$/, (_, tip) => `${translateCore(tip)}। यह Filter हटाने के लिए Click करें।`],

    // Entry form title & messages
    [/^New inward entry — (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register$/, (_, m, y) => `नई आवक Entry — ${m} ${y} रजिस्टर`],
    [/^Correcting INW\. NO\. (\d+) — (.+) \((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register(, carryover)?\)$/,
      (_, no, party, m, y, carry) => `आवक सं. ${no} की Correction — ${party} (${m} ${y} रजिस्टर${carry ? ", कैरीओवर" : ""})`],
    [/^(Saved|Corrected) ✓ INW\. NO\. (\d+) — (.+), all zero \(slip number only\)$/, (_, act, no, party) => `${act === "Corrected" ? "Correction हो गई" : "Save हो गया"} ✓ आवक सं. ${no} — ${party}, सब ज़ीरो (सिर्फ़ Slip नंबर)`],
    [/^(Saved|Corrected) ✓ INW\. NO\. (\d+) — (.+), ([\d,]+) THAN (.*)$/, (_, act, no, party, than, fin) => `${act === "Corrected" ? "Correction हो गई" : "Save हो गया"} ✓ आवक सं. ${no} — ${party}, ${than} थान ${fin}`],
    [/^(Deleted|Restored) ✓ INW\. NO\. (\d+) — (.+) \((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register\)$/,
      (_, act, no, party, m, y) => `${act === "Deleted" ? "Delete हो गई" : "वापस आ गई"} ✓ आवक सं. ${no} — ${party} (${m} ${y} रजिस्टर)`],
    [/^INW\. NO\. (\d+) — (.+) \((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register\)$/,
      (_, no, party, m, y) => `आवक सं. ${no} — ${party} (${m} ${y} रजिस्टर)`],
    [/^· (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) register$/, (_, m, y) => `· ${m} ${y} रजिस्टर`],
    [/^All ([\d,]+) deleted entries will be removed for good and cannot be restored\.$/, (_, n) => `सभी ${n} Delete की गई Entries हमेशा के लिए हट जाएँगी और वापस नहीं लाई जा सकेंगी।`],
    [/^Permanently deleted ([\d,]+) (?:entry|entries) ✓$/, (_, n) => `${n} Entries हमेशा के लिए Delete हो गईं ✓`],
    [/^(\d+) months selected$/, (_, n) => `${n} Month चुने गए`],
    [/^(\d+) deleted$/, (_, n) => `${n} Delete की गईं`],
    [/^([\d,]+) dispatch(?:es)?$/, (_, n) => `${n} जावक`],
    [/^Check first: (.+)$/, (_, x) => `पहले Check करें: ${x}`],
    [/^was "(.+)" — enter the correct date$/, (_, txt) => `पहले "${txt}" था — सही Date डालें`],
    [/^Original text: (.+)$/, (_, txt) => `Original Text: ${txt}`],
    [/^Already billed \((.+)\)\. Changing this entry does not change that bill\.$/, (_, b) => `पहले से बिल बन चुका है (${translateCore(b)})। इस Entry में बदलाव से वह बिल नहीं बदलेगा।`],
    [/^Billed outside app: (.+)$/, (_, note) => `ऐप के बाहर बिल किया गया: ${note}`],
    [/^Clearing JAWAK NAG removes dispatch (\d+) \(([\d,]+) JAWAK NAG, gate pass (.+)\)\.$/, (_, n, qty, gp) => `जावक नग खाली करने से जावक ${n} हट जाएगी (${qty} जावक नग, गेट पास ${gp === "blank" ? "खाली" : gp})।`],

    // Counts
    [/^([\d,]+) of ([\d,]+) entries$/, (_, a, b) => `${b} में से ${a} Entries`],
    [/^([\d,]+) of ([\d,]+) entries for (.+)$/, (_, a, b, p) => `${p} के लिए ${b} में से ${a} Entries`],
    [/^([\d,]+) entries for (.+)$/, (_, a, p) => `${p} के लिए ${a} Entries`],
    [/^([\d,]+) entries$/, (_, a) => `${a} Entries`],
    [/^([\d,]+) of ([\d,]+) parties$/, (_, a, b) => `${b} में से ${a} पार्टियाँ`],
    [/^([\d,]+) of ([\d,]+) finishes$/, (_, a, b) => `${b} में से ${a} फ़िनिश`],
    [/^([\d,]+) groups$/, (_, a) => `${a} Groups`],
    [/^([\d,]+) selected$/, (_, a) => `${a} चुनी गईं`],
    [/^([\d,]+) parties$/, (_, a) => `${a} पार्टियाँ`],
    [/^now in (.+)$/, (_, g) => `अभी ${g} में`],
    [/^Delete the sister-firm group "(.+)"\?$/, (_, g) => `Sister-Firm Group "${g}" Delete करें?`],
    [/^([\d,]+) parties stay as they are, but are no longer linked as sister firms\. Re-check the links of imported bills afterwards\.$/,
      (_, n) => `${n} पार्टियाँ जैसी हैं वैसी रहेंगी, पर Sister Firms के रूप में Link नहीं रहेंगी। बाद में Import किए गए बिलों के Links दोबारा जाँचें।`],
    [/^([\d,]+) styles$/, (_, a) => `${a} Styles`],
    [/^([\d,]+) colours$/, (_, a) => `${a} Colours`],
    [/^([\d,]+) bills$/, (_, a) => `${a} बिल`],
    [/^\(([\d,]+) parties\)$/, (_, a) => `(${a} पार्टियाँ)`],
    [/^([\d,]+) inward entries$/, (_, a) => `${a} आवक Entries`],
    [/^([\d,]+) inward entries · ([\d,]+) parties with a rate$/, (_, a, b) => `${a} आवक Entries · ${b} पार्टियों में Rate`],
    [/^([\d,]+) finishes$/, (_, a) => `${a} फ़िनिश`],

    // Bills — Make & Drafts & Saved
    [/^([\d,]+) of ([\d,]+) entries selected$/, (_, n, all) => `${all} में से ${n} Entries चुनी गईं`],
    [/^([\d,]+) entries to bill$/, (_, n) => `${n} Entries का बिल बाकी है`],
    [/^([\d,]+) entries · ([\d,]+) not sent$/, (_, n, unsent) => `${n} Entries · ${unsent} नहीं भेजीं`],
    [/^([\d,]+) THAN$/, (_, n) => `${n} थान`],
    [/^Select inward entry (\d+)$/, (_, n) => `आवक Entry ${n} चुनें`],
    [/^Bill as (.+)$/, (_, finish) => `बिल फ़िनिश ${finish}`],
    [/^([\d,]+) entries · ([\d,]+) THAN(?: · ([\d,]+) not sent)?$/, (_, e, t, ns) => `${e} Entries · ${t} थान${ns ? ` · ${ns} नहीं भेजे` : ""}`],
    [/^Nothing left to bill with an inward date from (.+) to (.+)\.$/, (_, a, b) => `${a} से ${b} के बीच आवक Date वाली कोई Entry बिल के लिए बाकी नहीं है।`],
    [/^Nothing left to bill for this party with an inward date from (.+) to (.+)\. Move "Period from" back to see older entries\.$/,
      (_, a, b) => `${a} से ${b} के बीच इस पार्टी के लिए बिल बनाने की कोई Entry बाकी नहीं है। पुरानी Entries देखने के लिए "Period से" पीछे करें।`],
    [/^(.+) \(inactive\)$/, (_, p) => `${p} (Inactive)`],
    [/^Could not load totals: (.+)$/, (_, err) => `जोड़ नहीं खुला: ${err}`],
    [/^Could not load (.+)$/, (_, p) => `${p} Load नहीं हो सका`],
    [/^Also includes (.+)$/, (_, p) => `${p} भी शामिल हैं`],
    [/^([\d,]+) entr(?:y has|ies have) not been dispatched yet\.$/, (_, n) => `${n} Entries की अभी जावक नहीं हुई है।`],
    [/^Check in Masters → Parties: (.+)$/, (_, probs) => `Masters → पार्टियाँ में Check करें: ${trProblemList(probs)}`],
    [/^Check before billing: (.+)\. Fix in Masters → Parties\.$/, (_, probs) => `बिल बनाने से पहले Check करें: ${trProblemList(probs)}। Masters → पार्टियाँ में ठीक करें।`],
    [/^([\d,]+) selected · ([\d,]+) THAN$/, (_, n, t) => `${n} चुनी गई · ${t} थान`],
    [/^Make ([\d,]+) bills?$/, (_, n) => `${n} बिल बनाएँ`],
    [/^Make bills: ([\d,]+) entries \(([\d,]+) THAN\)$/, (_, n, t) => `बिल बनाएँ: ${n} Entries (${t} थान)`],
    [/^Make bills from ([\d,]+) ticked entries \(([\d,]+) THAN\)$/, (_, n, t) => `${n} चुनी गई Entries से बिल बनाएँ (${t} थान)`],
    [/^([\d,]+) selected entr(?:y has|ies have) not been dispatched yet\.$/, (_, n) => `${n} चुनी गई Entries की अभी जावक नहीं हुई है।`],
    [/^([\d,]+) bill\(s\) ready to check\. Nothing is saved until you press Save\.$/, (_, n) => `${n} बिल Check के लिए तैयार। Save दबाने तक कुछ Save नहीं होगा।`],
    [/^Bill (\d+) of (\d+) — (.+) — (.+)$/, (_, i, n, p, amt) => `बिल ${i} / ${n} — ${p} — ${amt}`],
    [/^Move row (\d+) from Bill (\d+)$/, (_, row, bill) => `बिल ${bill} से Row ${row} Move करें`],
    [/^Row moved to Bill (\d+)\.$/, (_, n) => `Row बिल ${n} में Move हो गई।`],
    [/^Bill recipient for Bill (\d+)$/, (_, n) => `बिल ${n} की पार्टी`],
    [/^Bill (\d+) is full \((\d+) printed rows\)\. The row was not moved\.$/, (_, n, m) => `बिल ${n} भरा हुआ है (${m} Print Rows)। Row Move नहीं हुई।`],
    [/^Row moved to Bill (\d+)\. The empty draft was removed\.$/, (_, n) => `Row बिल ${n} में Move हो गई। खाली Draft हटा दिया गया।`],
    [/^Save and number these (\d+) bills$/, (_, n) => `इन ${n} बिलों को Save करें और नंबर दें`],
    [/^Saved (\d+) bill\(s\)$/, (_, n) => `${n} बिल Save हो गए`],
    [/^(.+) — (.+) — ([\d,]+) THAN — (₹.+)$/, (_, no, p, t, amt) => `${no} — ${p} — ${t} थान — ${amt}`],
    [/^Less\/Discount \(([\d.,]+)%\)$/, (_, pct) => `Discount (${pct}%)`],
    [/^(CGST|SGST|IGST) ([\d.,]+)%$/, (_, tax, pct) => `${tax} ${pct}%`],
    [/^([\d,]+) THAN · ([\d,]+) lines · ([\d,]+) of ([\d,]+) printed rows(?: · limit (₹.+))?$/, (_, t, l, u, m, lim) => `${t} थान · ${l} Lines · ${m} में से ${u} Print Rows${lim ? ` · Limit ${lim}` : ""}`],
    [/^The lot \/ D\.N\. text is long: this line prints on (\d+) rows in a smaller font\.$/, (_, r) => `लॉट / डिज़ाइन नं. लंबा है: यह Line छोटे Font में ${r} Rows पर Print होगी।`],
    [/^(.+) — (.+) — CANCELLED$/, (_, no, p) => `${no} — ${p} — CANCELLED`],
    [/^(.*) · GSTIN (.+?)( · imported from Excel)?$/, (_, addr, gst, xl) => `${addr} · GSTIN ${gst === "none" ? "नहीं" : gst}${xl ? " · एक्सेल से इम्पोर्ट" : ""}`],
    [/^Cancel bill (.+)\?$/, (_, no) => `बिल ${no} Cancel करें?`],
    [/^Cancel bill (.+)\?\nThe number stays used and the bill is marked CANCELLED\. Its entries become unbilled so they can be billed again\.$/,
      (_, no) => `बिल ${no} Cancel करें?\n${EXACT["The number stays used and the bill is marked CANCELLED. Its entries become unbilled so they can be billed again."]}`],
    // Bill import & inward import
    [/^Imported ✓ ([\d,]+) bills$/, (_, n) => `Import हो गया ✓ ${n} बिल`],
    [/^Saved ✓ new links for ([\d,]+) bills$/, (_, n) => `Save हो गया ✓ ${n} बिलों के नए Links`],
    [/^([\d,]+) of ([\d,]+) bills get new links$/, (_, n, t) => `${t} में से ${n} बिलों को नए Links मिलेंगे`],
    [/^Notes \(([\d,]+)\)$/, (_, n) => `Notes (${n})`],
    [/^Bill lines that match another party's inward entries \(([\d,]+)\)$/, (_, n) => `बिल की Lines जो दूसरी पार्टी की आवक Entries से मिलती हैं (${n})`],
    [/^Entries that were linked before but no bill line points at now \(([\d,]+)\)$/, (_, n) => `वे Entries जो पहले Linked थीं पर अब कोई बिल Line उनकी ओर नहीं (${n})`],
    [/^Same group: (.+)$/, (_, names) => `इसी Group में: ${names}`],
    [/^Check passed — ([\d,]+) bills ready to import$/, (_, n) => `Check Pass — ${n} बिल Import के लिए तैयार`],
    [/^Nothing new — all ([\d,]+) bills are already in the app$/, (_, n) => `कुछ नया नहीं — सभी ${n} बिल पहले से App में हैं`],
    [/^Written (\d\d\.\d\d\.\d\d)$/, (_, d) => `${d} को लिखा`],
    [/^([\d,]+) bill\(s\) will be written\. Nothing is saved until you download the filled workbook\.$/,
      (_, n) => `${n} बिल लिखे जाएँगे। भरी हुई वर्कबुक Download करने तक कुछ Save नहीं होता।`],
    [/^Downloaded (.+) with ([\d,]+) bill\(s\) written\. Open it in Excel and check it, then replace your workbook with it \(keep the old one until you have checked\)\.$/,
      (_, f, n) => `${f} Download हुई, ${n} बिल लिखे गए। इसे Excel में खोलकर Check करें, फिर अपनी वर्कबुक की जगह इसे रखें (Check होने तक पुरानी रखें)।`],
    [/^New parties \(added as inactive with the workbook's details\): (.+)$/, (_, p) => `नई पार्टियाँ (Workbook की Details के साथ Inactive Add हुईं): ${p}`],
    [/^Inward entries of these parties that no bill line was linked to \(([\d,]+)\)$/, (_, n) => `इन पार्टियों की आवक Entries जो किसी बिल Line से Link नहीं हुईं (${n})`],
    [/^Marked ([\d,]+) ✓$/, (_, n) => `${n} Mark हो गईं ✓`],
    [/^Marked ([\d,]+) (?:entry|entries) as already billed$/, (_, n) => `${n} Entries को पहले से Billed Mark किया गया`],
    [/^Imported ([\d,]+) bills$/, (_, n) => `${n} बिल Import हो गए`],
    [/^Imported ([\d,]+) entries into (.+)$/, (_, n, m) => `${m} में ${n} Entries Import हो गईं`],
    [/^Updated (.+): ([\d,]+) new, ([\d,]+) changed, ([\d,]+) removed$/, (_, m, a, b, c) => `${m} Update हो गया: ${a} नई, ${b} बदली, ${c} हटाई गईं`],
    [/^Problems found in the workbook \(([\d,]+)\): nothing imported$/, (_, n) => `Workbook में Problems मिलीं (${n}): कुछ भी Import नहीं हुआ`],
    [/^Problems found in the bill workbook \(([\d,]+)\): nothing imported$/, (_, n) => `बिल Workbook में Problems मिलीं (${n}): कुछ भी Import नहीं हुआ`],
    [/^(.+) is up to date: no new changes in this workbook$/, (_, m) => `${m} Update है: इस Workbook में कोई नया बदलाव नहीं`],
    [/^Check passed: ready to (import|update) (.+)$/, (_, v, m) => `Check Pass: ${m} ${v === "import" ? "Import" : "Update"} के लिए तैयार`],
    [/^Check passed: ([\d,]+) bills ready to import$/, (_, n) => `Check Pass: ${n} बिल Import के लिए तैयार`],
    [/^Cannot import: (.+?)(?: \(and ([\d,]+) more\))?$/, (_, e, n) => `इम्पोर्ट नहीं हो सका: ${translateCore(e)}${n ? ` (और ${n})` : ""}`],
    [/^Saved new links for ([\d,]+) bills$/, (_, n) => `${n} बिलों के नए Links Save हो गए`],
    [/^Could not (save|check) the links: (.+)$/, (_, v, e) => `Links ${v === "save" ? "Save" : "Check"} नहीं हो सके: ${translateCore(e)}`],
    [/^Excel row (\d+): (.+)$/, (_, r, msg) => `Excel Row ${r}: ${translateCore(msg)}`],
    [/^Errors \((\d+)\)$/, (_, n) => `Errors (${n})`],
    [/^Warnings — imported as-is, flagged in the Register \((\d+)\)$/, (_, n) => `Warnings — जैसी हैं वैसी Import हुईं, रजिस्टर में Mark की गईं (${n})`],
    [/^Changes from the workbook \((\d+)\)$/, (_, n) => `Workbook से बदलाव (${n})`],
    [/^New entries \(([\d,]+)\)$/, (_, n) => `नई Entries (${n})`],
    [/^Updated entries \(([\d,]+)\)$/, (_, n) => `Update हुई Entries (${n})`],
    [/^Added by the import of (.+) on (.+)$/, (_, file, when) => `${file} के Import से ${when} को जुड़ी`],
    [/^Updated by the import of (.+?) \(((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4})\) on (\S+ \S+)(?:: (.+))?$/,
      (_, file, month, when, changes) => `${file} (${month}) के Import से ${when} को Update हुई${changes ? `: ${changes}` : ""}`],
    [/^Kept as in the app \((\d+)\)$/, (_, n) => `ऐप जैसा ही रखा गया (${n})`],
    [/^Not in the workbook \((\d+)\)$/, (_, n) => `Workbook में नहीं (${n})`],
    [/^INW\. NO\. (\d+) of (\d{4}-\d{2}-\d{2}) \((.+)\) (will be removed|was removed|was entered in the app; it stays)\.$/,
      (_, no, date, party, what) => `आवक सं. ${no}, ${date} (${party}) ${{ "will be removed": "हटाई जाएगी", "was removed": "हटा दी गई", "was entered in the app; it stays": "ऐप में दर्ज की गई थी; यह रहेगी" }[what]}।`],
    [/^Update ((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4})\?$/, (_, month) => `${month} Update करें?`],
    [/^([\d,]+) saved (?:entry is|entries are) not in this workbook and will be removed\. A backup of the data file is taken first\.$/,
      (_, n) => `${n} Saved Entries इस Workbook में नहीं हैं और हटा दी जाएँगी। पहले Data File का Backup लिया जाता है।`],

    // Masters forms, rates, styles, settings
    [/^Rates \(₹ per THAN\) — ([\d,]+) finish(?:es)?$/, (_, n) => `Rates (₹ प्रति थान) — ${n} फ़िनिश`],
    [/^Saved the (.+) rate ✓$/, (_, f) => `${f} का Rate Save हो गया ✓`],
    [/^Deleted the (.+) rate ✓$/, (_, f) => `${f} का Rate Delete हो गया ✓`],
    [/^Delete the (.+) rate \((.+)\) of (.+)\?$/, (_, f, r, p) => `${p} का ${f} Rate (${r}) Delete करें?`],
    [/^Rename "(.+)" to "(.+)"\?$/, (_, a, b) => `"${a}" का नाम बदलकर "${b}" करें?`],
    [/^Its ([\d,]+) inward entries move to the new name\. Saved bills keep the name they were printed with\.$/,
      (_, n) => `इसकी ${n} आवक Entries नए नाम पर चली जाएँगी। Saved बिलों पर Print किया गया नाम ही रहेगा।`],
    [/^Rename "(.+)" to "(.+)"\?\nIts ([\d,]+) inward entries move to the new name\. Saved bills keep the name they were printed with\.$/,
      (_, a, b, n) => `"${a}" का नाम बदलकर "${b}" करें?\nइसकी ${n} आवक Entries नए नाम पर चली जाएँगी। Saved बिलों पर Print किया गया नाम ही रहेगा।`],
    [/^Rename finish "(.+)" to "(.+)"\?$/, (_, a, b) => `फ़िनिश "${a}" का नाम बदलकर "${b}" करें?`],
    [/^Its ([\d,]+) inward entries and all rates move to the new name\.$/,
      (_, n) => `इसकी ${n} आवक Entries और सभी Rates नए नाम पर चले जाएँगे।`],
    [/^Rename finish "(.+)" to "(.+)"\?\nIts ([\d,]+) inward entries and all rates move to the new name\.$/,
      (_, a, b, n) => `फ़िनिश "${a}" का नाम बदलकर "${b}" करें?\nइसकी ${n} आवक Entries और सभी Rates नए नाम पर चले जाएँगे।`],
    [/^Used by ([\d,]+) part(?:y|ies)$/, (_, n) => `${n} पार्टियों द्वारा उपयोग`],
    [/^Delete billing style "(.+)"\?$/, (_, n) => `Billing Style "${n}" Delete करें?`],
    [/^Delete colour "(.+)"\?$/, (_, n) => `Colour "${n}" Delete करें?`],
    [/^Saved ✓ (.+) — the bills of ([\d,]+) part(?:y|ies) follow it$/, (_, s, n) => `Save हो गया ✓ ${s} — ${n} पार्टियों के बिल इसके अनुसार बनेंगे`],
    [/^(.+) and ([\d,]+) more$/, (_, list, n) => `${list} और ${n} अन्य`],
    [/^Used by ([\d,]+) parties and ([\d,]+) finishes; renaming moves them$/, (_, p, f) => `${p} पार्टियों और ${f} फ़िनिश द्वारा उपयोग; नाम बदलने पर वे भी बदल जाएँगे`],
    [/^(.+) \(not found\)$/, (_, x) => `${x} (नहीं मिला)`],
    [/^(.+) \(not in the colour list\)$/, (_, x) => `${x} (Colour List में नहीं)`],
    [/^The printed bill has (\d+)\. Up to (\d+) fit on Letter, (\d+) on A4 \(smallest font ([\d.]+) pt\); more rows are drawn shorter\.$/,
      (_, t, l, a, pt) => `Print बिल में ${t} Rows हैं। Letter पर ज़्यादा से ज़्यादा ${l}, A4 पर ${a} Rows आती हैं (सबसे छोटा Font ${pt} pt); ज़्यादा Rows को छोटा किया जाता है।`],
    [/^If (.+) is missing, use$/, (_, font) => `यदि ${font} न मिले, तो उपयोग करें`],
    [/^Read: (.+) · Last saved by the app: (.+)$/, (_, r, s) => `पढ़ा गया: ${r} · ऐप ने आख़िरी बार Save किया: ${s}`],

    // Status bar & fatal/API errors
    [/^Version (.+) · ([\d,]+) entries · Data folder \((.+)\): (.+) · data file mph-data\.db \+ config file mph-config\.json$/,
      (_, v, e, src, dir) => `Version ${v} · ${e} Entries · Data Folder (${FOLDER_SOURCE_HI[src] || src}): ${dir} · Data File mph-data.db + Config File mph-config.json`],
    [/^Could not save the dark mode choice: (.+)$/, (_, err) => `Dark Mode की Choice Save नहीं हो सकी: ${translateCore(err)}`],
    [/^Could not save the language choice: (.+)$/, (_, err) => `Language की Choice Save नहीं हो सकी: ${translateCore(err)}`],
    [/^Could not reach the app: (.+)\. Close and reopen MPH Register\.$/, (_, err) => `ऐप से Connect नहीं हो सका: ${translateCore(err)}। MPH Register बंद करके फिर से खोलें।`],

    // New versions
    [/^Version (\S+) is available\. You have (\S+)\.$/, (_, l, c) => `Version ${l} आ गया है। आपके पास ${c} है।`],
    [/^Version (\S+) is the newest\.$/, (_, v) => `Version ${v} सबसे नया है।`],
    [/^Version (\S+) is already the newest\.$/, (_, v) => `Version ${v} पहले से सबसे नया है।`],
    [/^New version (\S+) is ready$/, (_, v) => `नया Version ${v} तैयार है`],
    [/^What's new in version (\S+)$/, (_, v) => `Version ${v} में क्या नया है`],
    [/^Update to version (\S+)\?$/, (_, v) => `Version ${v} पर Update करें?`],
    [/^Updated to version (\S+) ✓$/, (_, v) => `Version ${v} पर Update हो गया ✓`],
    [/^GitHub did not answer \((\d+)\)\. Try again later\.$/, (_, s) => `GitHub से जवाब नहीं मिला (${s})। बाद में फिर कोशिश करें।`],
    [/^Could not save the new version next to the app: (.+)$/, (_, err) => `नया Version App के पास Save नहीं हो सका: ${err}`],
    [/^Could not start the new version: (.+)$/, (_, err) => `नया Version शुरू नहीं हो सका: ${err}`],
    [/^Could not update: (.+)$/, (_, err) => `Update नहीं हो सका: ${translateCore(err)}`],
    [/^Version (\S+) is available\. You went back from it\.$/, (_, v) => `Version ${v} आ गया है। आप इससे वापस आए थे।`],
    [/^Go back to version (\S+)$/, (_, v) => `Version ${v} पर वापस जाएँ`],
    [/^Go back to version (\S+)\?$/, (_, v) => `Version ${v} पर वापस जाएँ?`],
    [/^This version stores the data in a newer way that the older version cannot read\. Going back puts your entries, bills and settings back to how they were at the update \((.*)\): everything changed since then is undone\.$/,
      (_, when) => `यह Version Data को नए तरीके से रखता है, जिसे पुराना Version नहीं पढ़ सकता। वापस जाने पर आपकी Entries, बिल और Settings वैसे हो जाएँगे जैसे Update के समय (${when}) थे: उसके बाद के सभी बदलाव हट जाएँगे।`],
    [/^Went back to version (\S+) ✓$/, (_, v) => `Version ${v} पर वापस आ गए ✓`],
    [/^Could not go back, so this is still version (\S+)\.$/, (_, v) => `वापस नहीं जा सके, इसलिए यह अभी भी Version ${v} है।`],
    [/^Could not go back: (.+)$/, (_, err) => `वापस नहीं जा सके: ${translateCore(err)}`],
    [/^Could not get the older version ready: (.+)$/, (_, err) => `पुराना Version तैयार नहीं हो सका: ${err}`],
    [/^Could not start going back: (.+)$/, (_, err) => `वापस जाना शुरू नहीं हो सका: ${err}`],
    [/^Request failed \((\d+)\)\.$/, (_, s) => `Request Fail हो गई (${s})।`],
    [/^PDF failed \((\d+)\)\.$/, (_, s) => `PDF Fail हो गया (${s})।`],

    // Aawak report
    [/^([\d,]+) arrival days$/, (_, n) => `${n} Aawak वाले दिन`],
    [/^([\d,]+) days$/, (_, n) => `${n} दिन`],

    // Print page toolbar & title
    [/^Loading (\d+) bill\(s\)…$/, (_, n) => `${n} बिल लोड हो रहे हैं…`],
    [/^(\d+) bill\(s\) ready — printed like the Excel bill \((.+), scale 100%, no headers\/footers\)\.(.*)$/,
      (_, n, paper, rest) => `${n} बिल तैयार — एक्सेल बिल जैसा प्रिंट (${paper}, स्केल 100%, बिना हेडर/फ़ुटर)।${rest ? ` ${translateCore(rest.trim())}` : ""}`],
    [/^(.+) needs (\d+) rows, more than its (\d+) — printed with (\d+) smaller rows\.$/,
      (_, no, r, lim, slots) => `${no} को ${r} Rows चाहिए, जो Limit ${lim} से ज़्यादा हैं — ${slots} छोटी Rows में Print किया गया।`],
    [/^Could not load (.+) \((\d+)\)\.$/, (_, p, s) => `${p} लोड नहीं हो सका (${s})।`],
    // Backend warnings & validators
    [/^Party "(.+)" is not in the party list\.$/, (_, p) => `पार्टी "${p}" पार्टी List में नहीं है।`],
    [/^(.+) is marked "No bill needed", so no bill can be made for it\. Untick it in Masters → Parties first\.$/,
      (_, p) => `${p} पर "बिल की ज़रूरत नहीं" लगा है, इसलिए इसका बिल नहीं बन सकता। पहले Masters → पार्टियाँ में इसे हटाएँ।`],
    [/^Finish "(.+)" is not in the finish list\.$/, (_, f) => `फ़िनिश "${f}" फ़िनिश List में नहीं है।`],
    [/^GSTIN "(.+)" is not valid\. It must be 15 characters, like 08ABCDE1234F1Z5, with a correct last check character\.$/,
      (_, g) => `GSTIN "${g}" Valid नहीं है। इसमें 15 Characters (जैसे 08ABCDE1234F1Z5) और सही आख़िरी Check Character होना चाहिए।`],
    [/^Firm GSTIN "(.+)" is not valid\.$/, (_, g) => `Firm GSTIN "${g}" Valid नहीं है।`],
    [/^Dispatched \((\d+)\) is more than NAG \+ TWO PART \((\d+)\)\.$/, (_, d, a) => `जावक (${d}), नग + टू पार्ट (${a}) से अधिक है।`],
    [/^Total dispatched \((\d+)\) is more than NAG \+ TWO PART \((\d+)\)\.$/, (_, d, a) => `कुल जावक (${d}), नग + टू पार्ट (${a}) से अधिक है।`],
    [/^SHORT THAN \((\d+)\) is more than THAN \((\d+)\)\.$/, (_, s, t) => `शॉर्ट थान (${s}), थान (${t}) से अधिक है।`],
    [/^Inward number (\d+) is used more than once this month\.$/, (_, n) => `आवक नंबर ${n} इस Month में एक से ज़्यादा बार इस्तेमाल हुआ है।`],
    [/^Inward number (\d+) is already used this month.*$/, (_, n) => `आवक नंबर ${n} इस Month में पहले से इस्तेमाल में है।`],
    [/^Dispatch (\d+) date is not a valid date \("(.+)"\)\.$/, (_, i, d) => `जावक ${i} की Date Valid नहीं है ("${d}")।`],
    [/^Dispatch (\d+) date \((.+)\) is before the inward date\.$/, (_, i, d) => `जावक ${i} की Date (${d}) आवक Date से पहले की है।`],
    [/^Dispatch (\d+): JAWAK NAG must be 1 or more\.$/, (_, i) => `जावक ${i}: जावक नग 1 या अधिक होना चाहिए।`],
    [/^Dispatch (\d+): enter the gate pass number\.$/, (_, i) => `जावक ${i}: गेट पास नंबर दर्ज करें।`],
    [/^Dispatch (\d+): date is before the inward date\.$/, (_, i) => `जावक ${i}: Date आवक Date से पहले की है।`],
    [/^No rate for (.+) — enter the rate\.$/, (_, f) => `${f === "a priced line" ? "Rate वाली Line" : f} के लिए Rate नहीं है — Rate डालें।`],
    [/^Party GSTIN (.+) is not valid — fix it in Masters\.$/, (_, g) => `पार्टी GSTIN ${g} Valid नहीं है — Masters में ठीक करें।`],
    [/^Bill total is (₹.+), not below the (₹.+) limit — split it\.$/, (_, tot, lim) => `बिल Total ${tot} है, जो ${lim} की Limit से कम नहीं है — इसे Split करें।`],
    [/^(\d+) entr(?:y|ies) billed before dispatch \(INW\. NO\. (.+)\)\.$/, (_, n, nos) => `${n} Entries जावक से पहले बिल की गईं (आवक सं. ${nos})।`],
    [/^(\d+) entr(?:y|ies) only partly dispatched \(INW\. NO\. (.+)\)\.$/, (_, n, nos) => `${n} Entries की सिर्फ़ Partial जावक हुई है (आवक सं. ${nos})।`],
    [/^THAN on the bill \(([\d,]+)\) differs from NETT THAN of its entries \(([\d,]+)\) — fine if some THAN went back unfinished\.$/,
      (_, b, e) => `बिल पर थान (${b}) इसकी Entries के नेट थान (${e}) से अलग हैं — अगर कुछ थान बिना बने वापस गए तो यह ठीक है।`],

    // Generic messages must follow the more specific rate, style and bill validation patterns.
    [/^Saved ✓ (.+)$/, (_, x) => `Save हो गया ✓ ${x}`],
    [/^Saved (.+)$/, (_, x) => `Save हो गया: ${x}`],
    [/^Restore bill (.+)\?$/, (_, no) => `बिल ${no} वापस लाएँ?`],
    [/^Restored (.+)$/, (_, x) => `वापस आ गया: ${x}`],
    [/^Cancelled (.+)$/, (_, x) => `Cancel हो गया: ${x}`],
    [/^Undo save for bill (.+)\?$/, (_, no) => `बिल ${no} का Save Undo करें?`],
    [/^Undid save for (.+)\. Next bill number: (\d+)\.$/, (_, no, n) => `${no} का Save Undo हो गया। अगला बिल नंबर: ${n}।`],
    [/^Deleted (.+)$/, (_, x) => `Delete हो गया: ${x}`],
    [/^Bills (.+) to (.+)$/, (_, a, b) => `बिल ${a} से ${b}`],
    [/^Bill (.+)$/, (_, a) => `बिल ${a}`],

  ];

  Object.assign(window.mphI18n, { patterns: PATTERNS, trStyleSummary, trProblemList });
})();
