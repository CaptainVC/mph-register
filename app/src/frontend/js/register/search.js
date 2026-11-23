"use strict";

// Register search: matching words in any order and suggesting close spellings.

function registerSearchIndex() {
  if (registerSearchPool.index) return registerSearchPool.index;
  const byKey = new Map();
  for (const entry of registerSearchPool.entries) {
    const seen = new Set();
    SEARCH_SUGGESTION_FIELDS.forEach(([field, valuesOf], order) => {
      for (const raw of valuesOf(entry)) {
        const value = String(raw ?? "").trim();
        const norm = normalize(value);
        const key = `${order}|${norm}`;
        if (!norm || seen.has(key)) continue;
        seen.add(key);
        const found = byKey.get(key);
        if (found) {
          found.count++;
          continue;
        }
        const words = norm.split(" ");
        byKey.set(key, {
          value, field, order, norm, words, count: 1,
          compact: words.join(""), initials: words.length > 1 ? words.map((w) => w[0]).join("") : "",
        });
      }
    });
  }
  registerSearchPool.index = [...byKey.values()];
  return registerSearchPool.index;
}

// Optimal string alignment distance (a swap of two neighbouring letters is one typo); gives up past max.
// Three rows are reused between calls: this runs for every value in the index on each keystroke.
let typoRows = [new Int32Array(32), new Int32Array(32), new Int32Array(32)];
function typoDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (typoRows[0].length <= b.length) typoRows = typoRows.map(() => new Int32Array(b.length * 2 + 2));
  let [before, previous, current] = typoRows;
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1);
      current[j] = d;
      rowBest = Math.min(rowBest, d);
    }
    if (rowBest > max) return max + 1;
    [before, previous, current] = [previous, current, before];
  }
  return previous[b.length];
}

// Typos between a typed word and the start of a value's word. Numbers must match exactly: 7653 is not "close" to 7654.
function wordTypos(token, word) {
  if (word.startsWith(token)) return 0;
  if (token.length < 4 || !/[a-z]/.test(token)) return Infinity;
  const max = token.length < 7 ? 1 : 2;
  let best = Infinity;
  for (let length = token.length - 1; length <= token.length + 1; length++) {
    if (length > word.length) break;
    best = Math.min(best, typoDistance(token, word.slice(0, length), max));
  }
  return best <= max ? best : Infinity;
}

// Lower is closer: whole value, start of the value, start of its words, initials, anywhere inside; -1 if none.
function suggestionRank({ norm, words, compact, initials }, query, tokens, compactQuery) {
  if (norm === query) return 0;
  if (norm.startsWith(query)) return 1;
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 2;
  if (compactQuery.length > 1 && initials.startsWith(compactQuery)) return 3;
  if (tokens.every((t) => norm.includes(t)) || compact.includes(compactQuery)) return 4;
  return -1;
}

function typoRank({ words }, tokens) {
  let typos = 0;
  for (const token of tokens) {
    let best = Infinity;
    for (const word of words) best = Math.min(best, wordTypos(token, word));
    if (best === Infinity) return -1;
    typos += best;
  }
  return 5 + typos;
}

// One collator for every comparison: localeCompare with options builds a new one each time.
const NUMERIC_COLLATOR = new Intl.Collator(undefined, { numeric: true });
function betterSuggestion(a, b) {
  return a.rank - b.rank || b.item.count - a.item.count || a.item.order - b.item.order
    || NUMERIC_COLLATOR.compare(a.item.value, b.item.value);
}

function registerSearchSuggestions(text) {
  const query = normalize(text);
  if (!query) return [];
  const tokens = query.split(" ");
  const compactQuery = tokens.join("");
  const index = registerSearchIndex();
  const best = [];
  const keep = (item, rank) => {
    const candidate = { item, rank };
    if (best.length === SEARCH_SUGGESTION_LIMIT && betterSuggestion(candidate, best[best.length - 1]) >= 0) return;
    let at = best.length;
    while (at > 0 && betterSuggestion(candidate, best[at - 1]) < 0) at--;
    best.splice(at, 0, candidate);
    if (best.length > SEARCH_SUGGESTION_LIMIT) best.pop();
  };
  const missed = [];
  for (const item of index) {
    const rank = suggestionRank(item, query, tokens, compactQuery);
    if (rank >= 0) keep(item, rank);
    else missed.push(item);
  }
  // Typo matches only fill places the exact matches leave free.
  if (best.length < SEARCH_SUGGESTION_LIMIT && /[a-z]/.test(query)) {
    for (const item of missed) {
      const rank = typoRank(item, tokens);
      if (rank >= 0) keep(item, rank);
    }
  }
  const t = window.t ?? ((text) => text);
  return best.map(({ item }) => ({
    value: item.value, label: item.value, order: item.order,
    hint: `${t(item.field)} · ${t(`${num(item.count)} ${item.count === 1 ? "entry" : "entries"}`)}`,
  }));
}

const registerSearchSuggest = attachSuggestions($("registerSearch"), registerSearchSuggestions, {
  requireNavigation: true,
  hideWhenEmpty: true,
  onPick: ({ value, order }) => {
    registerSearchPick = { text: value, order };
    renderRegister();
  },
});
// Enter keeps what was typed (the table already shows it), so it only puts the list away.
$("registerSearch").addEventListener("keydown", (event) => {
  if (event.key === "Enter") registerSearchSuggest.close();
});

// The suggestion index is built while the app is idle after a list loads, so the first key typed does not wait for it.
function prepareRegisterSearchIndex() {
  const pool = registerSearchPool;
  const idle = window.requestIdleCallback || ((run) => setTimeout(run, 200));
  idle(() => { if (registerSearchPool === pool && !pool.index) registerSearchIndex(); }, { timeout: 4000 });
}
