// Sets `version:` in pubspec.yaml (used by the publish workflow, which takes
// the version from the git tag).
//
//   dart run tool/set_version.dart 1.20261110.0
import 'dart:io';

void main(List<String> args) {
  if (args.length != 1 ||
      !RegExp(r'^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$').hasMatch(args.first)) {
    stderr.writeln('usage: dart run tool/set_version.dart <semver>');
    exit(64);
  }
  final file = File.fromUri(Platform.script.resolve('../pubspec.yaml'));
  final pubspec = file.readAsStringSync();
  final pattern = RegExp(r'^version:.*$', multiLine: true);
  if (!pattern.hasMatch(pubspec)) {
    stderr.writeln('No version line in ${file.path}');
    exit(1);
  }
  file.writeAsStringSync(
    pubspec.replaceFirst(pattern, 'version: ${args.first}'),
  );
}
