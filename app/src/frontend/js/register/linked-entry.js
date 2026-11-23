"use strict";

// Linked entry. An all-zero slip is kept only for its number: its D.N. ("INW NO 547") names the slip of an earlier register
// its THAN were entered under. The server finds it (entry.links, see EntryLinker); here the LINKED ENTRY column shows the link,
// a side window shows the entry at the other end, and the New Entry form checks the D.N. while it is typed.

const LINK_STATE_TIPS = {
  found: "Same party",
  otherParty: "Found under another party: probably a typing mistake in the D.N.",
  notFound: "No slip with this number in the registers before this month",
};

// "Jun" for a month of the same year as the entry, "Dec 2025" for another year.
function linkMonth(month, from) {
  if (!month) return "";
  const [year, number] = month.split("-");
  return year === String(from || "").split("-")[0] ? MONTHS[Number(number) - 1] : formatMonth(month);
}

// ← points back to the earlier entry, → forward to the all-zero slip that names this one. "INW" is dropped on a small
// laptop screen (see .link-inw in app.css) to keep Main on one screen.
function linkParts(link, entry) {
  if (link.state === "notFound") return ["⚠ ", "INW ", `${link.inwardNo} not found`];
  const arrow = link.direction === "later" ? "→" : "←";
  return [`${link.state === "otherParty" ? "⚠ " : ""}${arrow} ${linkMonth(link.registerMonth, entry.registerMonth)} · `, "INW ", String(link.inwardNo)];
}

function linkLabel(link, entry) {
  return linkParts(link, entry).join("");
}

function linkText(entry) {
  return (entry.links || []).map((link) => linkLabel(link, entry)).join(", ");
}

function linkTip(link) {
  if (link.state === "notFound") return `INW. NO. ${link.inwardNo} was not found in the registers before this month. Click for details.`;
  const where = `INW. NO. ${link.inwardNo} of the ${formatMonth(link.registerMonth)} register (${link.party}, ${formatDate(link.entryDate)})`;
  const base = link.direction === "later" ? `The all-zero slip ${where} names this entry` : `Open ${where}`;
  return link.state === "otherParty" ? `${base}. ${LINK_STATE_TIPS.otherParty}` : base;
}

function fillLinkCell(td, entry) {
  const box = el("span", { class: "link-box" });
  (entry.links || []).forEach((link, index) => {
    if (index) box.append(", ");
    const [before, inw, after] = linkParts(link, entry);
    box.append(el("a", {
      href: "#", class: `inward-link${link.state === "found" ? "" : " link-warn"}`, title: linkTip(link),
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        openLinkedEntry(entry, link);
      },
    }, [before, el("span", { class: "link-inw", text: inw }), after]));
  });
  td.append(box);
}

// An all-zero entry whose D.N. names a slip that is not there, or is under another party, needs a look.
function linkNeedsCheck(entry) {
  return (entry.links || []).some((link) => link.state !== "found");
}

function readOnlyField(title, value) {
  return el("div", { class: "field" }, [el("span", { class: "label", text: title }), el("output", { text: value === "" || value == null ? "\u00a0" : String(value) })]);
}

function dispatchLine(entry) {
  if (!entry.dispatches?.length) return "Nothing sent (JAWAK) yet.";
  return `Sent (JAWAK): ${entry.dispatches.map((d) => `${num(d.qty)} NAG on gate pass ${d.gatePass}, ${d.date ? formatDate(d.date) : d.dateText || "no date"}`).join("; ")}`;
}

// The side window of a link: the entry at its other end, read only, with a button to open it for correction.
async function openLinkedEntry(entry, link) {
  const dialog = $("linkedDrawer");
  const form = $("linkedForm");
  const close = el("button", { type: "button", class: "secondary", text: "Close", onclick: () => closeDrawer(dialog) });
  const fromText = `INW. NO. ${entry.inwardNo} of the ${formatMonth(entry.registerMonth)} register`;

  if (link.state === "notFound") {
    drawerForm(form, {
      title: "No linked entry found", subtitle: `INW. NO. ${entry.inwardNo} · D.N. “${entry.designNo}”`, key: `link-${entry.id}-${link.inwardNo}`,
      body: [
        el("p", { class: "link-note warn" }, ["No slip numbered ", el("b", { text: String(link.inwardNo) }), ` in the registers before ${formatMonth(entry.registerMonth)}.`]),
        el("p", { class: "muted", text: "Fix the number in the D.N. and the link is found by itself. This window changes nothing." }),
      ],
      actions: [el("button", { type: "button", text: `Open INW. NO. ${entry.inwardNo}`, onclick: () => { closeDrawer(dialog, true); openInwardEntry(entry.id); } }), close],
    });
    openDrawer(dialog);
    return;
  }

  let other;
  try {
    other = await api(`/api/entries/${link.entryId}`);
  } catch (error) {
    toast(`Could not open the linked entry: ${errorText(error)}`, "err");
    return;
  }
  const earlier = link.direction === "earlier";
  const slip = earlier ? entry : other;
  const target = earlier ? other : entry;
  const wrongParty = link.state === "otherParty";
  const note = wrongParty
    ? [el("b", { text: `INW. NO. ${slip.inwardNo}` }), ` of the ${formatMonth(slip.registerMonth)} register says “${slip.designNo}”, but INW. NO. ${target.inwardNo} of the ${formatMonth(target.registerMonth)} register belongs to another party.`]
    : earlier
      ? ["Pointed to by ", el("b", { text: fromText }), ` (${formatDate(entry.entryDate)}), whose D.N. says `, el("b", { text: `“${entry.designNo}”` }), "."]
      : ["This entry is named by the all-zero slip ", el("b", { text: `INW. NO. ${other.inwardNo}` }), ` of the ${formatMonth(other.registerMonth)} register, whose D.N. says `, el("b", { text: `“${other.designNo}”` }), "."];
  const fields = wrongParty
    ? [readOnlyField(`INW. NO. ${slip.inwardNo} (${formatMonth(slip.registerMonth).toUpperCase()})`, slip.party), readOnlyField(`INW. NO. ${target.inwardNo} (${formatMonth(target.registerMonth).toUpperCase()})`, target.party)]
    : [];
  fields.push(
    readOnlyField("DATE", formatDate(other.entryDate)), readOnlyField("PARTY", other.party),
    readOnlyField("D.N.", other.designNo), readOnlyField("LOT N.", other.lotNo),
    readOnlyField("THAN", num(other.than)), readOnlyField("NAG", num(other.nag)),
    readOnlyField("FINISH", other.finish), readOnlyField("NETT THAN", num(other.nettThan)),
    readOnlyField("BILL NO.", other.billedIn || ""), readOnlyField("BALANCE", num(other.balance)),
  );
  const openText = wrongParty ? `Open INW. NO. ${other.inwardNo} anyway` : "Open this entry";
  const actions = [el("button", { type: "button", text: openText, onclick: () => { closeDrawer(dialog, true); openInwardEntry(other.id); } })];
  if (wrongParty) {
    actions.push(el("button", { type: "button", class: "secondary", text: `Correct the D.N. of INW. NO. ${slip.inwardNo}`, onclick: () => { closeDrawer(dialog, true); openInwardEntry(slip.id); } }));
  }
  actions.push(close);
  drawerForm(form, {
    title: wrongParty ? "Check this link" : "Linked entry",
    subtitle: `INW. NO. ${other.inwardNo} — ${formatMonth(other.registerMonth)} register`,
    key: `link-${entry.id}-${link.entryId}`,
    body: [
      el("p", { class: `link-note${wrongParty ? " warn" : ""}` }, note),
      el("div", { class: "fields cols-2" }, fields),
      el("p", { class: "muted", text: dispatchLine(other) }),
    ],
    actions,
  });
  openDrawer(dialog);
}

// ---------- New Entry: the link a typed D.N. would get ----------
let linkPreviewSeq = 0;
let linkPreviewTimer = 0;

function scheduleLinkPreview() {
  clearTimeout(linkPreviewTimer);
  linkPreviewTimer = setTimeout(refreshLinkPreview, 250);
}

function showLinkPreview(links, month) {
  const box = $("linkPreview");
  $("linkPreviewField").classList.toggle("hidden", !links.length);
  box.replaceChildren(...links.map((link) => {
    const found = link.state === "found";
    const text = link.state === "notFound"
      ? `⚠ INW. NO. ${link.inwardNo} not found in the registers before ${formatMonth(month)}`
      : `${found ? "✓" : "⚠"} INW. NO. ${link.inwardNo} · ${formatMonth(link.registerMonth)} register · ${link.party} · ${formatDate(link.entryDate)} · ${num(link.than)} THAN${found ? "" : " — another party"}`;
    return el("span", { class: `link-line ${found ? "ok" : "warn"}`, text });
  }));
}

async function refreshLinkPreview() {
  const request = ++linkPreviewSeq;
  const form = readForm();
  const month = form.registerMonth;
  if (!month || !form.party || !isAllZeroInput(form)) { showLinkPreview([], month); return; }
  try {
    const links = await api(`/api/entries/links?month=${encodeURIComponent(month)}&party=${encodeURIComponent(form.party)}&designNo=${encodeURIComponent(form.designNo)}`);
    if (request === linkPreviewSeq) showLinkPreview(links, month);
  } catch {
    if (request === linkPreviewSeq) showLinkPreview([], month);
  }
}

["designNo", "party", "entryDate", "than", "tp", "twoPart"].forEach((id) => $(id).addEventListener("input", scheduleLinkPreview));
$("entryForm").addEventListener("change", scheduleLinkPreview);
