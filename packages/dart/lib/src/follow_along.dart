/// Follow-along logic: which class plays for a line, which line (or
/// transcript paragraph) is current at a time, autoplay next, and the topic
/// under way.
///
/// A port of the pure parts of `site/hugo/assets/js/audio/model.ts`, so the
/// apps behave like the site. Both are checked against the same vectors
/// (`site/lib/audio-model.vectors.json`); change them together.
library;

import 'generated/models.g.dart';

/// How long an item stays current after its own end when the next item
/// starts later (the teacher is usually still explaining it).
const double holdSeconds = 30;

/// Catalog series id of the default teacher (Rabbi Benyamin Walters
/// Original Class), used when no teacher has been chosen.
const String defaultSeriesId = '0';

/// Something with a time range in one recording: a line of a class's
/// alignment (key = line id) or a transcript paragraph (key = its index).
final class TimedItem {
  const TimedItem(this.key, this.start, this.end);

  final String key;
  final double start;
  final double end;

  @override
  String toString() => 'TimedItem($key, $start, $end)';
}

/// A stretch of a recording during which [keys] are current.
final class Span {
  const Span(this.start, this.end, this.keys);

  final double start;
  final double end;
  final List<String> keys;

  @override
  String toString() => 'Span($start, $end, $keys)';
}

/// "Until the next item": an item is current from its start until the next
/// item (in time order) starts, but no longer than [hold] past its own end.
/// Items that start at the same time (Sofer sometimes collapses timestamps
/// to one instant) are current together, in input order. Spans never
/// overlap, so at most one group is current at any time, and zero-length
/// items still get a span.
List<Span> spans(Iterable<TimedItem> items, {double hold = holdSeconds}) {
  // Sort by start, keeping input order on ties (List.sort is not stable).
  final indexed = items.indexed.toList()
    ..sort((a, b) {
      final d = a.$2.start.compareTo(b.$2.start);
      return d != 0 ? d : a.$1.compareTo(b.$1);
    });
  final groups = <({double start, double end, List<String> keys})>[];
  for (final (_, it) in indexed) {
    final last = groups.isEmpty ? null : groups.last;
    if (last != null && last.start == it.start) {
      last.keys.add(it.key);
      groups.last = (
        start: last.start,
        end: last.end > it.end ? last.end : it.end,
        keys: last.keys,
      );
    } else {
      groups.add((
        start: it.start,
        end: it.end > it.start ? it.end : it.start,
        keys: [it.key],
      ));
    }
  }
  return [
    for (var i = 0; i < groups.length; i++)
      Span(
        groups[i].start,
        i + 1 < groups.length && groups[i + 1].start < groups[i].end + hold
            ? groups[i + 1].start
            : groups[i].end + hold,
        List.unmodifiable(groups[i].keys),
      ),
  ];
}

/// The span current at time [t] (binary search over the non-overlapping,
/// sorted [list] that [spans] returns), or null in a gap.
Span? spanAt(List<Span> list, double t) {
  var lo = 0;
  var hi = list.length - 1;
  while (lo <= hi) {
    final mid = (lo + hi) >> 1;
    final s = list[mid];
    if (t < s.start) {
      hi = mid - 1;
    } else if (t >= s.end) {
      lo = mid + 1;
    } else {
      return s;
    }
  }
  return null;
}

/// What the listener has chosen, for [rankRefs].
final class RefPreference {
  const RefPreference({this.seriesId, this.currentLecture});

  /// The teacher (catalog series id) picked by the listener.
  final String? seriesId;

  /// Index into [ChapterAlignments.lectures] of the class in the player:
  /// within a series, staying in it wins.
  final int? currentLecture;
}

/// Candidates for playing a line, best first: the preferred series, then
/// the class already in the player, then highest confidence, then the
/// earliest class (catalog order) and time.
///
/// [seriesOf] gives the series id of a lecture index (see
/// [ChapterAlignmentsIndex.rankRefs] for the usual call).
List<ChapterAlignmentsRef> rankRefs(
  Iterable<ChapterAlignmentsRef> refs,
  String? Function(int lecture) seriesOf,
  RefPreference pref,
) {
  int cmp(ChapterAlignmentsRef a, ChapterAlignmentsRef b) {
    int flag(bool v) => v ? 0 : 1;
    // Like the site's `lectures[i]?.seriesId === pref.seriesId`: a lecture
    // with no series (index out of range) never counts as preferred, even
    // when no series is preferred.
    bool preferred(int lecture) {
      final s = seriesOf(lecture);
      return s != null && s == pref.seriesId;
    }

    final ds = flag(preferred(a.lecture)) - flag(preferred(b.lecture));
    if (ds != 0) return ds;
    final dc =
        flag(a.lecture == pref.currentLecture) -
        flag(b.lecture == pref.currentLecture);
    if (dc != 0) return dc;
    final dconf = b.confidence.compareTo(a.confidence);
    if (dconf != 0) return dconf;
    final dl = a.lecture - b.lecture;
    if (dl != 0) return dl;
    return a.startSeconds.compareTo(b.startSeconds);
  }

  final indexed = refs.indexed.toList()
    ..sort((a, b) {
      final d = cmp(a.$2, b.$2);
      return d != 0 ? d : a.$1.compareTo(b.$1);
    });
  return [for (final (_, r) in indexed) r];
}

/// Whether the class [selected] (a lecture index: the class in the player)
/// reads a line (its refs). Lines it doesn't read still play (another
/// class), but are marked. With no class chosen, true.
bool lineInClass(Iterable<ChapterAlignmentsRef> refs, int? selected) =>
    selected == null || refs.any((r) => r.lecture == selected);

/// Candidates for "play from here" on a line, best first: when the chosen
/// class [selected] reads the line, only its ranges (a chosen class is never
/// left for another on a line it reads, whatever the teacher preference);
/// else every class's, ranked by [rankRefs].
List<ChapterAlignmentsRef> playableRefs(
  Iterable<ChapterAlignmentsRef> refs,
  String? Function(int lecture) seriesOf,
  RefPreference pref,
  int? selected,
) {
  final own = selected == null
      ? const <ChapterAlignmentsRef>[]
      : refs.where((r) => r.lecture == selected).toList();
  return rankRefs(own.isNotEmpty ? own : refs, seriesOf, pref);
}

/// The index of the class after [lecture] in its own series (catalog order),
/// or null after the series' last class. Autoplay next stops there: it never
/// moves on to another chapter.
int? nextInSeries(List<String> seriesIds, int lecture) {
  if (lecture < 0 || lecture >= seriesIds.length) return null;
  final seriesId = seriesIds[lecture];
  for (var i = lecture + 1; i < seriesIds.length; i++) {
    if (seriesIds[i] == seriesId) return i;
  }
  return null;
}

/// A series (teacher) that discusses a chapter.
final class ChapterSeries {
  const ChapterSeries(this.id, this.title);

  final String id;
  final String title;

  @override
  bool operator ==(Object other) =>
      other is ChapterSeries && other.id == id && other.title == title;

  @override
  int get hashCode => Object.hash(id, title);

  @override
  String toString() => 'ChapterSeries($id, $title)';
}

/// The teacher to play on a chapter: the saved one ([savedId]) when it has
/// classes here, else the default teacher ([defaultSeriesId]), else the
/// first series here. `fellBack` is true only when a saved choice could not
/// be honoured (worth telling the listener).
({S? series, bool fellBack}) chooseSeries<S>(
  List<S> here,
  String? savedId,
  String Function(S) idOf,
) {
  if (savedId != null) {
    for (final s in here) {
      if (idOf(s) == savedId) return (series: s, fellBack: false);
    }
  }
  S? series;
  for (final s in here) {
    if (idOf(s) == defaultSeriesId) {
      series = s;
      break;
    }
  }
  series ??= here.isEmpty ? null : here.first;
  return (series: series, fellBack: savedId != null);
}

/// The topic under way at time [t] (the last one started), or null before
/// the first. [topics] are in time order, as published.
OutlineTopic? topicAt(List<OutlineTopic> topics, double t) {
  OutlineTopic? found;
  for (final topic in topics) {
    if (topic.startSeconds <= t) {
      found = topic;
    } else {
      break;
    }
  }
  return found;
}

/// Follow-along helpers over a published per-chapter alignment index.
extension ChapterAlignmentsIndex on ChapterAlignments {
  /// Series id of each class, by lecture index.
  List<String> get seriesIds => [for (final l in lectures) l.seriesId];

  /// Series that discuss this chapter, in catalog order of their first class.
  List<ChapterSeries> get series {
    final seen = <String>{};
    return [
      for (final l in lectures)
        if (seen.add(l.seriesId)) ChapterSeries(l.seriesId, l.series),
    ];
  }

  /// The index of a lecture by catalog id, or null when it has no lines here.
  int? lectureIndex(String lectureId) {
    final i = lectures.indexWhere((l) => l.id == lectureId);
    return i < 0 ? null : i;
  }

  /// Timed items (line ids) of one class (by lecture index) in this chapter.
  List<TimedItem> lectureItems(int lecture) => [
    for (final line in lines)
      for (final r in line.refs)
        if (r.lecture == lecture)
          TimedItem(line.lineId, r.startSeconds, r.endSeconds),
  ];

  /// [spans] of one class (by lecture index): feed [spanAt] the player's
  /// position to get the current line ids.
  List<Span> lectureSpans(int lecture, {double hold = holdSeconds}) =>
      spans(lectureItems(lecture), hold: hold);

  /// [rankRefs] for a line of this chapter.
  List<ChapterAlignmentsRef> rankRefs(
    ChapterAlignmentsLine line,
    RefPreference pref,
  ) {
    final ids = seriesIds;
    return _rankRefs(
      line.refs,
      (i) => i >= 0 && i < ids.length ? ids[i] : null,
      pref,
    );
  }

  /// [playableRefs] for a line of this chapter, with [selected] the chosen
  /// class (lecture index) or null.
  List<ChapterAlignmentsRef> playableRefs(
    ChapterAlignmentsLine line,
    RefPreference pref,
    int? selected,
  ) {
    final ids = seriesIds;
    return _playableRefs(
      line.refs,
      (i) => i >= 0 && i < ids.length ? ids[i] : null,
      pref,
      selected,
    );
  }

  /// [nextInSeries] within this chapter.
  int? nextInSeries(int lecture) => _nextInSeries(seriesIds, lecture);

  /// [chooseSeries] among this chapter's [series].
  ({ChapterSeries? series, bool fellBack}) chooseSeries(String? savedId) =>
      _chooseSeries(series, savedId, (s) => s.id);
}

/// Timed items of a transcript: one per segment, keyed by its index.
extension TranscriptTiming on Transcript {
  List<TimedItem> get items => [
    for (final (i, s) in segments.indexed)
      TimedItem('$i', s.startSeconds, s.endSeconds),
  ];
}

// Aliases so the extension methods can call the top-level functions they
// shadow.
const _rankRefs = rankRefs;
const _playableRefs = playableRefs;
const _nextInSeries = nextInSeries;
const _chooseSeries = chooseSeries;
