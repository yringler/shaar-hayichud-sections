/**
 * One line of Hebrew text. `id` is persisted and stable: audio alignments and
 * transcripts point at a line by id alone, so ids are unique across the
 * whole corpus and survive edits to the line's text (see editor/lines.ts).
 */
export interface Line {
  id: string;
  /** Never contains "\n". May be blank while editing; blank lines are not saved. */
  text: string;
}

/**
 * A run of consecutive lines, edited as one textarea (lines joined by "\n").
 * Exists only in memory: on disk the lines sit directly in `children`.
 */
export interface TextRun {
  lines: Line[];
}

/**
 * In-memory editor node. `id` exists only while editing: it is regenerated on
 * every load and never written to the chapter JSON.
 */
export interface TextNode {
  id: string;
  label: string;
  /** Mixed content: text runs and child sections, in document order. */
  children: Content[];
  translation?: string;
}

export type Content = TextNode | TextRun;

export function isTextNode(item: Content | undefined): item is TextNode {
  return typeof item === 'object' && item !== null && 'children' in item;
}

export function isText(item: Content | undefined): item is TextRun {
  return typeof item === 'object' && item !== null && 'lines' in item;
}

/** The text a run shows in its textarea. */
export function runText(run: TextRun): string {
  return run.lines.map((l) => l.text).join('\n');
}
