"use strict";

/**
 * JSON-to-HTML renderer for Shaar Hayichud chapter files.
 *
 * Replaces the old xml-renderer.js (which used fast-xml-parser).
 * Input is a JSON array of TextNode objects matching the TextNode model:
 *
 *   type TextNode = {
 *     label?: string;
 *     children: (TextNode | string)[];
 *     translation?: string;
 *   }
 *
 * Rendering rules (same as the old XSLT / xml-renderer logic):
 *   - Each TextNode with direct text emits a <div class="depth-N"> block
 *   - Hierarchical numbering: 1, 1.1, 1.1.1, …
 *   - Footnote digit markers stripped from Hebrew text content
 *   - Child sections recurse (flat HTML output, not nested divs)
 *   - Translation shown only when data.locale.section === "translation"
 *
 * @module json-renderer
 */

/**
 * Minimal HTML escaping for text content.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderParagraphs(text, escape) {
  if (text.includes("\n")) {
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => `<p>${escape ? escapeHtml(l.trim()) : l.trim()}</p>`)
      .join("");
  }
  return escape ? escapeHtml(text) : text;
}

/**
 * Collect all direct text strings from a mixed children array.
 * Concatenates adjacent strings and normalises whitespace.
 *
 * @param {Array<object|string>} children
 * @returns {string}
 */
function getDirectText(children) {
  const parts = children
    .filter((c) => typeof c === "string")
    .map((s) => String(s).replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean);
  return parts.join(" ");
}

/**
 * Recursively render a list of TextNode objects to an HTML string.
 *
 * @param {Array<object|string>} nodes - mixed array of TextNode objects and strings
 * @param {number} depth - current nesting depth (1-based)
 * @param {string} prefix - dot-separated numbering prefix, e.g. "1.2"
 * @param {boolean} showTranslations - whether to emit translation divs
 * @returns {string} HTML fragment
 */
function renderChildren(nodes, depth, prefix, showTranslations) {
  // Only process TextNode objects (skip bare strings at this level — they're
  // handled by the parent via getDirectText)
  const sectionNodes = nodes.filter((n) => typeof n === "object" && n !== null);

  return sectionNodes
    .map((node, idx) => {
      const pos = idx + 1;
      const number = prefix ? `${prefix}.${pos}` : String(pos);

      const label = node.label ?? "";
      const children = node.children ?? [];

      const text = getDirectText(children);
      let html = "";

      if (text) {
        // Strip footnote digit markers — mirrors XSLT: replace($text, '\d+', '')
        const content = text.replace(/\d+/g, "");

        html += `<div class="depth-${depth}">`;
        html += `<div class="label">`;
        html += `<span class="number">${escapeHtml(number)}</span>`;
        if (label) html += ` ${escapeHtml(label)}`;
        html += `</div>`;
        html += `<div class="content">${renderParagraphs(content, true)}</div>`;
        html += `</div>\n`;
      }

      if (showTranslations && node.translation) {
        html += `<div class="translation">${renderParagraphs(node.translation, false)}</div>\n`;
      }

      // Recurse into child sections (flat output, not nested HTML)
      html += renderChildren(children, depth + 1, number, showTranslations);

      return html;
    })
    .join("");
}

/**
 * Parse and render a JSON chapter file to an HTML fragment.
 *
 * @param {string} jsonContent - raw JSON source (array of TextNode objects)
 * @param {Record<string, unknown>} data - Eleventy data object
 * @returns {Promise<string>} HTML fragment ready for layout injection
 */
async function renderJsonToHtml(jsonContent, data) {
  let nodes;
  try {
    nodes = JSON.parse(jsonContent);
  } catch {
    return "";
  }

  if (!Array.isArray(nodes) || nodes.length === 0) return "";

  const showTranslations = data?.locale?.section === "translation";
  return renderChildren(nodes, 1, "", showTranslations);
}

module.exports = { renderJsonToHtml };
