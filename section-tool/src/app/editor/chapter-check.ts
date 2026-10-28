import { isLineId } from './line-id';

/**
 * A cheap structural check of chapter JSON before it is saved, mirroring the
 * line rules of data/schema/v1/chapter.schema.json: every text entry is a
 * line object with a valid id, line ids are unique within the file, and no
 * plain strings remain. The data build still does the full schema and
 * corpus-wide checks; this only stops an obviously broken save early.
 *
 * Dependency-free so the save function (functions/api/save.ts) can use it.
 * Returns a list of problems; empty means OK. Stops after `limit` problems.
 */
export function checkChapterJson(content: string, limit = 20): string[] {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return ['content is not valid JSON'];
  }
  if (!Array.isArray(parsed)) return ['chapter must be a JSON array of sections'];

  const seen = new Map<string, string>();
  const report = (msg: string) => {
    if (problems.length < limit) problems.push(msg);
  };

  const checkSection = (value: unknown, at: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      report(`${at}: expected a section object`);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key !== 'label' && key !== 'children' && key !== 'translation') report(`${at}: unexpected key "${key}"`);
    }
    if (obj['label'] !== undefined && typeof obj['label'] !== 'string') report(`${at}: label must be a string`);
    if (obj['translation'] !== undefined && typeof obj['translation'] !== 'string') {
      report(`${at}: translation must be a string`);
    }
    const children = obj['children'];
    if (!Array.isArray(children)) {
      report(`${at}: children must be an array`);
      return;
    }
    children.forEach((child, i) => {
      const childAt = `${at}/children/${i}`;
      if (child && typeof child === 'object' && !Array.isArray(child) && !('children' in child)) {
        checkLine(child as Record<string, unknown>, childAt);
      } else if (typeof child === 'string') {
        report(`${childAt}: text must be a line object {id, text}, not a string`);
      } else {
        checkSection(child, childAt);
      }
    });
  };

  const checkLine = (line: Record<string, unknown>, at: string) => {
    for (const key of Object.keys(line)) {
      if (key !== 'id' && key !== 'text') report(`${at}: unexpected key "${key}" on a line`);
    }
    const { id, text } = line;
    if (!isLineId(id)) {
      report(`${at}: line id must match [a-z2-7]{8}`);
    } else if (seen.has(id)) {
      report(`${at}: line id "${id}" is already used at ${seen.get(id)}`);
    } else {
      seen.set(id, at);
    }
    if (typeof text !== 'string' || !text.trim() || text.includes('\n')) {
      report(`${at}: line text must be a non-blank string without newlines`);
    }
  };

  parsed.forEach((section, i) => checkSection(section, `/${i}`));
  return problems;
}
