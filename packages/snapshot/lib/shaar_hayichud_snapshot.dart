/// A bundled snapshot of the Shaar Hayichud `/data/v1/` data, as Flutter
/// assets of this package.
///
/// Load a file with `rootBundle.loadString(snapshotAsset('catalog.json'))`.
/// Parse it with `package:shaar_hayichud_data`.
library;

/// This package's name, which prefixes its asset keys.
const snapshotPackage = 'shaar_hayichud_snapshot';

/// The asset key of [path], a path relative to `/data/v1/` as published
/// (`catalog.json`, `chapters/chapter_01.json`,
/// `alignments/chapters/chapter_01.json`, `snapshot.txt`).
String snapshotAsset(String path) => 'packages/$snapshotPackage/data/v1/$path';

/// The files this snapshot holds, relative to `/data/v1/`. Chapters and
/// chapter alignments are directories of `chapter_NN.json` files.
const snapshotFiles = [
  'catalog.json',
  'snapshot.txt',
  'chapters/',
  'alignments/chapters/',
];
