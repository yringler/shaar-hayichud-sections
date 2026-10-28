/**
 * Chapter tree types (mirroring schema/v1/chapter.schema.json) and the
 * corpus-wide line id rules the schema cannot express.
 */

/** One line of text with a stable, corpus-unique id. */
export interface Line {
  id: string;
  text: string;
}

/** A section. Sections have no persisted id. */
export interface TextNode {
  label?: string;
  children: (TextNode | Line)[];
  translation?: string;
}

export type Chapter = TextNode[];

/** Lines have `text` and no `children`; sections always have `children`. */
export function isLine(child: unknown): child is Line {
  return typeof child === 'object' && child !== null && !('children' in child) && 'text' in child;
}

export interface LineRef {
  line: Line;
  /** JSON pointer inside the chapter file, e.g. "/0/children/2". */
  pointer: string;
}

/** Every line in document order. */
export function* walkLines(chapter: Chapter): Generator<LineRef> {
  function* visit(node: TextNode, pointer: string): Generator<LineRef> {
    for (const [i, child] of node.children.entries()) {
      const p = `${pointer}/children/${i}`;
      if (isLine(child)) yield { line: child, pointer: p };
      else yield* visit(child, p);
    }
  }
  for (const [i, node] of chapter.entries()) yield* visit(node, `/${i}`);
}

export interface LineLocation {
  /** Chapter key, e.g. "chapter_01". */
  chapter: string;
  pointer: string;
}

/**
 * Indexes every line id across chapters. Returns an error for each id that
 * appears more than once (anywhere in the corpus).
 */
export function indexLineIds(chapters: { key: string; data: Chapter }[]): {
  index: Map<string, LineLocation>;
  errors: string[];
} {
  const index = new Map<string, LineLocation>();
  const errors: string[] = [];
  for (const ch of chapters) {
    for (const { line, pointer } of walkLines(ch.data)) {
      const seen = index.get(line.id);
      if (seen) {
        errors.push(
          `${ch.key}.json: ${pointer} line id "${line.id}" is already used at ${seen.chapter}.json ${seen.pointer}`,
        );
      } else {
        index.set(line.id, { chapter: ch.key, pointer });
      }
    }
  }
  return { index, errors };
}

/** Minimal alignment shape (schema/v1/alignment.schema.json). */
export interface Alignment {
  lectureId: string;
  segments: { chapter: string; lineId: string }[];
}

/** Every alignment segment must point at an existing line in its chapter. */
export function checkAlignmentLineIds(
  alignments: { file: string; data: Alignment }[],
  index: Map<string, LineLocation>,
): string[] {
  const errors: string[] = [];
  for (const { file, data } of alignments) {
    for (const [i, seg] of data.segments.entries()) {
      const loc = index.get(seg.lineId);
      if (!loc) errors.push(`${file}: /segments/${i} line id "${seg.lineId}" does not exist`);
      else if (loc.chapter !== seg.chapter) {
        errors.push(`${file}: /segments/${i} line id "${seg.lineId}" is in ${loc.chapter}, not ${seg.chapter}`);
      }
    }
  }
  return errors;
}
