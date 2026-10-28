/**
 * Turns a parsed classes.txt into the published catalog shape
 * (data/schema/v1/catalog.schema.json).
 */
import type { Level, ParsedLecture, ParsedSection } from './parse.js';

export const DEFAULT_CDN_BASE = 'https://media.shaarhayichudresources.com';

export interface CatalogLecture {
  type: 'lecture';
  id: string;
  title: string;
  displayOrder: number;
  durationSeconds: number | null;
  folder: string;
  filename: string;
  mediaType: 'audio/mpeg' | 'audio/mp4';
  url: string;
}

export interface CatalogSection {
  type: 'section';
  id: string;
  level: Level;
  title: string;
  displayOrder: number;
  lectureCount: number;
  items: CatalogItem[];
}

export type CatalogItem = CatalogSection | CatalogLecture;

export interface Catalog {
  schemaVersion: 1;
  cdnBase: string;
  series: CatalogSection[];
}

/**
 * The one canonical URL for a CDN file: every folder segment and the filename
 * are encoded with encodeURIComponent and joined with '/'.
 */
export function buildMediaUrl(cdnBase: string, folder: string, filename: string): string {
  const path = [...folder.split('/'), filename].map((s) => encodeURIComponent(s)).join('/');
  return `${cdnBase.replace(/\/+$/, '')}/${path}`;
}

export function mediaTypeFor(filename: string): CatalogLecture['mediaType'] {
  return /\.m4a$/i.test(filename) ? 'audio/mp4' : 'audio/mpeg';
}

/**
 * Builds the catalog. Lectures without a folder are skipped here (validation
 * reports them), so callers must check validation errors first.
 */
export function buildCatalog(series: ParsedSection[], cdnBase = DEFAULT_CDN_BASE): Catalog {
  return {
    schemaVersion: 1,
    cdnBase: cdnBase.replace(/\/+$/, ''),
    series: series.map((s, i) => convertSection(s, i, cdnBase)),
  };
}

function convertSection(section: ParsedSection, displayOrder: number, cdnBase: string): CatalogSection {
  const items: CatalogItem[] = [];
  let lectureIndex = 0;
  let lectureCount = 0;
  for (const item of section.items) {
    const order = items.length;
    if (item.kind === 'section') {
      const child = convertSection(item, order, cdnBase);
      lectureCount += child.lectureCount;
      items.push(child);
    } else {
      lectureIndex += 1;
      const lecture = convertLecture(item, order, lectureIndex, cdnBase);
      if (lecture) {
        lectureCount += 1;
        items.push(lecture);
      }
    }
  }
  return {
    type: 'section',
    id: section.id,
    level: section.level,
    title: section.title,
    displayOrder,
    lectureCount,
    items,
  };
}

function convertLecture(
  lecture: ParsedLecture,
  displayOrder: number,
  positionInParent: number,
  cdnBase: string,
): CatalogLecture | null {
  if (lecture.folder === null) return null;
  return {
    type: 'lecture',
    id: lecture.id,
    title: lecture.title ?? `Part ${positionInParent}`,
    displayOrder,
    durationSeconds: lecture.durationSeconds,
    folder: lecture.folder,
    filename: lecture.filename,
    mediaType: mediaTypeFor(lecture.filename),
    url: buildMediaUrl(cdnBase, lecture.folder, lecture.filename),
  };
}

/** Depth-first walk over every lecture in the catalog, in display order. */
export function* catalogLectures(items: CatalogItem[]): Generator<CatalogLecture> {
  for (const item of items) {
    if (item.type === 'lecture') yield item;
    else yield* catalogLectures(item.items);
  }
}
