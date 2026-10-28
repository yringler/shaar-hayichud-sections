import 'generated/models.g.dart';

/// Tree walks over a [Catalog].
extension CatalogTree on Catalog {
  /// Every section, depth-first in display order.
  Iterable<CatalogSection> get allSections sync* {
    for (final s in series) {
      yield s;
      yield* s.allSections;
    }
  }

  /// Every lecture, depth-first in display order.
  Iterable<CatalogLecture> get allLectures sync* {
    for (final s in series) {
      yield* s.allLectures;
    }
  }

  /// Every section and lecture by id. Ids are unique across the catalog.
  Map<String, CatalogItem> indexById() => {
    for (final s in allSections) s.id: s,
    for (final l in allLectures) l.id: l,
  };
}

/// Tree walks over a [CatalogSection].
extension CatalogSectionTree on CatalogSection {
  /// Direct child sections.
  Iterable<CatalogSection> get sections => items.whereType<CatalogSection>();

  /// Direct child lectures.
  Iterable<CatalogLecture> get lectures => items.whereType<CatalogLecture>();

  /// Nested sections (not including this one), depth-first.
  Iterable<CatalogSection> get allSections sync* {
    for (final s in sections) {
      yield s;
      yield* s.allSections;
    }
  }

  /// Every lecture under this section, depth-first in display order.
  Iterable<CatalogLecture> get allLectures sync* {
    for (final item in items) {
      switch (item) {
        case CatalogLecture():
          yield item;
        case CatalogSection():
          yield* item.allLectures;
      }
    }
  }
}

/// Convenience accessors on [CatalogLecture].
extension CatalogLectureX on CatalogLecture {
  /// [durationSeconds] as a [Duration], or null when not measured.
  Duration? get duration => durationSeconds == null
      ? null
      : Duration(microseconds: (durationSeconds! * 1e6).round());

  /// [url] parsed as a [Uri].
  Uri get uri => Uri.parse(url);
}

/// Line access on [TextNode].
extension TextNodeText on TextNode {
  /// Every line in this node and its descendants, in document order.
  Iterable<TextLine> get allLines sync* {
    for (final c in children) {
      switch (c) {
        case TextLine():
          yield c;
        case TextNode():
          yield* c.allLines;
      }
    }
  }

  /// The text of [allLines], joined with newlines.
  String get plainText => allLines.map((l) => l.text).join('\n');
}

/// Line access on a whole [Chapter].
extension ChapterLines on Chapter {
  /// Every line in the chapter, in document order.
  Iterable<TextLine> get allLines => expand((n) => n.allLines);

  /// Lines by [TextLine.id]. Line ids are unique across all chapters, so
  /// several chapters' maps can be merged without clashes.
  Map<String, TextLine> indexLines() => {for (final l in allLines) l.id: l};
}
