/**
 * Parser for data/classes.txt. The grammar is documented in data/README.md;
 * keep the two in sync.
 *
 * The parser only reports syntax/structure problems. Cross-entry rules
 * (duplicate ids, duplicate files, ...) live in validate.ts.
 */

export type Level = 1 | 2 | 3;

export interface ParsedLecture {
  kind: 'lecture';
  /** Stable id: the '@ id' line if present, otherwise the filename. */
  id: string;
  explicitId: boolean;
  /** Title from the preceding '- title' line, or null. */
  title: string | null;
  filename: string;
  durationSeconds: number | null;
  /** CDN folder from the most recent '>' line (null if none seen yet). */
  folder: string | null;
  /** 0-based index of the file line in the source. */
  line: number;
}

export interface ParsedSection {
  kind: 'section';
  id: string;
  level: Level;
  title: string;
  /** 0-based index of the heading line in the source. */
  line: number;
  items: ParsedItem[];
}

export type ParsedItem = ParsedSection | ParsedLecture;

export interface Diagnostic {
  /** 1-based line number. */
  line: number;
  message: string;
}

export interface ParseResult {
  /** Top-level ('#') sections in file order. */
  series: ParsedSection[];
  /** Every lecture in file order. */
  lectures: ParsedLecture[];
  errors: Diagnostic[];
  /** Source split into lines (BOM removed), for tools that rewrite lines. */
  lines: string[];
}

const HEADING = /^(#{1,3})(?:\s+(.*))?$/;
const HEADING_ID = /^(.*?)\s*:\s*(\d+)$/;
const FOLDER = /^>\s*(.*)$/;
const TITLE = /^-\s+(.+)$/;
const LECTURE_ID = /^@\s+(.+)$/;
const FILE = /^(.*\.(?:mp3|m4a))(?::(\d+(?:\.\d+)?))?$/i;

export const MEDIA_FILE = /\.(mp3|m4a)$/i;

export function splitLines(text: string): string[] {
  return text.replace(/^﻿/, '').split(/\r?\n/);
}

export function parseClassesTxt(text: string): ParseResult {
  const lines = splitLines(text);
  const series: ParsedSection[] = [];
  const lectures: ParsedLecture[] = [];
  const errors: Diagnostic[] = [];

  let top: ParsedSection | null = null; // current '#'
  let sub: ParsedSection | null = null; // current '##'
  let leaf: ParsedSection | null = null; // current '###'
  let folder: string | null = null;
  let pendingTitle: { text: string; line: number } | null = null;
  let pendingId: { text: string; line: number } | null = null;

  const error = (index: number, message: string) => errors.push({ line: index + 1, message });

  const dropPending = (index: number) => {
    if (pendingTitle) {
      error(pendingTitle.line, `title "${pendingTitle.text}" is not followed by a file line (before line ${index + 1})`);
      pendingTitle = null;
    }
    if (pendingId) {
      error(pendingId.line, `lecture id "${pendingId.text}" is not followed by a file line (before line ${index + 1})`);
      pendingId = null;
    }
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) return;

    const heading = HEADING.exec(line);
    if (heading) {
      dropPending(index);
      const level = heading[1]!.length as Level;
      const body = (heading[2] ?? '').trim();

      if (body === '') {
        // Bare '##' / '###' closes the current section of that depth.
        if (level === 1) error(index, "a bare '#' is not allowed; '#' always starts a new series");
        if (level === 2) sub = null;
        leaf = null;
        return;
      }

      const m = HEADING_ID.exec(body);
      if (!m || m[1] === '') {
        error(index, `heading "${body}" needs a stable id suffix, e.g. "${body}:123"`);
        return;
      }
      const section: ParsedSection = { kind: 'section', id: m[2]!, level, title: m[1]!, line: index, items: [] };

      if (level === 1) {
        series.push(section);
        top = section;
        sub = null;
        leaf = null;
      } else if (level === 2) {
        if (!top) return error(index, "'##' heading before any '#' heading");
        top.items.push(section);
        sub = section;
        leaf = null;
      } else {
        const parent: ParsedSection | null = sub ?? top;
        if (!parent) return error(index, "'###' heading before any '#' heading");
        parent.items.push(section);
        leaf = section;
      }
      return;
    }

    const f = FOLDER.exec(line);
    if (f) {
      const value = f[1]!.trim();
      if (value === '') return error(index, "'>' line needs a CDN folder");
      folder = value;
      return;
    }

    const t = TITLE.exec(line);
    if (t) {
      if (pendingTitle) error(pendingTitle.line, `title "${pendingTitle.text}" is not followed by a file line`);
      pendingTitle = { text: t[1]!.trim(), line: index };
      return;
    }

    const i = LECTURE_ID.exec(line);
    if (i) {
      if (pendingId) error(pendingId.line, `lecture id "${pendingId.text}" is not followed by a file line`);
      pendingId = { text: i[1]!.trim(), line: index };
      return;
    }

    const file = FILE.exec(line);
    if (file) {
      const filename = file[1]!.trim();
      const parent: ParsedSection | null = leaf ?? sub ?? top;
      if (!parent) {
        error(index, `file "${filename}" appears before any '#' heading`);
      } else {
        if (folder === null) error(index, `file "${filename}" has no CDN folder (add a '>' line above it)`);
        const lecture: ParsedLecture = {
          kind: 'lecture',
          id: pendingId?.text ?? filename,
          explicitId: pendingId !== null,
          title: pendingTitle?.text ?? null,
          filename,
          durationSeconds: file[2] === undefined ? null : Number(file[2]),
          folder,
          line: index,
        };
        parent.items.push(lecture);
        lectures.push(lecture);
      }
      pendingTitle = null;
      pendingId = null;
      return;
    }

    error(index, `unrecognised line "${line}" (file lines must end in .mp3 or .m4a, optionally followed by ':seconds')`);
  });

  dropPending(lines.length);
  return { series, lectures, errors, lines };
}

/** Serialises a file line. Used by tools that rewrite durations. */
export function formatFileLine(filename: string, durationSeconds: number | null): string {
  return durationSeconds === null ? filename : `${filename}:${durationSeconds}`;
}
