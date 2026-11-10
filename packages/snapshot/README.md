# shaar_hayichud_snapshot

A snapshot of the Shaar Hayichud data that
`https://www.shaarhayichudresources.com/data/v1/` publishes, bundled as
Flutter assets so an app shows the text and its classes offline from the
first launch:

- `catalog.json`: the audio class catalog
- `chapters/chapter_NN.json`: the chapter text
- `alignments/chapters/chapter_NN.json`: which classes read each line
- `snapshot.txt`: `<version> <git sha> <UTC time>`, identifying the snapshot

Parse the files with
[`shaar_hayichud_data`](https://pub.dev/packages/shaar_hayichud_data). This
package has no code beyond the asset paths and no Flutter dependency; a
Flutter app that depends on it bundles its assets.

## Use

```yaml
dependencies:
  shaar_hayichud_data: ^1.5.0
  shaar_hayichud_snapshot: ^1.20261110.0
```

```dart
import 'package:flutter/services.dart';
import 'package:shaar_hayichud_data/shaar_hayichud_data.dart';
import 'package:shaar_hayichud_snapshot/shaar_hayichud_snapshot.dart';

final catalog = parseCatalog(
  await rootBundle.loadString(snapshotAsset('catalog.json')),
);
final chapter = parseChapter(
  await rootBundle.loadString(snapshotAsset('chapters/chapter_01.json')),
);
```

Fetch the live data in the background and keep the snapshot as the fallback
(`parseCatalogWithFallback`).

## Versions

`1.<YYYYMMDD>.<n>`: the major version is the `/data/v1` schema version, the
minor is the date the snapshot was cut. Any `^1.x` constraint accepts newer
content; the app's `pubspec.lock` pins the snapshot it ships, and
`dart pub upgrade shaar_hayichud_snapshot` moves to the latest.

Each version is built from the commit tagged
`shaar_hayichud_snapshot-v<version>` in
[shaar-hayichud-sections](https://github.com/yringler/shaar-hayichud-sections).

## Cutting a snapshot

On a `master` commit whose data build is green (after the re-align bot has
pushed, if chapters changed):

```bash
git tag shaar_hayichud_snapshot-v1.20261110.0 <commit>
git push origin shaar_hayichud_snapshot-v1.20261110.0
```

`.github/workflows/publish-snapshot.yml` builds the data, writes `data/v1/`
and publishes. Push the tag yourself: tags pushed by a workflow's
`GITHUB_TOKEN` do not start workflows.

## Development

`data/` is generated and git-ignored:

```bash
(cd ../../data/tools && yarn install && yarn build-data)
dart pub get
dart run tool/build_snapshot.dart
dart analyze
dart test
```

An app can use this checkout with a git-ignored `pubspec_overrides.yaml`
(`dependency_overrides: {shaar_hayichud_snapshot: {path: ...}}`) after
building `data/`.
