import 'dart:convert';

import 'package:shaar_hayichud_data/shaar_hayichud_data.dart';
import 'package:test/test.dart';

const lecture = {
  'type': 'lecture',
  'id': 'a.mp3',
  'title': 'Part 1',
  'displayOrder': 0,
  'durationSeconds': 600,
  'folder': 'Some folder/sub',
  'filename': 'a.mp3',
  'mediaType': 'audio/mpeg',
  'url': 'https://media.example/Some%20folder/sub/a.mp3',
};

Map<String, Object?> catalogJson({Object? schemaVersion = 1}) => {
  'schemaVersion': schemaVersion,
  'cdnBase': 'https://media.example',
  'series': [
    {
      'type': 'section',
      'id': '0',
      'level': 1,
      'title': 'Series',
      'displayOrder': 0,
      'lectureCount': 1,
      'items': [lecture],
    },
  ],
};

void main() {
  group('parseCatalog', () {
    test('parses and re-encodes', () {
      final c = parseCatalog(jsonEncode(catalogJson()));
      final l = c.allLectures.single;
      expect(l.durationSeconds, 600.0);
      expect(l.duration, const Duration(minutes: 10));
      expect(c.toJson(), equals(catalogJson()));
    });

    test('accepts a BOM', () {
      expect(
        parseCatalog('﻿${jsonEncode(catalogJson())}').series,
        hasLength(1),
      );
    });

    test('rejects another schemaVersion', () {
      expect(
        () => parseCatalog(jsonEncode(catalogJson(schemaVersion: 2))),
        throwsFormatException,
      );
    });

    test('rejects a missing required key', () {
      final json = catalogJson();
      ((json['series']! as List).single as Map).remove('lectureCount');
      expect(() => parseCatalog(jsonEncode(json)), throwsFormatException);
    });

    test('rejects an unknown item type', () {
      final json = catalogJson();
      ((json['series']! as List).single as Map)['items'] = [
        {...lecture, 'type': 'video'},
      ];
      expect(() => parseCatalog(jsonEncode(json)), throwsFormatException);
    });

    test('rejects an unknown mediaType', () {
      final json = catalogJson();
      ((json['series']! as List).single as Map)['items'] = [
        {...lecture, 'mediaType': 'audio/ogg'},
      ];
      expect(() => parseCatalog(jsonEncode(json)), throwsFormatException);
    });

    test('ignores unknown keys (forward compatible)', () {
      final json = {...catalogJson(), 'newField': true};
      expect(parseCatalog(jsonEncode(json)).series, hasLength(1));
    });

    test('models have value equality', () {
      final a = parseCatalog(jsonEncode(catalogJson()));
      final b = parseCatalog(jsonEncode(catalogJson()));
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });
  });

  group('parseCatalogWithFallback', () {
    final bundled = jsonEncode(catalogJson());
    final fresh = jsonEncode({...catalogJson(), 'cdnBase': 'https://fresh'});

    test('prefers the fetched catalog', () {
      expect(
        parseCatalogWithFallback(fetched: fresh, bundled: bundled).cdnBase,
        'https://fresh',
      );
    });

    test(
      'falls back when fetched is null, invalid JSON or a newer version',
      () {
        for (final fetched in [
          null,
          '{not json',
          jsonEncode(catalogJson(schemaVersion: 2)),
        ]) {
          expect(
            parseCatalogWithFallback(
              fetched: fetched,
              bundled: bundled,
            ).cdnBase,
            'https://media.example',
          );
        }
      },
    );
  });

  group('parseChapter', () {
    test('keeps lines and nodes interleaved', () {
      const source =
          '[{"label":"1","children":[{"id":"aaaaaaaa","text":"a"},'
          '{"children":[{"id":"bbbbbbbb","text":"b"}],"translation":"B"},'
          '{"id":"cccccccc","text":"c"}]}]';
      final chapter = parseChapter(source);
      final node = chapter.single;
      expect(node.label, '1');
      expect(node.children[0], const TextLine(id: 'aaaaaaaa', text: 'a'));
      expect(node.children[1], isA<TextNode>());
      expect(node.plainText, 'a\nb\nc');
      expect(chapter.allLines.map((l) => l.id), [
        'aaaaaaaa',
        'bbbbbbbb',
        'cccccccc',
      ]);
      expect(chapter.indexLines()['bbbbbbbb']!.text, 'b');
      expect(jsonEncode(chapterToJson(chapter)), source);
    });

    test('rejects plain-string children and unknown child shapes', () {
      expect(() => parseChapter('[{"children":["a"]}]'), throwsFormatException);
      expect(
        () => parseChapter('[{"children":[{"label":"x"}]}]'),
        throwsFormatException,
      );
    });

    test('rejects a non-array', () {
      expect(() => parseChapter('{}'), throwsFormatException);
    });
  });

  group('audio shapes', () {
    test('alignment', () {
      final json = {
        'schemaVersion': 1,
        'lectureId': 'a.mp3',
        'segments': [
          {
            'startSeconds': 0,
            'endSeconds': 1.5,
            'chapter': 'chapter_01',
            'lineId': 'abcdefgh',
          },
        ],
      };
      final a = parseAlignment(jsonEncode(json));
      expect(a.segments.single.endSeconds, 1.5);
      expect(a.toJson(), equals(json));
    });

    test('transcript', () {
      final json = {
        'schemaVersion': 1,
        'lectureId': 'a.mp3',
        'language': 'en',
        'segments': [
          {'startSeconds': 0, 'endSeconds': 2, 'text': 'Hi', 'speaker': 'R'},
        ],
      };
      expect(parseTranscript(jsonEncode(json)).toJson(), equals(json));
    });

    test('outline', () {
      final json = {
        'schemaVersion': 1,
        'lectureId': 'a.mp3',
        'generatedBy': 'sofer.ai',
        'topics': [
          {'title': 'Intro', 'startSeconds': 3, 'confidence': 'HIGH'},
        ],
      };
      final o = parseOutline(jsonEncode(json));
      expect(o.topics.single.title, 'Intro');
      expect(o.toJson(), equals(json));
    });

    test('chapter alignments', () {
      final json = {
        'schemaVersion': 1,
        'chapter': 'chapter_10',
        'lectures': [
          {
            'id': 'a.mp3',
            'url': 'https://media.example/a.mp3',
            'title': 'Part 1',
            'seriesId': '0',
            'series': 'S',
            'part': 'Chapter 10',
            'durationSeconds': null,
            'alignment': 'alignments/a.mp3.json',
          },
        ],
        'lines': [
          {
            'lineId': 'abcdefgh',
            'refs': [
              {
                'lecture': 0,
                'startSeconds': 1,
                'endSeconds': 2,
                'confidence': 0.9,
              },
            ],
          },
        ],
      };
      final c = parseChapterAlignments(jsonEncode(json));
      expect(c.lines.single.refs.single.confidence, 0.9);
      expect(c.lectures.single.transcript, isNull);
      expect(c.toJson(), equals(json));
    });
  });
}
