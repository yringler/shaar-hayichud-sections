// Loads every published file and every chapter source file, decodes it with
// the generated models and re-encodes it. Any drift between the schemas, the
// data and the models shows up as a decode error or a toJson mismatch.
import 'dart:convert';
import 'dart:io';

import 'package:shaar_hayichud_data/shaar_hayichud_data.dart';
import 'package:test/test.dart';

import 'repo_data.dart';

Object? roundTrip(String path, String source) {
  final p = path.replaceAll(r'\', '/');
  if (p == 'catalog.json') return parseCatalog(source).toJson();
  if (p == 'study/index.json' || p == 'study/index-advanced.json') {
    return parseStudyIndex(source).toJson();
  }
  if (p.startsWith('study/')) return parseStudyGuide(source).toJson();
  if (p.endsWith('index.json')) return parseIndexListing(source).toJson();
  if (p.startsWith('alignments/chapters/')) {
    return parseChapterAlignments(source).toJson();
  }
  if (RegExp(r'(^|/)chapter_\d+\.json$').hasMatch(p)) {
    return chapterToJson(parseChapter(source));
  }
  if (p.startsWith('alignments/')) return parseAlignment(source).toJson();
  if (p.startsWith('outlines/')) return parseOutline(source).toJson();
  throw StateError('No model for published file $p');
}

void main() {
  group('dist/v1', () {
    final dist = requireDist();
    final files =
        dist
            .listSync(recursive: true)
            .whereType<File>()
            .where((f) => f.path.endsWith('.json'))
            .where((f) => !rel(f, dist).startsWith('schema/'))
            .toList()
          ..sort((a, b) => a.path.compareTo(b.path));

    test('has the expected files', () {
      final names = files.map((f) => rel(f, dist)).toSet();
      expect(
        names,
        containsAll([
          'index.json',
          'catalog.json',
          'chapters/index.json',
          'alignments/index.json',
          'outlines/index.json',
          'study/index.json',
          'study/index-advanced.json',
        ]),
      );
      // Transcripts are no longer published.
      expect(names.where((n) => n.startsWith('transcripts/')), isEmpty);
      expect(names.where((n) => n.startsWith('chapters/chapter_')).length, 54);
    });

    for (final f in files) {
      final path = rel(f, dist);
      test('round-trips $path', () {
        final source = f.readAsStringSync();
        expect(roundTrip(path, source), equals(jsonDecode(source)));
      });
    }

    test('every study guide either study index lists exists', () {
      final public = parseStudyIndex(
        File('${dist.path}/study/index.json').readAsStringSync(),
      );
      final advanced = parseStudyIndex(
        File('${dist.path}/study/index-advanced.json').readAsStringSync(),
      );
      // A series is in one listing or the other.
      expect(
        public.series
            .map((s) => s.id)
            .toSet()
            .intersection(advanced.series.map((s) => s.id).toSet()),
        isEmpty,
      );
      expect(advanced.series.map((s) => s.id), contains('markel-advanced'));
      for (final series in [...public.series, ...advanced.series]) {
        for (final ch in series.chapters) {
          final guide = parseStudyGuide(
            File('${dist.path}/${ch.path}').readAsStringSync(),
          );
          expect(guide.series, series.id);
          expect(guide.chapter, ch.chapter);
          expect(
            DataUrls().studyGuide(series.id, ch.chapter),
            DataUrls().resolve(ch.path),
          );
        }
      }
    });

    test('every index entry resolves to a file', () {
      for (final f in files.where(
        (f) =>
            f.path.endsWith('index.json') &&
            !rel(f, dist).startsWith('study/index'),
      )) {
        final listing = parseIndexListing(f.readAsStringSync());
        for (final item in listing.items) {
          expect(
            // `path` is a URL path; the file has the decoded name.
            File(
              '${dist.path}/${item.path.split('/').map(Uri.decodeComponent).join('/')}',
            ).existsSync(),
            isTrue,
            reason: '${rel(f, dist)} lists ${item.path}',
          );
          if (item.schema != null) {
            expect(File('${dist.path}/${item.schema}').existsSync(), isTrue);
          }
        }
      }
    });
  });

  group('data/chapters (source)', () {
    final dir = Directory('${dataDir.path}/chapters');
    final files =
        dir
            .listSync()
            .whereType<File>()
            .where((f) => f.path.endsWith('.json'))
            .toList()
          ..sort((a, b) => a.path.compareTo(b.path));

    test('has 54 chapters', () => expect(files, hasLength(54)));

    for (final f in files) {
      final path = rel(f, dir);
      test('round-trips $path', () {
        final source = f.readAsStringSync();
        expect(chapterToJson(parseChapter(source)), equals(jsonDecode(source)));
      });
    }
  });
}
