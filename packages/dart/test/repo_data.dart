import 'dart:io';

/// `data/` at the repo root (tests run with the package as cwd).
final Directory dataDir = Directory('../../data');

/// `data/dist/v1`, produced by `cd data/tools && yarn build-data`.
Directory requireDist() {
  final dist = Directory('${dataDir.path}/dist/v1');
  if (!File('${dist.path}/catalog.json').existsSync()) {
    throw StateError(
      'data/dist/v1 is missing. Build it first: '
      'cd data/tools && yarn install && yarn build-data',
    );
  }
  return dist;
}

String rel(FileSystemEntity f, Directory base) =>
    f.path.substring(base.path.length + 1).replaceAll(r'\', '/');
