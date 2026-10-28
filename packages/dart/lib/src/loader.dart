import 'dart:convert';

import 'generated/models.g.dart';

/// Parses `catalog.json`. Throws [FormatException] when the text is not a v1
/// catalog.
Catalog parseCatalog(String source) => Catalog.fromJson(_decode(source));

/// Parses a chapter file (`chapter_NN.json`).
Chapter parseChapter(String source) => chapterFromJson(_decode(source));

/// Parses an `index.json` listing.
IndexListing parseIndexListing(String source) =>
    IndexListing.fromJson(_decode(source));

/// Parses a per-lecture alignment file (`alignments/<lecture>.json`).
Alignment parseAlignment(String source) => Alignment.fromJson(_decode(source));

/// Parses a per-chapter alignment index (`alignments/chapters/chapter_NN.json`).
ChapterAlignments parseChapterAlignments(String source) =>
    ChapterAlignments.fromJson(_decode(source));

/// Parses a topic outline file (`outlines/<lecture>.json`).
Outline parseOutline(String source) => Outline.fromJson(_decode(source));

/// Parses a transcript file (`transcripts/<lecture>.json`).
Transcript parseTranscript(String source) =>
    Transcript.fromJson(_decode(source));

/// Parses [fetched] (e.g. the latest `catalog.json` from the network) and
/// falls back to [bundled] (the copy shipped with the app) when [fetched] is
/// null or not a valid v1 catalog. [bundled] must parse.
Catalog parseCatalogWithFallback({
  required String? fetched,
  required String bundled,
}) {
  if (fetched != null) {
    try {
      return parseCatalog(fetched);
    } on FormatException {
      // Fall through to the bundled snapshot.
    }
  }
  return parseCatalog(bundled);
}

Object? _decode(String source) {
  // Tolerate a UTF-8 BOM, which some editors add.
  final s = source.startsWith('﻿') ? source.substring(1) : source;
  return jsonDecode(s);
}
