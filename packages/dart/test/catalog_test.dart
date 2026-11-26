import 'dart:convert';
import 'dart:io';

import 'package:shaar_hayichud_data/shaar_hayichud_data.dart';
import 'package:test/test.dart';

import 'repo_data.dart';

void main() {
  final catalog = parseCatalog(
    File('${requireDist().path}/catalog.json').readAsStringSync(),
  );

  test('cdnBase is the default CDN', () {
    expect(catalog.cdnBase, defaultCdnBase);
  });

  test('series ids and order are stable', () {
    // Ids are persisted by clients and must never change. The unedited 2020
    // series (75, 73) are extra, and come last so apps that predate the flag
    // list them after the edited copies (90, 102).
    expect(catalog.series.map((s) => s.id), [
      '0',
      '37',
      '90',
      '102',
      '104',
      '75',
      '73',
    ]);
  });

  test('the unedited 2020 series are extra, and only they are marked', () {
    expect(catalog.series.where((s) => s.isExtra).map((s) => s.id), [
      '75',
      '73',
    ]);
    final marked = [
      ...catalog.allSections.where((s) => s.isExtra).map((s) => s.id),
      ...catalog.allLectures.where((l) => l.isExtra).map((l) => l.id),
    ];
    expect(marked, ['75', '73']);
    final effective = catalog.effectivelyExtraIds();
    for (final s in catalog.series) {
      final under = {s.id, ...s.allSections.map((x) => x.id)}
        ..addAll(s.allLectures.map((l) => l.id));
      for (final id in under) {
        expect(effective.contains(id), s.isExtra, reason: id);
        expect(catalog.isEffectivelyExtra(id), s.isExtra, reason: id);
      }
    }
  });

  test('ids are unique across sections and lectures', () {
    final ids = [
      ...catalog.allSections.map((s) => s.id),
      ...catalog.allLectures.map((l) => l.id),
    ];
    expect(ids.toSet(), hasLength(ids.length));
    expect(catalog.indexById(), hasLength(ids.length));
  });

  test('buildMediaUrl reproduces every catalog url', () {
    for (final l in catalog.allLectures) {
      expect(
        buildMediaUrl(catalog.cdnBase, l.folder, l.filename),
        l.url,
        reason: l.id,
      );
    }
  });

  test('lectureCount matches the tree', () {
    for (final s in catalog.allSections) {
      expect(s.allLectures.length, s.lectureCount, reason: s.id);
    }
  });

  test('displayOrder is the index among siblings', () {
    for (final s in catalog.allSections) {
      for (var i = 0; i < s.items.length; i++) {
        expect(s.items[i].displayOrder, i);
      }
    }
  });

  test('lecture helpers', () {
    final first = catalog.allLectures.first;
    expect(first.id, '01 - Introduction-1.mp3');
    expect(first.mediaType, MediaType.audioMpeg);
    expect(first.uri.host, 'media.shaarhayichudresources.com');
    expect(first.duration, isNotNull);
  });

  group('extra flag (synthetic catalog)', () {
    Map<String, Object?> lecture(String id, {bool? extra}) => {
      'type': 'lecture',
      'id': id,
      'title': id,
      'displayOrder': 0,
      'extra': ?extra,
      'durationSeconds': null,
      'folder': 'F',
      'filename': '$id.mp3',
      'mediaType': 'audio/mpeg',
      'url': '$defaultCdnBase/F/$id.mp3',
    };
    Map<String, Object?> section(
      String id,
      int level,
      List<Map<String, Object?>> items, {
      bool? extra,
    }) => {
      'type': 'section',
      'id': id,
      'level': level,
      'title': 'S$id',
      'extra': ?extra,
      'displayOrder': 0,
      'lectureCount': 0,
      'items': items,
    };
    final json = {
      'schemaVersion': 1,
      'cdnBase': defaultCdnBase,
      'series': [
        section('1', 1, [lecture('a')]),
        section('2', 1, [
          section('3', 2, [lecture('b')]),
          lecture('c'),
        ], extra: true),
        section('4', 1, [
          section('5', 2, [lecture('d')], extra: true),
          lecture('e', extra: true),
          lecture('f'),
        ]),
      ],
    };
    final parsed = parseCatalog(jsonEncode(json));

    test('present: isExtra on the marked node only', () {
      final byId = parsed.indexById();
      expect(byId['2']!.isExtra, isTrue);
      expect(byId['2']!.extra, isTrue);
      expect(byId['5']!.isExtra, isTrue);
      expect(byId['e']!.isExtra, isTrue);
      expect(byId['3']!.isExtra, isFalse);
      expect(byId['c']!.isExtra, isFalse);
    });

    test('absent: null, and isExtra is false', () {
      final byId = parsed.indexById();
      expect(byId['1']!.extra, isNull);
      expect(byId['1']!.isExtra, isFalse);
      expect(byId['a']!.extra, isNull);
      expect(byId['a']!.isExtra, isFalse);
      final unmarked = parseCatalog(
        jsonEncode({
          ...json,
          'series': [
            section('9', 1, [lecture('z')]),
          ],
        }),
      );
      expect(unmarked.effectivelyExtraIds(), isEmpty);
    });

    test('effectively extra: the node or an ancestor is marked', () {
      expect(parsed.effectivelyExtraIds(), {'2', '3', 'b', 'c', '5', 'd', 'e'});
      for (final id in ['2', '3', 'b', 'c', '5', 'd', 'e']) {
        expect(parsed.isEffectivelyExtra(id), isTrue, reason: id);
      }
      for (final id in ['1', 'a', '4', 'f', 'not-an-id']) {
        expect(parsed.isEffectivelyExtra(id), isFalse, reason: id);
      }
    });

    test('round trip keeps extra where present and omits it elsewhere', () {
      expect(parsed.toJson(), json);
    });

    test('rejects a non-boolean extra', () {
      final bad = {
        ...json,
        'series': [section('1', 1, [])..['extra'] = 'yes'],
      };
      expect(() => parseCatalog(jsonEncode(bad)), throwsFormatException);
    });
  });

  test('published catalog.json round-trips its extra keys', () {
    final source =
        jsonDecode(
              File('${requireDist().path}/catalog.json').readAsStringSync(),
            )
            as Map<String, Object?>;
    final marked = <String>[];
    void visit(Object? node) {
      if (node is Map) {
        if (node.containsKey('extra')) {
          expect(node['extra'], isTrue);
          marked.add(node['id'] as String);
        }
        node.values.forEach(visit);
      } else if (node is List) {
        node.forEach(visit);
      }
    }

    visit(source);
    expect(marked, ['75', '73']);
    expect(catalog.toJson(), source);
  });
}
