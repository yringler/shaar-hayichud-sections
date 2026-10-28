import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCatalog, buildMediaUrl, catalogLectures, type CatalogSection } from './catalog.js';
import { parseClassesTxt } from './parse.js';

describe('buildMediaUrl', () => {
  it('encodes each folder segment and the filename, keeping "/" separators', () => {
    assert.equal(
      buildMediaUrl('https://cdn.example/', 'Markel Seminar/Advanced  part 1', '014 Ch15&16.mp3'),
      'https://cdn.example/Markel%20Seminar/Advanced%20%20part%201/014%20Ch15%2616.mp3',
    );
  });
});

describe('buildCatalog', () => {
  const parsed = parseClassesTxt(
    ['# S:1', '> F', '- Intro', 'a.mp3:10', '### Sub:2', 'b.m4a', 'c.mp3', '###', 'd.mp3', '## P:3', 'e.mp3'].join('\n'),
  );
  const catalog = buildCatalog(parsed.series, 'https://cdn.example');

  it('assigns sibling display order and counts lectures recursively', () => {
    const s = catalog.series[0]!;
    assert.equal(s.lectureCount, 5);
    assert.deepEqual(
      s.items.map((i) => [i.id, i.displayOrder]),
      [['a.mp3', 0], ['2', 1], ['d.mp3', 2], ['3', 3]],
    );
    assert.equal((s.items[1] as CatalogSection).lectureCount, 2);
  });

  it('defaults titles to "Part N" counted among the parent\'s lectures', () => {
    const titles = [...catalogLectures(catalog.series)].map((l) => [l.id, l.title]);
    assert.deepEqual(titles, [
      ['a.mp3', 'Intro'],
      ['b.m4a', 'Part 1'],
      ['c.mp3', 'Part 2'],
      ['d.mp3', 'Part 2'],
      ['e.mp3', 'Part 1'],
    ]);
  });

  it('fills media fields', () => {
    const b = [...catalogLectures(catalog.series)][1]!;
    assert.deepEqual(b, {
      type: 'lecture',
      id: 'b.m4a',
      title: 'Part 1',
      displayOrder: 0,
      durationSeconds: null,
      folder: 'F',
      filename: 'b.m4a',
      mediaType: 'audio/mp4',
      url: 'https://cdn.example/F/b.m4a',
    });
  });
});
