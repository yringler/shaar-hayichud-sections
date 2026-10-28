# packages/dart — `shaar_hayichud_data`

Pure Dart (no Flutter) models and loader for the JSON published under
`/data/v1/`. Consumed by the lessons2 Flutter app as a git dependency
(`path: packages/dart`), so keep it Flutter-free with no runtime dependencies,
and keep the SDK constraint compatible with lessons2.

- `data/schema/v1/` is the source of truth. `lib/src/generated/` is produced
  from it by `tool/generate_models.dart`; never hand-edit generated code.
  If a schema uses a construct the generator doesn't support, extend the
  generator (it fails loudly on unknown constructs).
- Hand-written code (`lib/src/`): parsing entry points, canonical `/data/v1/`
  and CDN URL builders, and tree/convenience extensions. URL encoding must
  stay identical to `data/tools` (a test checks every catalog URL).
- Tests round-trip every file in `data/dist/v1/` and `data/chapters/`, and
  check the generated file is current. Run `yarn build-data` in `data/tools`
  first.
- Catalog IDs and chapter line IDs are persisted (by apps and alignments);
  nothing here may rename or rewrite them.
- Bump `version` in `pubspec.yaml` and add a line under README "Versions"
  when the public API changes.

Checks: `dart analyze`, `dart test`.
