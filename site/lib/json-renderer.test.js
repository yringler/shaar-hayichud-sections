"use strict";

/**
 * Unit tests for lib/json-renderer.js using Node's built-in test runner.
 * Run with: node --test lib/json-renderer.test.js
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renderJsonToHtml } = require("./json-renderer");

// ─── helpers ────────────────────────────────────────────────────────────────

/** Collapse whitespace for easier assertion on multi-line HTML output */
function collapse(str) {
  return str.replace(/\s+/g, " ").trim();
}

function json(nodes) {
  return JSON.stringify(nodes);
}

// ─── tests ───────────────────────────────────────────────────────────────────

test("renders a single flat section with label", async () => {
  const input = json([{ label: "פתיחה", children: ["שלום עולם"] }]);
  const html = await renderJsonToHtml(input, {});
  assert.ok(html.includes('class="depth-1"'), "missing depth-1");
  assert.ok(html.includes('class="number"'), "missing .number");
  assert.ok(html.includes("1"), "missing section number");
  assert.ok(html.includes("פתיחה"), "missing label");
  assert.ok(html.includes("שלום עולם"), "missing content");
});

test("strips digit footnote markers from content", async () => {
  const input = json([{ label: "א", children: ["הנה1 כבר2 מבואר3"] }]);
  const html = await renderJsonToHtml(input, {});
  assert.ok(html.includes("הנה כבר מבואר"), "digits not stripped");
  assert.ok(!html.match(/הנה\d/), "digits remain in content");
});

test("uses hierarchical numbering for nested sections", async () => {
  const input = json([{
    label: "א",
    children: [
      "ראשון",
      { label: "ב", children: ["שני"] },
      { label: "ג", children: ["שלישי"] },
    ],
  }]);
  const html = await renderJsonToHtml(input, {});
  assert.ok(html.includes(">1<"), "parent number missing");
  assert.ok(html.includes(">1.1<"), "child 1.1 missing");
  assert.ok(html.includes(">1.2<"), "child 1.2 missing");
});

test("emits depth class increasing with nesting", async () => {
  const input = json([{
    label: "א",
    children: [
      "ראשון",
      {
        label: "ב",
        children: [
          "שני",
          { label: "ג", children: ["שלישי"] },
        ],
      },
    ],
  }]);
  const html = await renderJsonToHtml(input, {});
  assert.ok(html.includes('class="depth-1"'), "depth-1 missing");
  assert.ok(html.includes('class="depth-2"'), "depth-2 missing");
  assert.ok(html.includes('class="depth-3"'), "depth-3 missing");
});

test("omits div for sections with no direct text", async () => {
  const input = json([{
    children: [
      { label: "ב", children: ["שני"] },
    ],
  }]);
  const html = await renderJsonToHtml(input, {});
  // depth-1 should NOT appear (no direct text on the outer section)
  assert.ok(!html.includes('class="depth-1"'), "depth-1 should be absent");
  // depth-2 SHOULD appear for the inner section
  assert.ok(html.includes('class="depth-2"'), "depth-2 should be present");
});

test("HTML-escapes special characters in label and content", async () => {
  const input = json([{ label: "a & b", children: ["text & more"] }]);
  const html = await renderJsonToHtml(input, {});
  assert.ok(html.includes("a &amp; b"), "label & not escaped");
  assert.ok(html.includes("text &amp; more"), "content & not escaped");
  assert.ok(!html.includes("a & b"), "raw & in label");
  assert.ok(!html.includes("text & more"), "raw & in content");
});

test("multiple top-level sections get sequential numbers", async () => {
  const input = json([
    { label: "א", children: ["ראשון"] },
    { label: "ב", children: ["שני"] },
    { label: "ג", children: ["שלישי"] },
  ]);
  const html = await renderJsonToHtml(input, {});
  assert.ok(html.includes(">1<"), "section 1 missing");
  assert.ok(html.includes(">2<"), "section 2 missing");
  assert.ok(html.includes(">3<"), "section 3 missing");
});

test("returns empty string for invalid JSON", async () => {
  const html = await renderJsonToHtml("not json", {});
  assert.equal(html, "");
});

test("returns empty string for empty array", async () => {
  const html = await renderJsonToHtml("[]", {});
  assert.equal(html, "");
});

test("normalizes internal whitespace in text content", async () => {
  const input = json([{ label: "א", children: ["שלום\n  עולם\n  שוב"] }]);
  const html = await renderJsonToHtml(input, {});
  assert.ok(html.includes("שלום עולם שוב"), "whitespace not normalized");
});

test("does not emit translation div when showTranslations is false", async () => {
  const input = json([{ label: "א", children: ["עברית"], translation: "English" }]);
  const html = await renderJsonToHtml(input, {});
  assert.ok(!html.includes('class="translation"'), "translation div should be absent");
  assert.ok(!html.includes("English"), "translation text should be absent");
});

test("emits translation div when locale.section is 'translation'", async () => {
  const input = json([{ label: "א", children: ["עברית"], translation: "English translation" }]);
  const html = await renderJsonToHtml(input, { locale: { section: "translation" } });
  assert.ok(html.includes('class="translation"'), "translation div missing");
  assert.ok(html.includes("English translation"), "translation text missing");
  assert.ok(html.includes("עברית"), "Hebrew text missing");
});

test("skips translation div when section has no translation", async () => {
  const input = json([{ label: "א", children: ["עברית בלבד"] }]);
  const html = await renderJsonToHtml(input, { locale: { section: "translation" } });
  assert.ok(!html.includes('class="translation"'), "translation div should be absent");
});

test("wraps multi-line translation in paragraph tags", async () => {
  const input = json([{ label: "א", children: ["עברית"], translation: "Para one\nPara two" }]);
  const html = await renderJsonToHtml(input, { locale: { section: "translation" } });
  assert.ok(html.includes("<p>Para one</p>"), "first paragraph missing");
  assert.ok(html.includes("<p>Para two</p>"), "second paragraph missing");
});
