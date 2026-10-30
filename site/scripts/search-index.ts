/**
 * Builds the site search index (Pagefind) into <public>/pagefind/. Run by
 * `yarn build` after Hugo: `yarn search-index [public dir]` (default
 * hugo/public).
 *
 * Hugo's search page writes <public>/search/manifest.json: the chapter and
 * translation pages, and every published transcript with its pages (see
 * layouts/search/list.html). Text comes from the published copies in the
 * same output (texts/<chapter>.json, data/v1/transcripts/, data/v1/outlines/),
 * so only what the site publishes is searchable. The manifest is deleted
 * once read.
 *
 * Records (all Pagefind language "en", one index; filter "in" is Text or
 * Classes). Each record's meta.parts is JSON [[href, time, text], …]: the
 * search page links the first part that matches and shows its text, so a
 * result points at one line, paragraph or topic while records stay few
 * (Pagefind writes a file per record, and Cloudflare Pages allows 20,000
 * files per deployment):
 * - a chapter section's own lines (href <chapter page>#<line id>);
 * - a section's English translation (the translation page);
 * - PARAGRAPHS_PER_RECORD transcript paragraphs (<transcript page>#t<N>,
 *   where play.js arms the player to start there); filter "teacher" is the
 *   series title;
 * - a class's outline topics (each its topic deep link on the class page).
 * Content is indexContent() of the parts' text (search/text.ts); the parts
 * keep the original text for display.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatTime } from '../hugo/assets/js/audio/model.ts';
import { indexContent } from '../hugo/assets/js/search/text.ts';

interface Manifest {
  chapters: { key: string; url: string; title: string }[];
  translations: { key: string; url: string; title: string }[];
  lectures: {
    id: string;
    title: string;
    series: string;
    headings: string[];
    transcriptUrl: string;
    partUrl: string;
    anchor: string;
  }[];
}

interface TextLine {
  id: string;
  text: string;
}
interface TextSection {
  label?: string;
  translation?: string;
  children: (TextLine | TextSection)[];
}

interface CustomRecord {
  url: string;
  content: string;
  language: string;
  meta: Record<string, string>;
  filters: Record<string, string[]>;
}
interface PagefindIndex {
  addCustomRecord(r: CustomRecord): Promise<{ errors: string[] }>;
  writeFiles(o: { outputPath: string }): Promise<{ errors: string[] }>;
}
interface PagefindApi {
  createIndex(config?: object): Promise<{ errors: string[]; index?: PagefindIndex }>;
  close(): Promise<unknown>;
}

const PARAGRAPHS_PER_RECORD = 3;

/** [href, time (or ""), text]: one linkable piece of a record. */
type Part = [string, string, string];

const isSection = (n: TextLine | TextSection): n is TextSection => 'children' in n;
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** Footnote digit markers are stripped from chapter text, as render-textnode.html does. */
const stripFootnotes = (s: string) => s.replace(/\d+/g, '');

async function main(): Promise<void> {
  const publicDir = resolve(process.argv[2] ?? 'hugo/public');
  const manifestPath = join(publicDir, 'search', 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} is missing: build the site with Hugo first`);
  const manifest = readJson<Manifest>(manifestPath);

  // A specifier in a variable: the compiled CommonJS keeps import(), which loads ESM-only pagefind.
  const pagefindModule = 'pagefind';
  const pagefind = (await import(pagefindModule)) as PagefindApi;
  const created = await pagefind.createIndex({});
  if (!created.index) throw new Error(`pagefind: ${created.errors.join('; ')}`);
  const index = created.index;

  const counts = { text: 0, translation: 0, class: 0, topic: 0 };
  const add = async (kind: keyof typeof counts, meta: Record<string, string>, filters: Record<string, string[]>, parts: Part[]) => {
    const first = parts[0];
    const content = indexContent(parts.map((p) => p[2]).join(' '));
    if (!first || content === '') return;
    const res = await index.addCustomRecord({
      url: first[0],
      content,
      language: 'en',
      meta: { ...meta, kind, parts: JSON.stringify(parts) },
      filters,
    });
    if (res.errors.length) throw new Error(`pagefind: ${first[0]}: ${res.errors.join('; ')}`);
    counts[kind]++;
  };

  for (const ch of manifest.chapters) {
    const walk = async (nodes: (TextLine | TextSection)[], labels: string[]) => {
      for (const n of nodes) {
        if (!isSection(n)) continue;
        const path = n.label ? [...labels, n.label] : labels;
        const lines = n.children.filter((c): c is TextLine => !isSection(c));
        if (lines.length) {
          await add(
            'text',
            { title: ch.title, context: path.join(' › ') },
            { in: ['Text'] },
            lines.map((l): Part => [`${ch.url}#${l.id}`, '', stripFootnotes(l.text)]),
          );
        }
        await walk(n.children, path);
      }
    };
    await walk(readJson<TextSection[]>(join(publicDir, 'texts', `${ch.key}.json`)), []);
  }

  for (const tr of manifest.translations) {
    const walk = async (nodes: (TextLine | TextSection)[]) => {
      for (const n of nodes) {
        if (!isSection(n)) continue;
        if (n.translation) {
          await add('translation', { title: `${tr.title} (translation)`, context: n.label ?? '' }, { in: ['Text'] }, [
            [tr.url, '', n.translation],
          ]);
        }
        await walk(n.children);
      }
    };
    await walk(readJson<TextSection[]>(join(publicDir, 'texts', `${tr.key}.json`)));
  }

  for (const l of manifest.lectures) {
    const context = [l.series, ...l.headings.filter((h) => h !== l.title)].join(' › ');
    const filters = { in: ['Classes'], teacher: [l.series] };
    const transcript = readJson<{ segments: { startSeconds: number; text: string }[] }>(
      join(publicDir, 'data', 'v1', 'transcripts', `${l.id}.json`),
    );
    const paras = transcript.segments.map((seg, i): Part => [`${l.transcriptUrl}#t${i}`, formatTime(seg.startSeconds), seg.text]);
    for (let i = 0; i < paras.length; i += PARAGRAPHS_PER_RECORD) {
      await add('class', { title: l.title, context }, filters, paras.slice(i, i + PARAGRAPHS_PER_RECORD));
    }
    const outlinePath = join(publicDir, 'data', 'v1', 'outlines', `${l.id}.json`);
    if (!existsSync(outlinePath)) continue;
    const topics = readJson<{ topics: { title: string; startSeconds: number }[] }>(outlinePath).topics;
    await add(
      'topic',
      { title: l.title, context },
      filters,
      topics.map((t): Part => [`${l.partUrl}?t=${Math.floor(t.startSeconds)}#${l.anchor}`, formatTime(t.startSeconds), t.title]),
    );
  }

  const written = await index.writeFiles({ outputPath: join(publicDir, 'pagefind') });
  if (written.errors.length) throw new Error(`pagefind: ${written.errors.join('; ')}`);
  await pagefind.close();
  rmSync(manifestPath);
  console.log(
    `Search index: ${counts.text} text sections, ${counts.translation} translated sections, ` +
      `${counts.class} transcript records, ${counts.topic} class outlines → ${join(publicDir, 'pagefind')}`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
