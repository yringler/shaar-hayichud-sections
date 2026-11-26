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

  /// The ids of every section and lecture that is effectively extra: marked
  /// [CatalogItem.extra] itself, or inside a section that is.
  Set<String> effectivelyExtraIds() {
    final ids = <String>{};
    void visit(CatalogItem item, bool inExtra) {
      final extra = inExtra || item.isExtra;
      if (extra) ids.add(item.id);
      if (item is CatalogSection) {
        for (final child in item.items) {
          visit(child, extra);
        }
      }
    }

    for (final s in series) {
      visit(s, false);
    }
    return ids;
  }

  /// Whether the section or lecture [id] is effectively extra: it or one of
  /// its ancestor sections is marked [CatalogItem.extra]. False for an id
  /// that is not in the catalog. Walks the tree; for many lookups, use
  /// [effectivelyExtraIds] once.
  bool isEffectivelyExtra(String id) {
    bool? find(CatalogItem item, bool inExtra) {
      final extra = inExtra || item.isExtra;
      if (item.id == id) return extra;
      if (item is CatalogSection) {
        for (final child in item.items) {
          final found = find(child, extra);
          if (found != null) return found;
        }
      }
      return null;
    }

    for (final s in series) {
      final found = find(s, false);
      if (found != null) return found;
    }
    return false;
  }
}

/// The `extra` flag on any [CatalogItem].
extension CatalogItemExtra on CatalogItem {
  /// Whether this item itself is marked extra (`extra` in `classes.txt`):
  /// still published and reachable, but not offered by default, so lists
  /// put it after its siblings, behind "More". Only the marked node carries
  /// the flag; use [CatalogTree.isEffectivelyExtra] to include ancestors.
  bool get isExtra => extra ?? false;
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
