import 'dart:convert';
import 'dart:io';

import 'package:shaar_hayichud_snapshot/shaar_hayichud_snapshot.dart';
import 'package:test/test.dart';

// Run `dart run tool/build_snapshot.dart` first.
void main() {
  final root = Directory('data/v1');

  test('asset keys are package-prefixed', () {
    expect(
      snapshotAsset('chapters/chapter_01.json'),
      'packages/shaar_hayichud_snapshot/data/v1/chapters/chapter_01.json',
    );
  });

  test('the built snapshot holds every declared asset', () {
    expect(
      root.existsSync(),
      isTrue,
      reason: 'run dart run tool/build_snapshot.dart',
    );
    for (final path in snapshotFiles) {
      if (path.endsWith('/')) {
        final files = Directory('${root.path}/$path').listSync();
        expect(files, isNotEmpty, reason: path);
        for (final f in files.whereType<File>()) {
          expect(() => jsonDecode(f.readAsStringSync()), returnsNormally);
        }
      } else {
        expect(File('${root.path}/$path').existsSync(), isTrue, reason: path);
      }
    }
    final catalog =
        jsonDecode(File('${root.path}/catalog.json').readAsStringSync()) as Map;
    expect(catalog['schemaVersion'], 1);
  });

  test('pubspec declares the same assets', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    for (final path in snapshotFiles) {
      expect(pubspec, contains('- data/v1/$path'));
    }
  });
}
