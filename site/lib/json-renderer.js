"use strict";

/**
 * JSON-to-HTML renderer for Shaar Hayichud chapter files.
 *
 * Input is a JSON array of TextNode objects (data/schema/v1/chapter.schema.json):
 *
 *   type Line = { id: string; text: string };
 *   type TextNode = {
 *     label?: string;
 *     children: (Line | TextNode)[];
 *     translation?: string;
 *   }
 *
 * Rendering rules (mirror hugo/layouts/partials/render-textnode.html):
 *   - Each TextNode with lines of its own emits a <div class="depth-N"> block
 *   - Hierarchical numbering: 1, 1.1, 1.1.1, …
 *   - Each line is a <span class="line" id="<line id>"> (several lines: one <p>
 *     each; a single line: inline). Pass { lineIds: false } to omit the ids.
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

function renderParagraphs(text) {
  if (text.includes("\n")) {
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => `<p>${l.trim()}</p>`)
      .join("");
  }
  return text;
}

/** A section always has `children`; a line ({ id, text }) never does. */
function isSection(node) {
  return typeof node === "object" && node !== null && Array.isArray(node.children);
}

function isLine(node) {
  return typeof node === "object" && node !== null && !isSection(node) && typeof node.text === "string";
}

/**
 * Render a section's own lines: footnote digits stripped, whitespace runs
 * collapsed, one <span class="line"> per line.
 *
 * @param {Array<{id: string, text: string}>} lines
 * @param {boolean} lineIds - whether to emit id attributes
 * @returns {string}
 */
function renderLines(lines, lineIds) {
  const spans = lines.map((line) => {
    // Strip footnote digit markers (mirrors the Hugo partial: replaceRE `\d+` "").
    const text = line.text.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
    const id = lineIds ? ` id="${escapeHtml(line.id).replace(/"/g, "&quot;")}"` : "";
    return `<span class="line"${id}>${escapeHtml(text)}</span>`;
  });
  return spans.length > 1 ? spans.map((s) => `<p>${s}</p>`).join("") : spans.join("");
}

/**
 * Recursively render a list of TextNode objects to an HTML string.
 *
 * @param {Array<object>} nodes - mixed array of TextNode and Line objects
 * @param {number} depth - current nesting depth (1-based)
 * @param {string} prefix - dot-separated numbering prefix, e.g. "1.2"
 * @param {{showTranslations: boolean, lineIds: boolean}} opts
 * @returns {string} HTML fragment
 */
function renderChildren(nodes, depth, prefix, opts) {
  // Lines at this level belong to the parent, which rendered them already.
  const sectionNodes = nodes.filter(isSection);

  return sectionNodes
    .map((node, idx) => {
      const pos = idx + 1;
      const number = prefix ? `${prefix}.${pos}` : String(pos);

      const label = node.label ?? "";
      const children = node.children;

      const lines = children.filter(isLine);
      let html = "";

      if (lines.length > 0) {
        html += `<div class="depth-${depth}">`;
        html += `<div class="label">`;
        html += `<span class="number">${escapeHtml(number)}</span>`;
        if (label) html += ` ${escapeHtml(label)}`;
        html += `</div>`;
        html += `<div class="content">${renderLines(lines, opts.lineIds)}</div>`;
        html += `</div>\n`;
      }

      if (opts.showTranslations && node.translation) {
        html += `<div class="translation">${renderParagraphs(node.translation)}</div>\n`;
      }

      // Recurse into child sections (flat output, not nested HTML)
      html += renderChildren(children, depth + 1, number, opts);

      return html;
    })
    .join("");
}

/**
 * Parse and render a JSON chapter file to an HTML fragment.
 *
 * @param {string} jsonContent - raw JSON source (array of TextNode objects)
 * @param {Record<string, unknown>} data - page data; translations are shown
 *   when data.locale.section === "translation"
 * @param {{lineIds?: boolean}} [options] - lineIds (default true): emit each
 *   line's id attribute. Line ids may start with a digit, which XHTML (EPUB)
 *   does not allow, so the EPUB builder turns them off.
 * @returns {Promise<string>} HTML fragment ready for layout injection
 */
async function renderJsonToHtml(jsonContent, data, options = {}) {
  let nodes;
  try {
    nodes = JSON.parse(jsonContent);
  } catch {
    return "";
  }

  if (!Array.isArray(nodes) || nodes.length === 0) return "";

  const opts = {
    showTranslations: data?.locale?.section === "translation",
    lineIds: options.lineIds ?? true,
  };
  return renderChildren(nodes, 1, "", opts);
}

module.exports = { renderJsonToHtml };
