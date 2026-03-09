"use strict";

/**
 * Unit tests for lib/xml-renderer.js using Node's built-in test runner.
 * Run with: node --test lib/xml-renderer.test.js
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renderXmlToHtml } = require("./xml-renderer");

// ─── helpers ────────────────────────────────────────────────────────────────

/** Collapse whitespace for easier assertion on multi-line HTML output */
function collapse(str) {
  return str.replace(/\s+/g, " ").trim();
}

// ─── tests ───────────────────────────────────────────────────────────────────

test("renders a single flat section with label", async () => {
  const xml = `<section><section label="פתיחה">שלום עולם</section></section>`;
  const html = await renderXmlToHtml(xml, {});
  assert.ok(html.includes('class="depth-1"'), "missing depth-1");
  assert.ok(html.includes('class="number"'), "missing .number");
  assert.ok(html.includes("1"), "missing section number");
  assert.ok(html.includes("פתיחה"), "missing label");
  assert.ok(html.includes("שלום עולם"), "missing content");
});

test("strips digit footnote markers from content", async () => {
  const xml = `<section><section label="א">הנה1 כבר2 מבואר3</section></section>`;
  const html = await renderXmlToHtml(xml, {});
  assert.ok(html.includes("הנה כבר מבואר"), "digits not stripped");
  assert.ok(!html.match(/הנה\d/), "digits remain in content");
});

test("uses hierarchical numbering for nested sections", async () => {
  const xml = `<section>
    <section label="א">ראשון
      <section label="ב">שני</section>
      <section label="ג">שלישי</section>
    </section>
  </section>`;
  const html = await renderXmlToHtml(xml, {});
  // Parent: number "1", children: "1.1" and "1.2"
  assert.ok(html.includes(">1<"), "parent number missing");
  assert.ok(html.includes(">1.1<"), "child 1.1 missing");
  assert.ok(html.includes(">1.2<"), "child 1.2 missing");
});

test("emits depth class increasing with nesting", async () => {
  const xml = `<section>
    <section label="א">ראשון
      <section label="ב">שני
        <section label="ג">שלישי</section>
      </section>
    </section>
  </section>`;
  const html = await renderXmlToHtml(xml, {});
  assert.ok(html.includes('class="depth-1"'), "depth-1 missing");
  assert.ok(html.includes('class="depth-2"'), "depth-2 missing");
  assert.ok(html.includes('class="depth-3"'), "depth-3 missing");
});

test("omits div for sections with no direct text", async () => {
  // Container section has only whitespace + children — no text div emitted
  const xml = `<section>
    <section>
      <section label="ב">שני</section>
    </section>
  </section>`;
  const html = await renderXmlToHtml(xml, {});
  // depth-1 should NOT appear (no direct text on the outer section)
  assert.ok(!html.includes('class="depth-1"'), "depth-1 should be absent");
  // depth-2 SHOULD appear for the inner section
  assert.ok(html.includes('class="depth-2"'), "depth-2 should be present");
});

test("HTML-escapes special characters in label and content", async () => {
  const xml = `<section><section label="a &amp; b">text &amp; more</section></section>`;
  const html = await renderXmlToHtml(xml, {});
  // & must be encoded in output
  assert.ok(html.includes("a &amp; b"), "label & not escaped");
  assert.ok(html.includes("text &amp; more"), "content & not escaped");
  assert.ok(!html.includes("a & b"), "raw & in label");
  assert.ok(!html.includes("text & more"), "raw & in content");
});

test("multiple top-level sections get sequential numbers", async () => {
  const xml = `<section>
    <section label="א">ראשון</section>
    <section label="ב">שני</section>
    <section label="ג">שלישי</section>
  </section>`;
  const html = await renderXmlToHtml(xml, {});
  assert.ok(html.includes(">1<"), "section 1 missing");
  assert.ok(html.includes(">2<"), "section 2 missing");
  assert.ok(html.includes(">3<"), "section 3 missing");
});

test("returns empty string when XML has no root section", async () => {
  const xml = `<root><p>hello</p></root>`;
  const html = await renderXmlToHtml(xml, {});
  assert.equal(html, "");
});

test("normalizes internal whitespace in text content", async () => {
  const xml = `<section><section label="א">שלום\n  עולם\n  שוב</section></section>`;
  const html = await renderXmlToHtml(xml, {});
  // Newlines and extra spaces collapsed to single space
  assert.ok(html.includes("שלום עולם שוב"), "whitespace not normalized");
});

test("does not emit translation div when showTranslations is false", async () => {
  const xml = `<section><section label="א">עברית<translation>English</translation></section></section>`;
  const html = await renderXmlToHtml(xml, {});
  assert.ok(!html.includes('class="translation"'), "translation div should be absent");
  assert.ok(!html.includes("English"), "translation text should be absent");
});

test("emits translation div when locale.section is 'translation'", async () => {
  const xml = `<section><section label="א">עברית<translation>English translation</translation></section></section>`;
  const html = await renderXmlToHtml(xml, { locale: { section: "translation" } });
  assert.ok(html.includes('class="translation"'), "translation div missing");
  assert.ok(html.includes("English translation"), "translation text missing");
  assert.ok(html.includes("עברית"), "Hebrew text missing");
});

test("skips translation div when section has no translation element", async () => {
  const xml = `<section><section label="א">עברית בלבד</section></section>`;
  const html = await renderXmlToHtml(xml, { locale: { section: "translation" } });
  assert.ok(!html.includes('class="translation"'), "translation div should be absent");
});
