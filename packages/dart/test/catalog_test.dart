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
    expect(catalog.series.map((s) => s.id), ['0', '37', '75', '73']);
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
}
