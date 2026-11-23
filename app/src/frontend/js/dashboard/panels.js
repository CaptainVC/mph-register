"use strict";

// Dashboard: the party panel, the party picker and making bills from the dashboard.

// ---------- One party in detail (slides in from the right) ----------
function openPartyPanel(i) {
  dashState.ui.panel = i;
  renderPartyPanel();
  openDrawer($("dashPartyPanel"), $("dashPanelClose"));
}

function renderPartyPanel() {
  const dialog = $("dashPartyPanel");
  const m = dashState.model;
  const i = dashState.ui.panel;
  if (i === null || !m?.f.parties[i]) {
    if (dialog.open) dialog.close();
    return;
  }
  const view = dashView();
  const party = m.f.parties[i];
  const only = new Set([i]);
  const total = (rows, months) => rollup(rows, { months, parties: only }).get(0);
  const b = billOf(total(m.f.bills, view.monthSet));
  const p = billOf(view.compareOn ? total(m.f.bills, view.compareSet) : null);
  const w = inwardOf(total(m.f.inward, view.monthSet));
  const u = unbilledFor(only, view.monthSet);
  const stock = stockFor(only, view.monthSet).total;
  const quiet = quietFor(view).find((q) => q.party === i);
  const byMonth = rollup(m.f.bills, { parties: only, by: (row) => row[1] });
  const inByMonth = rollup(m.f.inward, { parties: only, by: (row) => row[1] });
  const months = chartMonths(view);
  const c = view.billChangeOk ? change(billOf(total(m.f.bills, view.measuredSet)).taxable, p.taxable) : null;
  const flags = [party.group ? L(`Sister firms: ${party.group}`, `सिस्टर फ़र्म: ${party.group}`) : "", party.active ? "" : L("Inactive", "बंद"), party.noBill ? L("No bill needed", "बिल की ज़रूरत नहीं") : ""].filter(Boolean);
  const finishes = finishRows(view, only).slice(0, 6);
  const canBill = billsAvailable() && u.ready.entries > 0;
  const close = () => closeDrawer(dialog, true);
  dialog.replaceChildren(el("div", { class: "dash-panel" }, [
    el("header", { class: "drawer-head" }, [
      el("h2", {}, [party.name, el("span", { class: "sub", text: [periodWords(view.months), ...flags].join(" · ") })]),
      el("button", { type: "button", id: "dashPanelClose", class: "icon-btn", title: L("Close (Esc)", "बंद करें (Esc)"), "aria-label": L("Close", "बंद करें"), text: "×", onclick: close }),
    ]),
    el("div", { class: "drawer-body" }, [
      el("div", { class: "kpis mini" }, [
        kpi({ id: "panel-billed", label: L("Billed before GST", "GST से पहले बिलिंग"), value: b.bills ? rs(b.taxable) : "—", title: rsFull(b.taxable),
          lines: [trendLine(c, view.compareText), b.bills ? L(`${num(b.bills)} bills · ${num(b.than)} THAN`, `${num(b.bills)} बिल · ${num(b.than)} थान`) : ""] }),
        kpi({ id: "panel-share", label: L("Share of all billing", "कुल बिलिंग में हिस्सा"), value: view.allBilled.taxable ? pct((b.taxable * 100) / view.allBilled.taxable) : "—",
          lines: [b.than ? L(`${perThan(b.taxable / b.than)} per THAN`, `प्रति थान ${perThan(b.taxable / b.than)}`) : "", b.gross ? L(`Discount ${pct((b.discount * 100) / b.gross)}`, `Discount ${pct((b.discount * 100) / b.gross)}`) : ""] }),
        kpi({ id: "panel-waiting", label: L("Waiting to be billed", "बिल बाक़ी"), value: rs(u.ready.value), tone: u.ready.entries ? "warn" : "",
          lines: [L(`${entriesText(u.ready.entries)} · today`, `${entriesText(u.ready.entries)} · आज तक`), u.oldest ? L(`Oldest inward ${niceDate(u.oldest)}`, `सबसे पुरानी आवक ${niceDate(u.oldest)}`) : ""] }),
        kpi({ id: "panel-cloth", label: L("Cloth received", "आया माल"), value: thanText(w.than),
          lines: [L(`${num(stock.pieces)} pieces in the factory now`, `अभी फ़ैक्ट्री में ${num(stock.pieces)} नग`), party.lastInward ? L(`Last cloth ${niceDate(party.lastInward)}`, `आख़िरी माल ${niceDate(party.lastInward)}`) : ""] }),
      ]),
      quiet ? el("p", { class: "insight warn panel-note", text: L(`Sending less cloth: usually ${num(quiet.usualThan)} THAN in 30 days, ${num(quiet.recentThan)} in the last 30.`, `कम माल आ रहा है: आम तौर पर 30 दिन में ${num(quiet.usualThan)} थान, पिछले 30 दिन में ${num(quiet.recentThan)}।`) }) : "",
      el("section", { class: "section" }, [
        el("div", { class: "section-head" }, [el("h3", { text: L("Month by month", "Month-वार") }), el("span", { class: "muted", text: L("Bars: billed before GST", "खंभे: GST से पहले बिलिंग") })]),
        columnChart({ categories: months, labels: months.map(shortMonth), series: [{ name: L("Billed before GST", "GST से पहले बिलिंग"), values: months.map((month) => billOf(byMonth.get(monthIndexOf(month))).taxable), className: "s-income", short: rsChart }],
          format: rsFull, axisFormat: rsChart, selected: view.months, compared: view.shownCompare, onPick: pickMonth, showValues: months.length <= 12, height: 300, width: 820 }),
        dashTable([th(L("Month", "Month"), "left"), th(L("Billed", "बिलिंग")), th(L("THAN billed", "बिल में थान")), th(L("Cloth received", "आया माल"))],
          months.filter((month) => byMonth.has(monthIndexOf(month)) || inByMonth.has(monthIndexOf(month))).reverse().map((month) => {
            const mb = billOf(byMonth.get(monthIndexOf(month)));
            const mw = inwardOf(inByMonth.get(monthIndexOf(month)));
            return el("tr", { class: view.months.includes(month) ? "picked" : "" }, [td(longMonth(month), "left"), td(mb.bills ? rsFull(mb.taxable) : "—"), td(mb.than ? num(mb.than) : "—"), td(mw.than ? num(mw.than) : "—")]);
          })),
      ]),
      el("section", { class: "section" }, [
        el("div", { class: "section-head" }, [el("h3", { text: L("Finishes in the period", "इस अवधि की फ़िनिश") }), el("span", { class: "muted", text: L("Job charges before discount", "Discount से पहले Job Charge") })]),
        finishes.length ? hbars(finishes.map((f, k) => ({ label: f.finish, value: f.amount, color: k, text: rs(f.amount), title: L(`${num(f.than)} THAN · ${perThan(f.rate)} average`, `${num(f.than)} थान · औसत ${perThan(f.rate)}`) })))
          : emptyNote(L("No bills in this period.", "इस अवधि में कोई बिल नहीं।")),
      ]),
      el("p", { class: "muted", text: [
        L(`Last bill: ${party.lastBill ? niceDate(party.lastBill) : "none"}`, `आख़िरी बिल: ${party.lastBill ? niceDate(party.lastBill) : "नहीं"}`),
        L(`Last dated dispatch: ${party.lastDispatch ? niceDate(party.lastDispatch) : "none"}`, `आख़िरी जावक: ${party.lastDispatch ? niceDate(party.lastDispatch) : "नहीं"}`),
      ].join(" · ") }),
    ]),
    el("footer", { class: "drawer-foot" }, [
      el("button", { type: "button", id: "dashPanelOnly", text: L("Show only this party", "केवल यह पार्टी दिखाएँ"), onclick: () => { close(); setParties([i]); } }),
      el("button", { type: "button", id: "dashPanelCompare", class: "secondary", text: L("Add to comparison", "तुलना में जोड़ें"),
        onclick: () => { close(); const list = [...new Set([...dashView().parties, i])]; dashSelect({ parties: list.map(partyName), section: "compare" }, { top: true }); } }),
      canBill ? el("button", { type: "button", id: "dashPanelBill", class: "secondary", text: L("Review entries to bill", "बिल के लिए Entries जाँचें"), onclick: () => { close(); makeBillFor(party.name, u.oldest).catch(showFatal); } }) : "",
    ]),
  ]));
}

// ---------- Choosing parties from a list ----------
function openPicker() {
  dashState.ui.pick = new Set(dashView().parties);
  dashState.ui.pickFilter = "";
  renderPicker();
  openDrawer($("dashPicker"), $("dashPickerSearch"));
}

function pickerOrder(view) {
  const m = dashState.model;
  const billed = rollup(m.f.bills, { months: view.monthSet, by: (row) => row[0] });
  const value = (i) => billOf(billed.get(i)).taxable;
  return { billed: value, order: [...m.order].sort((a, b) => value(b) - value(a) || m.order.indexOf(a) - m.order.indexOf(b)) };
}

function pickerItems(view) {
  const m = dashState.model;
  const tokens = normalize(dashState.ui.pickFilter).split(" ").filter(Boolean);
  const { billed, order } = pickerOrder(view);
  const shown = order.filter((i) => tokens.every((token) => m.norm[i].includes(token) || normalize(m.f.parties[i].group).includes(token)));
  if (!shown.length) return [emptyNote(L("No party matches.", "कोई पार्टी नहीं मिली।"))];
  return shown.map((i) => {
    const party = m.f.parties[i];
    const box = el("input", { type: "checkbox", "data-party": String(i) });
    box.checked = dashState.ui.pick.has(i);
    box.addEventListener("change", () => {
      if (box.checked) dashState.ui.pick.add(i); else dashState.ui.pick.delete(i);
      updatePickerCount();
    });
    return el("label", { class: `check dash-pick${party.active ? "" : " inactive"}` }, [box,
      el("span", { class: "dash-pick-name", text: party.name }),
      party.group ? el("span", { class: "tag", text: party.group }) : "",
      el("span", { class: "dash-pick-hint", text: billed(i) ? rs(billed(i)) : party.active ? "" : L("inactive", "बंद") }),
    ]);
  });
}

function updatePickerCount() {
  const count = dashState.ui.pick.size;
  const text = $("dashPickerCount");
  if (text) text.textContent = count ? L(`${partiesText(count)} ticked`, `${partiesText(count)} चुनी हुई`) : L("None ticked: all parties are shown", "कोई नहीं चुनी: सभी पार्टियाँ दिखेंगी");
}

function renderPicker() {
  const dialog = $("dashPicker");
  const m = dashState.model;
  const view = dashView();
  const list = el("div", { class: "dash-pick-list", id: "dashPickerList" }, pickerItems(view));
  const redraw = () => {
    list.replaceChildren(...pickerItems(view));
    updatePickerCount();
  };
  const search = el("input", { type: "search", id: "dashPickerSearch", value: dashState.ui.pickFilter, placeholder: L("Find a party or sister group…", "पार्टी या सिस्टर ग्रुप खोजें…"), "aria-label": L("Find a party", "पार्टी खोजें") });
  search.addEventListener("input", () => {
    dashState.ui.pickFilter = search.value;
    redraw();
  });
  const pickTop = (count) => {
    dashState.ui.pick = new Set(topParties(view, count));
    redraw();
  };
  const groups = [...m.groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  const close = () => closeDrawer(dialog, true);
  dialog.replaceChildren(el("div", { class: "dash-panel" }, [
    el("header", { class: "drawer-head" }, [
      el("h2", {}, [L("Choose parties", "पार्टियाँ चुनें"), el("span", { class: "sub", text: L(`Ordered by billing in ${periodWords(view.months)}`, `${periodWords(view.months)} की बिलिंग के क्रम में`) })]),
      el("button", { type: "button", class: "icon-btn", title: L("Close (Esc)", "बंद करें (Esc)"), "aria-label": L("Close", "बंद करें"), text: "×", onclick: close }),
    ]),
    el("div", { class: "drawer-body dash-pick-body" }, [
      search,
      el("div", { class: "dash-side-actions" }, [
        el("button", { type: "button", class: "secondary small", text: L("Top 5", "शीर्ष 5"), onclick: () => pickTop(5) }),
        el("button", { type: "button", class: "secondary small", text: L("Top 10", "शीर्ष 10"), onclick: () => pickTop(10) }),
        el("button", { type: "button", class: "secondary small", text: L("Tick all shown", "दिख रही सब चुनें"), onclick: () => {
          for (const box of list.querySelectorAll("input[data-party]")) dashState.ui.pick.add(Number(box.dataset.party));
          redraw();
        } }),
        el("button", { type: "button", class: "ghost small", text: L("Clear ticks", "चुनाव हटाएँ"), onclick: () => { dashState.ui.pick.clear(); redraw(); } }),
      ]),
      groups.length ? el("div", { class: "dash-groups" }, [el("span", { class: "muted", text: L("Sister firms:", "सिस्टर फ़र्म:") }), ...groups.map((g) => el("button", { type: "button", class: "secondary small", title: g.parties.map(partyName).join(", "),
        text: `${g.name} (${g.parties.length})`, onclick: () => {
          const all = g.parties.every((i) => dashState.ui.pick.has(i));
          for (const i of g.parties) if (all) dashState.ui.pick.delete(i); else dashState.ui.pick.add(i);
          redraw();
        } }))]) : "",
      list,
    ]),
    el("footer", { class: "drawer-foot" }, [
      el("button", { type: "button", id: "dashPickerApply", text: L("Show these parties", "ये पार्टियाँ दिखाएँ"), onclick: () => { const pick = [...dashState.ui.pick]; close(); setParties(pick); } }),
      el("button", { type: "button", class: "secondary", text: L("Cancel", "रद्द करें"), onclick: close }),
      el("span", { class: "muted", id: "dashPickerCount" }),
    ]),
  ]));
  updatePickerCount();
}

/**
 * Opens Bills → Make bills for the party in the current bill month, with the period moved back to its oldest unbilled entry,
 * so every entry the dashboard counted is listed (whatever period was left from the last time bills were made).
 */
async function makeBillFor(party, oldest) {
  switchView("bills");
  switchSubview("bills", "make");
  $("billMonth").value = todayIso().slice(0, 7);
  applyMonthDates();
  if (oldest && oldest < $("periodFrom").value) $("periodFrom").value = oldest;
  await loadCandidates(party);
}

const billsAvailable = () => state.info?.showBills !== false && typeof loadCandidates === "function";
