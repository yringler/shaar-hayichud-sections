/**
 * Unit tests for hugo/assets/js/search/text.ts (word folding shared by the
 * search indexer and the search page). Node 22.18+ runs the TypeScript
 * directly (type stripping); `yarn typecheck` checks the types.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeQuery,
  foldWord,
  indexContent,
  matcher,
  normalizeQuery,
  prefixVariants,
  snippet,
  words,
} from "../hugo/assets/js/search/text.ts";
import { GLOSSARY } from "../hugo/assets/js/search/glossary.ts";

test("foldWord drops quotes, gershayim, marks and edge punctuation, and lowercases", () => {
  assert.equal(foldWord('אבי"ע,'), "אביע");
  assert.equal(foldWord("דאבי''ע"), "דאביע");
  assert.equal(foldWord("אבי״ע"), "אביע");
  assert.equal(foldWord('דאבי\\"ע'), "דאביע");
  assert.equal(foldWord("ד'"), "ד");
  assert.equal(foldWord("בְּרֵאשִׁית"), "בראשית");
  assert.equal(foldWord("(Chochmah)."), "chochmah");
  assert.equal(foldWord("—"), "");
});

test("words splits on whitespace, maqaf and hyphens", () => {
  assert.deepEqual(words("Ein-Sof  כל־עלמין, ok"), ["ein", "sof", "כל", "עלמין", "ok"]);
});

test("prefixVariants strips up to three prefix letters, keeping two letters", () => {
  assert.deepEqual(prefixVariants("ושבחכמה"), ["שבחכמה", "בחכמה", "חכמה"]);
  assert.deepEqual(prefixVariants("הקו"), ["קו"]);
  assert.deepEqual(prefixVariants("קו"), []);
  assert.deepEqual(prefixVariants("דאצילות"), ["אצילות"]);
  assert.deepEqual(prefixVariants("חכמה"), []);
  assert.deepEqual(prefixVariants("hello"), []);
});

test("indexContent keeps the words in order, then adds prefix-free forms and glossary tokens", () => {
  const c = indexContent("ובחכמה דאבי''ע, and Tzimtzum");
  assert.ok(c.startsWith("ובחכמה דאביע and tzimtzum "));
  const extra = c.split(" ").slice(4);
  for (const t of ["בחכמה", "חכמה", "אביע", "צמצום"]) assert.ok(extra.includes(t), t);
});

test("indexContent matches multi-word glossary forms", () => {
  assert.ok(indexContent("עצמות אור אין סוף").split(" ").slice(4).includes("אין"));
  assert.ok(indexContent("the ein sof").split(" ").includes("סוף"));
});

test("analyzeQuery rewrites glossary forms to their canonical Hebrew", () => {
  assert.equal(normalizeQuery("Chokhmah"), "חכמה");
  assert.equal(normalizeQuery("ein-sof"), "אין סוף");
  assert.equal(normalizeQuery('מידות אבי"ע'), "מדות אביע");
  assert.equal(normalizeQuery("bittul of the yesh"), "ביטול of the yesh");
  // Prefixed forms too; other prefixed words are left as typed.
  assert.equal(normalizeQuery("ממלא וסובב"), "ממלא סובב");
  assert.equal(normalizeQuery("בחכמה"), "חכמה");
  assert.equal(normalizeQuery("ובענין"), "ענין");
  assert.equal(normalizeQuery("שבחינות"), "שבחינות");
  const a = analyzeQuery("binah and daas");
  assert.deepEqual(a.typed, ["binah", "and", "daas"]);
  assert.equal(a.entries.length, 2);
});

test("every glossary entry has a Hebrew form and folds to words", () => {
  for (const e of GLOSSARY) {
    assert.ok(e.he.length > 0 && words(e.he[0]).length > 0, JSON.stringify(e));
    for (const f of [...e.he, ...e.en]) assert.ok(words(f).length > 0, f);
  }
});

test("matcher marks typed words, prefixed Hebrew, stems and glossary forms", () => {
  const m = matcher("tzimtzum explaining חכמה");
  assert.ok(m("הצמצום,"));
  assert.ok(m("Tzimtzum"));
  assert.ok(m("explain"));
  assert.ok(m("ובחכמה"));
  assert.ok(m("חכמת"));
  assert.ok(!m("the"));
  assert.ok(!m("בינה"));
});

test("snippet windows around the first hit and merges unmarked text", () => {
  const text = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
  const parts = snippet(text, (w) => w === "w50", 10, 3);
  assert.deepEqual(parts, [
    { text: "… w47 w48 w49 ", hit: false },
    { text: "w50", hit: true },
    { text: " w51 w52 w53 w54 w55 w56 …", hit: false },
  ]);
  assert.deepEqual(snippet("a b", () => false), [{ text: "a b", hit: false }]);
  assert.deepEqual(snippet("", () => false), []);
});
