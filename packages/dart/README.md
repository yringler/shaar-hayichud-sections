# shaar_hayichud_data

Pure Dart models and a small loader for the data this repo publishes at
`https://www.shaarhayichudresources.com/data/v1/`: the audio class catalog,
the chapter text (`TextNode` trees), and the reserved alignment and transcript
shapes. No Flutter dependency, so it works in apps, CLIs and servers.

## Install

```yaml
dependencies:
  shaar_hayichud_data:
    git:
      url: https://github.com/yringler/shaar-hayichud-sections
      path: packages/dart
      ref: main # or a commit sha to pin
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

Apps should ship a copy of `catalog.json` so they work offline and on first
launch:

1. Build it: `cd data/tools && yarn install && yarn build-data`, then copy
   `data/dist/v1/catalog.json` into the app's assets (or download the published
   `https://www.shaarhayichudresources.com/data/v1/catalog.json`).
2. At runtime, fetch the latest catalog and fall back to the bundled copy:

```dart
final bundled = await rootBundle.loadString('assets/catalog.json'); // Flutter
String? fetched;
try {
  fetched = (await http.get(const DataUrls().catalog)).body;
} catch (_) {}
final catalog = parseCatalogWithFallback(fetched: fetched, bundled: bundled);
```

`parseCatalogWithFallback` uses the fetched text unless it is null or not a
valid v1 catalog. Refresh the bundled copy when you release the app.

## Versions

- **1.1.0**: chapter text is a list of `TextLine` (`id` + `text`) instead of
  newline-joined strings (`TextFragment` is gone); `TextNode` no longer has
  `id` or the deprecated `text`; alignment segments reference `lineId`.
  Added `allLines` and `Chapter.indexLines()`.
- **1.0.0**: first release.

## Development

Models in `lib/src/generated/` are generated from `data/schema/v1/*.schema.json`
and committed. After changing a schema:

```bash
dart run tool/generate_models.dart          # regenerate
dart run tool/generate_models.dart --check  # fails if out of date (also run by dart test)
```

Tests round-trip every file in `data/dist/v1/` and `data/chapters/`, so build
the data first:

```bash
(cd ../../data/tools && yarn install && yarn build-data)
dart pub get
dart analyze
dart test
```
