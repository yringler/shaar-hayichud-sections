import 'dart:convert';
import 'dart:io';

import 'package:shaar_hayichud_data/shaar_hayichud_data.dart';
import 'package:test/test.dart';

import 'repo_data.dart';

/// The vectors site/lib/audio-model.test.mjs also runs against model.ts.
final Map<String, Object?> vectors =
    jsonDecode(
          File('../../site/lib/audio-model.vectors.json').readAsStringSync(),
        )
        as Map<String, Object?>;

List<Map<String, Object?>> cases(String key) =>
    (vectors[key]! as List<Object?>).cast<Map<String, Object?>>();

double num_(Object? v) => (v! as num).toDouble();

ChapterAlignmentsRef ref(int lecture, double start, double confidence) =>
    ChapterAlignmentsRef(
      lecture: lecture,
      startSeconds: start,
      endSeconds: start + 5,
      confidence: confidence,
    );

ChapterAlignmentsLecture lecture(String id, String seriesId) =>
    ChapterAlignmentsLecture(
      id: id,
      url: 'u/$id',
      title: id,
      seriesId: seriesId,
      series: 'S$seriesId',
      part: '',
      durationSeconds: null,
      alignment: '',
    );

OutlineTopic topic(double start) => OutlineTopic(
  title: 't$start',
  startSeconds: start,
  confidence: OutlineTopicConfidence.values.first,
);

void main() {
  group('vectors shared with model.ts', () {
    for (final c in cases('rankRefs')) {
      test('rankRefs: ${c['name']}', () {
        final series = (c['series']! as List<Object?>).cast<String>();
        final refs = [
          for (final r in (c['refs']! as List<Object?>).cast<List<Object?>>())
            ref(r[0]! as int, num_(r[1]), num_(r[2])),
        ];
        final pref = c['pref']! as Map<String, Object?>;
        final ranked = rankRefs(
          refs,
          (i) => series[i],
          RefPreference(
            seriesId: pref['seriesId'] as String?,
            currentLecture: pref['currentLecture'] as int?,
          ),
        );
        expect(
          [
            for (final r in ranked) [r.lecture, r.startSeconds],
          ],
          [
            for (final e
                in (c['expect']! as List<Object?>).cast<List<Object?>>())
              [e[0], num_(e[1])],
          ],
        );
      });
    }

    for (final c in cases('spans')) {
      test('spans: ${c['name']}', () {
        final items = [
          for (final i in (c['items']! as List<Object?>).cast<List<Object?>>())
            TimedItem(i[0]! as String, num_(i[1]), num_(i[2])),
        ];
        final s = c.containsKey('hold')
            ? spans(items, hold: num_(c['hold']))
            : spans(items);
        expect(
          [
            for (final x in s) [x.start, x.end, x.keys],
          ],
          [
            for (final e
                in (c['expect']! as List<Object?>).cast<List<Object?>>())
              [num_(e[0]), num_(e[1]), (e[2]! as List<Object?>).cast<String>()],
          ],
        );
        for (final a in (c['at']! as List<Object?>).cast<List<Object?>>()) {
          expect(
            spanAt(s, num_(a[0]))?.keys,
            (a[1] as List<Object?>?)?.cast<String>(),
            reason: 'spanAt(${a[0]})',
          );
        }
      });
    }

    test('nextInSeries', () {
      for (final c in cases('nextInSeries')) {
        final series = (c['series']! as List<Object?>).cast<String>();
        expect(
          nextInSeries(series, c['lecture']! as int),
          c['expect'],
          reason: '$series from ${c['lecture']}',
        );
      }
    });

    for (final c in cases('chooseSeries')) {
      test('chooseSeries: ${c['name']}', () {
        final here = (c['here']! as List<Object?>).cast<String>();
        final r = chooseSeries(here, c['saved'] as String?, (s) => s);
        final e = c['expect']! as Map<String, Object?>;
        expect(r.series, e['series']);
        expect(r.fellBack, e['fellBack']);
      });
    }

    test('topicAt', () {
      for (final c in cases('topicAt')) {
        final topics = [
          for (final t in c['topics']! as List<Object?>) topic(num_(t)),
        ];
        final found = topicAt(topics, num_(c['t']));
        final e = c['expect'] as int?;
        expect(found, e == null ? isNull : same(topics[e]), reason: '$c');
      }
    });
  });

  test('rankRefs: a lecture with no series is never the preferred one', () {
    // Lecture 5 is out of range (no series). With no preferred series it
    // must not jump ahead of a better real lecture (the site compares
    // undefined with null as unequal).
    String? seriesOf(int i) => i == 0 ? '0' : null;
    expect(
      rankRefs(
        [ref(5, 2, 0.5), ref(0, 1, 0.9)],
        seriesOf,
        const RefPreference(),
      ).map((r) => r.lecture),
      [0, 5],
    );
    expect(
      rankRefs(
        [ref(5, 2, 0.9), ref(0, 1, 0.5)],
        seriesOf,
        const RefPreference(seriesId: '0'),
      ).map((r) => r.lecture),
      [0, 5],
    );
  });

  group('ChapterAlignmentsIndex', () {
    final data = ChapterAlignments(
      chapter: 'chapter_10',
      lectures: [lecture('a', '0'), lecture('b', '0'), lecture('m', '37')],
      lines: [
        ChapterAlignmentsLine(lineId: 'l1', refs: [ref(0, 1, 1), ref(2, 7, 1)]),
        ChapterAlignmentsLine(lineId: 'l2', refs: [ref(2, 20, 1)]),
      ],
    );

    test('lectureItems picks one class\'s ranges', () {
      expect(
        [
          for (final i in data.lectureItems(2)) [i.key, i.start, i.end],
        ],
        [
          ['l1', 7.0, 12.0],
          ['l2', 20.0, 25.0],
        ],
      );
      expect(spanAt(data.lectureSpans(2), 21)?.keys, ['l2']);
    });

    test('series lists each series once, in order', () {
      expect(data.series, const [
        ChapterSeries('0', 'S0'),
        ChapterSeries('37', 'S37'),
      ]);
    });

    test('rankRefs, nextInSeries, chooseSeries and lectureIndex', () {
      expect(
        data
            .rankRefs(data.lines[0], const RefPreference(seriesId: '37'))
            .map((r) => r.lecture),
        [2, 0],
      );
      expect(data.nextInSeries(0), 1);
      expect(data.nextInSeries(1), isNull);
      expect(data.chooseSeries('37').series, const ChapterSeries('37', 'S37'));
      expect(data.chooseSeries(null).series, const ChapterSeries('0', 'S0'));
      expect(data.lectureIndex('m'), 2);
      expect(data.lectureIndex('zz'), isNull);
    });
  });

  test('Transcript items key segments by index', () {
    final t = Transcript(
      lectureId: 'x',
      language: 'he',
      segments: const [
        TranscriptSegment(startSeconds: 0, endSeconds: 40, text: 'a'),
        TranscriptSegment(startSeconds: 40, endSeconds: 90, text: 'b'),
      ],
    );
    expect([for (final i in t.items) i.key], ['0', '1']);
    expect(spanAt(spans(t.items), 45)?.keys, ['1']);
  });

  test('published chapter alignments give sorted, non-overlapping spans of '
      'real lines', () {
    final dir = Directory('${requireDist().path}/alignments/chapters');
    final files = dir
        .listSync()
        .whereType<File>()
        .where(
          (f) => f.path.endsWith('.json') && !f.path.endsWith('index.json'),
        )
        .toList();
    expect(files, isNotEmpty);
    for (final f in files) {
      final data = parseChapterAlignments(f.readAsStringSync());
      final lineIds = {for (final l in data.lines) l.lineId};
      for (var i = 0; i < data.lectures.length; i++) {
        final s = data.lectureSpans(i);
        expect(s, isNotEmpty, reason: '${f.path} lecture $i has no lines');
        for (var j = 0; j < s.length; j++) {
          expect(s[j].end, greaterThan(s[j].start), reason: f.path);
          if (j > 0) {
            expect(s[j].start, greaterThanOrEqualTo(s[j - 1].end));
          }
          expect(lineIds.containsAll(s[j].keys), isTrue);
          // The first span's start finds that span again.
          expect(spanAt(s, s[j].start), same(s[j]));
        }
      }
      for (final line in data.lines) {
        final ranked = data.rankRefs(line, const RefPreference());
        expect(ranked.length, line.refs.length);
      }
    }
  });
}
