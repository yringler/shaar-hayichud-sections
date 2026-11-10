# packages/dart — `shaar_hayichud_data`

Pure Dart (no Flutter) models and loader for the JSON published under
`/data/v1/`. Published to pub.dev and used from there by the lessons2 Flutter
app, so keep it Flutter-free with no runtime dependencies, and keep the SDK
constraint compatible with lessons2. The bundled data lives in a separate
package, `packages/snapshot`, so data refreshes don't version this one.

- `data/schema/v1/` is the source of truth. `lib/src/generated/` is produced
  from it by `tool/generate_models.dart`; never hand-edit generated code.
  It is git-ignored (run the generator after `dart pub get`) and shipped
  because `.pubignore` replaces `.gitignore` when publishing; never commit it.
  If a schema uses a construct the generator doesn't support, extend the
  generator (it fails loudly on unknown constructs).
- Hand-written code (`lib/src/`): parsing entry points, canonical `/data/v1/`
  and CDN URL builders, tree/convenience extensions, and the follow-along
  logic (`follow_along.dart`), a port of the site's `audio/model.ts`. It
  must behave like the site: both run `site/lib/audio-model.vectors.json`,
  so a change there goes in both, with a new vector. URL encoding must
  stay identical to `data/tools` (a test checks every catalog URL).
- Tests round-trip every file in `data/dist/v1/` and `data/chapters/`. Run
  `yarn build-data` in `data/tools` and the generator first.
- Catalog IDs and chapter line IDs are persisted (by apps and alignments);
  nothing here may rename or rewrite them.
- Bump `version` in `pubspec.yaml` and add a `CHANGELOG.md` entry when the
  public API changes. After merging, the version is released by pushing the
  tag `shaar_hayichud_data-v<version>` (`.github/workflows/publish-data-package.yml`
  checks the tag matches and publishes). pub.dev versions are permanent.

Checks: `dart run tool/generate_models.dart`, `dart analyze`, `dart test`
(`.github/workflows/dart.yml` runs them, plus a publish dry run).
