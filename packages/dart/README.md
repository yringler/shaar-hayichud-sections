# shaar_hayichud_data

Pure Dart models and a small loader for the data this repo publishes at
`https://www.shaarhayichudresources.com/data/v1/`: the audio class catalog,
the chapter text (`TextNode` trees), and the class alignments and
transcripts. No Flutter dependency, so it works in apps, CLIs and servers.

## Install

```yaml
dependencies:
  shaar_hayichud_data: ^1.5.0
```

## Use

```dart
import 'package:http/http.dart' as http;
import 'package:shaar_hayichud_data/shaar_hayichud_data.dart';

const urls = DataUrls(); // or DataUrls(siteBase: 'https://<preview>.pages.dev')

final catalog = parseCatalog((await http.get(urls.catalog)).body);
for (final lecture in catalog.allLectures) {
  print('${lecture.id}  ${lecture.url}  ${lecture.duration}');
}

final chapter = parseChapter((await http.get(urls.chapter(1))).body);
for (final line in chapter.allLines) {
  print('${line.id}  ${line.text}');
}
```

`CatalogItem` (section or lecture) and `TextNodeChild` (`TextLine` or
`TextNode`) are sealed, so `switch` on them is exhaustive.

Chapter text is made of `TextLine`s, each with a stable `id` that is unique
across all chapters and survives edits to the line. Alignments and transcripts
point at lines by that id alone; sections have no id.

Parsing throws `FormatException` when the JSON does not match the v1 schema
(including a different `schemaVersion`). Unknown keys are ignored, so a client
keeps working when fields are added within v1.

**IDs are persistent.** Catalog section and lecture `id`s are what apps store
for favorites, recents and downloads, and line ids are what alignments point
at. They never change once published; see
[`data/README.md`](../../data/README.md).

**Use `lecture.url` as-is.** `buildMediaUrl` reproduces it (and is tested to
for every lecture) but only exists for files outside the catalog.

## Bundling a snapshot

Apps should ship a copy of the data so they work offline and on first launch.
Flutter apps can depend on
[`shaar_hayichud_snapshot`](https://pub.dev/packages/shaar_hayichud_snapshot),
which bundles `catalog.json`, the chapters and the chapter alignments as
assets, pinned by the app's `pubspec.lock`. At runtime, fetch the latest
catalog and fall back to the bundled copy:

```dart
import 'package:shaar_hayichud_snapshot/shaar_hayichud_snapshot.dart';

final bundled = await rootBundle.loadString(snapshotAsset('catalog.json'));
String? fetched;
try {
  fetched = (await http.get(const DataUrls().catalog)).body;
} catch (_) {}
final catalog = parseCatalogWithFallback(fetched: fetched, bundled: bundled);
```

`parseCatalogWithFallback` uses the fetched text unless it is null or not a
valid v1 catalog. Upgrade the snapshot when you release the app
(`dart pub upgrade shaar_hayichud_snapshot`).

## Versions

See [CHANGELOG.md](CHANGELOG.md).

## Development

Models in `lib/src/generated/` are generated from
`data/schema/v1/*.schema.json` and are not committed (the published package
includes them). Generate them after `dart pub get` and after changing a
schema:

```bash
dart run tool/generate_models.dart
```

Tests round-trip every file in `data/dist/v1/` and `data/chapters/`, so build
the data first:

```bash
(cd ../../data/tools && yarn install && yarn build-data)
dart pub get
dart run tool/generate_models.dart
dart analyze
dart test
```

To use a local checkout from an app (lessons2) while changing both, add a
git-ignored `pubspec_overrides.yaml` at the app's workspace root:

```yaml
dependency_overrides:
  shaar_hayichud_data:
    path: ../shaar-hayichud-sections/packages/dart
```

## Releasing

Publishing is automated from GitHub Actions
(`.github/workflows/publish-data-package.yml`):

1. Bump `version` in `pubspec.yaml` and add a `CHANGELOG.md` entry; merge to
   `master`.
2. Tag that commit and push the tag (as yourself, not from a workflow):
   `git tag shaar_hayichud_data-v1.6.0 && git push origin shaar_hayichud_data-v1.6.0`.
   The workflow checks the tag matches `version`, generates the models, runs
   the tests and publishes.

For an unreleased change in an app's preview build, publish a prerelease
(`1.6.0-dev.1`, tag `shaar_hayichud_data-v1.6.0-dev.1`).
