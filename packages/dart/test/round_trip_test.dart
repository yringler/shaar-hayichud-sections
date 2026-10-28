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
  if (p.endsWith('index.json')) return parseIndexListing(source).toJson();
  if (p.startsWith('alignments/chapters/')) {
    return parseChapterAlignments(source).toJson();
  }
  if (RegExp(r'(^|/)chapter_\d+\.json$').hasMatch(p)) {
    return chapterToJson(parseChapter(source));
  }
  if (p.startsWith('alignments/')) return parseAlignment(source).toJson();
  if (p.startsWith('transcripts/')) return parseTranscript(source).toJson();
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
          'transcripts/index.json',
        ]),
      );
      expect(names.where((n) => n.startsWith('chapters/chapter_')).length, 54);
    });

    for (final f in files) {
      final path = rel(f, dist);
      test('round-trips $path', () {
        final source = f.readAsStringSync();
        expect(roundTrip(path, source), equals(jsonDecode(source)));
      });
    }

    test('every index entry resolves to a file', () {
      for (final f in files.where((f) => f.path.endsWith('index.json'))) {
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
