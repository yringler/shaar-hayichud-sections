"use strict";

/**
 * XML-to-HTML renderer for Shaar Hayichud chapter files.
 *
 * Replicates the transform.xsl XSLT logic in JavaScript using fast-xml-parser.
 * The XSLT transformation rules were:
 *   - Root match: process section/section children at depth 1
 *   - Each section emits a flat <div class="depth-N"> when it has direct text
 *   - Hierarchical numbering: 1, 1.1, 1.1.1, …
 *   - Label from @label attribute appears next to the number
 *   - Text content has digit footnote markers stripped (replace /\d+/g, '')
 *   - Child sections are recursed into (flat output, not nested HTML)
 *
 * @module xml-renderer
 */

const { XMLParser } = require("fast-xml-parser");

/** @type {XMLParser} */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true, // CRITICAL: maintains document order of sibling elements
  trimValues: true,
});

/**
 * Minimal HTML escaping for text content and attribute values.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Extract the first meaningful direct text node from a children array.
 * Matches XSLT 1.0 behaviour of `normalize-space(string(text()))`:
 *   - text() selects direct text-node children
 *   - string() on a sequence takes the first item (XSLT 1.0 compat mode)
 *   - normalize-space() collapses internal whitespace and trims
 *
 * @param {Array<Record<string, unknown>>} children - parsed children of a section node
 * @returns {string} normalized text, or "" if none
 */
function getFirstDirectText(children) {
  for (const node of children) {
    if ("#text" in node) {
      // fast-xml-parser with trimValues:true already trims leading/trailing whitespace.
      // We still need to normalize internal whitespace (newlines, multiple spaces).
      const raw = String(node["#text"]);
      const normalized = raw.replace(/\s+/g, " ").trim();
      if (normalized) return normalized;
    }
  }
  return "";
}

/**
 * Filter child nodes to only section elements.
 * @param {Array<Record<string, unknown>>} nodes
 * @returns {Array<Record<string, unknown>>}
 */
function getSectionChildren(nodes) {
  return nodes.filter((n) => "section" in n);
}

/**
 * Recursively render a list of section nodes to an HTML string.
 *
 * Replicates:
 *   <xsl:template match="section">
 *     <xsl:param name="depth" select="1"/>
 *     <xsl:param name="prefix" select="''"/>
 *     ...
 *   </xsl:template>
 *
 * @param {Array<Record<string, unknown>>} nodes - array of parsed XML nodes
 * @param {number} depth - current nesting depth (1-based)
 * @param {string} prefix - dot-separated numbering prefix, e.g. "1.2"
 * @returns {string} HTML fragment
 */
function renderChildren(nodes, depth, prefix) {
  const sections = getSectionChildren(nodes);
  return sections
    .map((node, idx) => {
      const pos = idx + 1;
      const number = prefix ? `${prefix}.${pos}` : String(pos);

      /** @type {Array<Record<string, unknown>>} */
      const children = /** @type {any} */ (node["section"]) ?? [];

      /** @type {Record<string, string>} */
      const attrs = /** @type {any} */ (node[":@"]) ?? {};
      const label = attrs["label"] ?? "";

      // Get the section's own direct text (not recursive — mirrors XSLT text() axis)
      const text = getFirstDirectText(children);

      let html = "";

      if (text) {
        // Strip footnote digit markers — mirrors XSLT: replace($text, '\d+', '')
        const content = text.replace(/\d+/g, "");

        html += `<div class="depth-${depth}">`;
        html += `<div class="label">`;
        html += `<span class="number">${escapeHtml(number)}</span>`;
        if (label) html += ` ${escapeHtml(label)}`;
        html += `</div>`;
        html += `<div class="content">${escapeHtml(content)}</div>`;
        html += `</div>\n`;
      }

      // Recurse into child sections (flat output, not nested HTML)
      html += renderChildren(children, depth + 1, number);

      return html;
    })
    .join("");
}

/**
 * Parse and render an XML chapter file to an HTML fragment.
 *
 * Mirrors the XSLT root template:
 *   <xsl:template match="/">
 *     <xsl:apply-templates select="section/section">
 *       <xsl:with-param name="depth" select="1"/>
 *     </xsl:apply-templates>
 *   </xsl:template>
 *
 * @param {string} xmlContent - raw XML source (no YAML front matter)
 * @param {Record<string, unknown>} _data - Eleventy data object (available for future use)
 * @returns {Promise<string>} HTML fragment ready for layout injection
 */
async function renderXmlToHtml(xmlContent, _data) {
  /** @type {Array<Record<string, unknown>>} */
  const parsed = parser.parse(xmlContent);

  // The XML has a single root <section> element.
  // We want to process its direct <section> children (= top-level chapter sections).
  const rootNode = parsed.find((n) => "section" in n);
  if (!rootNode) return "";

  /** @type {Array<Record<string, unknown>>} */
  const rootChildren = /** @type {any} */ (rootNode["section"]);

  return renderChildren(rootChildren, 1, "");
}

module.exports = { renderXmlToHtml };
