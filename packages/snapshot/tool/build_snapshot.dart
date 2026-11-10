// Writes data/v1/ from the repo's data build (data/dist/v1), the files this
// package publishes as assets. Run `yarn build-data` in data/tools first.
//
//   dart run tool/build_snapshot.dart [version]
//
// data/v1/snapshot.txt identifies the snapshot as "<version> <git sha>
// <UTC time>"; apps drop network copies they cached under a different one.
// The version defaults to the one in pubspec.yaml.
import 'dart:io';

final packageDir = File.fromUri(Platform.script).parent.parent;

void main(List<String> args) {
  final dist = Directory('${packageDir.path}/../../data/dist/v1').absolute;
  if (!File('${dist.path}/catalog.json').existsSync()) {
    stderr.writeln(
      '${dist.path}/catalog.json is missing. Build it first: '
      'cd data/tools && yarn install && yarn build-data',
    );
    exit(1);
  }

  final out = Directory('${packageDir.path}/data/v1');
  if (out.existsSync()) out.deleteSync(recursive: true);
  out.createSync(recursive: true);

  File('${dist.path}/catalog.json').copySync('${out.path}/catalog.json');
  var count = 1;
  for (final sub in ['chapters', 'alignments/chapters']) {
    final target = Directory('${out.path}/$sub')..createSync(recursive: true);
    final files =
        Directory('${dist.path}/$sub')
            .listSync()
            .whereType<File>()
            .where((f) => f.path.endsWith('.json'))
            .toList()
          ..sort((a, b) => a.path.compareTo(b.path));
    if (files.isEmpty) {
      stderr.writeln('No JSON files in ${dist.path}/$sub');
      exit(1);
    }
    for (final f in files) {
      f.copySync('${target.path}/${f.uri.pathSegments.last}');
    }
    count += files.length;
  }

  final version = args.isNotEmpty ? args.first : pubspecVersion();
  final sha = Process.runSync('git', [
    'rev-parse',
    '--short',
    'HEAD',
  ], workingDirectory: packageDir.path);
  final rev = sha.exitCode == 0 ? (sha.stdout as String).trim() : 'unknown';
  final now = DateTime.now().toUtc().toIso8601String().split('.').first;
  File('${out.path}/snapshot.txt').writeAsStringSync('$version $rev ${now}Z\n');

  stdout.writeln('Wrote $count files and snapshot.txt to ${out.path}');
}

String pubspecVersion() {
  final pubspec = File('${packageDir.path}/pubspec.yaml').readAsStringSync();
  final match = RegExp(
    r'^version:\s*(\S+)',
    multiLine: true,
  ).firstMatch(pubspec);
  if (match == null) throw StateError('No version in pubspec.yaml');
  return match.group(1)!;
}
