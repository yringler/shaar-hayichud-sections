/// Origin of the published site that serves `/data/v1/`.
const String defaultSiteBase = 'https://www.shaarhayichudresources.com';

/// Origin of the audio CDN (the catalog's `cdnBase`).
const String defaultCdnBase = 'https://media.shaarhayichudresources.com';

/// Percent-encodes one URL path segment the way the data build does:
/// `encodeURIComponent` plus `!'()*`, so only RFC 3986 unreserved characters
/// stay literal.
String encodePathSegment(
  String segment,
) => Uri.encodeComponent(segment).replaceAllMapped(
  RegExp(r"[!'()*]"),
  (m) =>
      '%${m[0]!.codeUnitAt(0).toRadixString(16).toUpperCase().padLeft(2, '0')}',
);

/// The canonical CDN URL for [filename] in [folder] (which may contain `/`).
///
/// Matches `CatalogLecture.url`; clients should prefer that field and only use
/// this for files that are not in the catalog.
String buildMediaUrl(String cdnBase, String folder, String filename) {
  final path = [
    ...folder.split('/'),
    filename,
  ].map(encodePathSegment).join('/');
  return '${_trimSlashes(cdnBase)}/$path';
}

/// The chapter key for chapter [number], e.g. `chapter_01`.
String chapterKey(int number) {
  if (number < 1) throw RangeError.value(number, 'number', 'must be >= 1');
  return 'chapter_${number.toString().padLeft(2, '0')}';
}

/// URLs of everything published under `/data/v1/`.
///
/// ```dart
/// const urls = DataUrls();
/// urls.catalog; // https://www.shaarhayichudresources.com/data/v1/catalog.json
/// ```
class DataUrls {
  /// [siteBase] is the site origin (no trailing slash needed), e.g. a branch
  /// preview deployment.
  const DataUrls({this.siteBase = defaultSiteBase});

  final String siteBase;

  /// `<siteBase>/data/v1`
  String get root => '${_trimSlashes(siteBase)}/data/v1';

  Uri _at(String path) => Uri.parse('$root/$path');

  /// Top-level listing of the published collections.
  Uri get index => _at('index.json');

  /// The audio class catalog.
  Uri get catalog => _at('catalog.json');

  /// Listing of the chapter files.
  Uri get chaptersIndex => _at('chapters/index.json');

  /// One chapter by number (1-based).
  Uri chapter(int number) => chapterByKey(chapterKey(number));

  /// One chapter by key, e.g. `chapter_01`.
  Uri chapterByKey(String key) =>
      _at('chapters/${encodePathSegment(key)}.json');

  /// Listing of the per-lecture alignment files (only published lectures).
  Uri get alignmentsIndex => _at('alignments/index.json');

  /// The alignment for a catalog lecture id (404 when not published).
  Uri alignment(String lectureId) =>
      _at('alignments/${encodePathSegment(lectureId)}.json');

  /// Listing of the per-chapter alignment indexes.
  Uri get chapterAlignmentsIndex => _at('alignments/chapters/index.json');

  /// Every published class aligned to chapter [key] (e.g. `chapter_10`;
  /// 404 when none is).
  Uri chapterAlignments(String key) =>
      _at('alignments/chapters/${encodePathSegment(key)}.json');

  /// Listing of the transcript files (only published lectures).
  Uri get transcriptsIndex => _at('transcripts/index.json');

  /// The transcript for a catalog lecture id (404 when not published).
  Uri transcript(String lectureId) =>
      _at('transcripts/${encodePathSegment(lectureId)}.json');

  /// Listing of the topic outline files (only published lectures).
  Uri get outlinesIndex => _at('outlines/index.json');

  /// The auto-generated topic outline for a catalog lecture id (404 when
  /// not published).
  Uri outline(String lectureId) =>
      _at('outlines/${encodePathSegment(lectureId)}.json');

  /// A JSON Schema by file name, e.g. `catalog.schema.json`.
  Uri schema(String fileName) => _at('schema/${encodePathSegment(fileName)}');

  /// Resolves an `IndexListingItem.path` (relative to `/data/v1/`).
  Uri resolve(String relativePath) => _at(relativePath);
}

String _trimSlashes(String s) => s.replaceFirst(RegExp(r'/+$'), '');
