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
    test('keeps text and nodes interleaved', () {
      const source =
          '[{"label":"1","children":["a",{"children":["b"],"translation":"B"},"c"]}]';
      final chapter = parseChapter(source);
      final node = chapter.single;
      expect(node.label, '1');
      expect(node.children[0], const TextFragment('a'));
      expect(node.children[1], isA<TextNode>());
      expect(node.plainText, 'abc');
      expect(jsonEncode(chapterToJson(chapter)), source);
    });

    test('rejects a non-array', () {
      expect(() => parseChapter('{}'), throwsFormatException);
    });
  });

  group('reserved shapes', () {
    test('alignment', () {
      final json = {
        'schemaVersion': 1,
        'lectureId': 'a.mp3',
        'segments': [
          {
            'startSeconds': 0,
            'endSeconds': 1.5,
            'chapter': 'chapter_01',
            'nodeId': 'n1',
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
  });
}
