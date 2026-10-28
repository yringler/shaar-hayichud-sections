import 'package:shaar_hayichud_data/shaar_hayichud_data.dart';
import 'package:test/test.dart';

void main() {
  test('encodePathSegment matches encodeURIComponent plus !\'()*', () {
    expect(encodePathSegment("a b!'()*~-_.c"), 'a%20b%21%27%28%29%2A~-_.c');
    expect(encodePathSegment('a/b?#&'), 'a%2Fb%3F%23%26');
    expect(encodePathSegment('שער'), '%D7%A9%D7%A2%D7%A8');
  });

  test('buildMediaUrl keeps folder slashes and trims the base', () {
    expect(
      buildMediaUrl('https://cdn.example/', 'A b/C (d)', '01 - x.mp3'),
      'https://cdn.example/A%20b/C%20%28d%29/01%20-%20x.mp3',
    );
  });

  test('chapterKey pads to two digits', () {
    expect(chapterKey(1), 'chapter_01');
    expect(chapterKey(54), 'chapter_54');
    expect(() => chapterKey(0), throwsRangeError);
  });

  test('DataUrls', () {
    const urls = DataUrls();
    const base = 'https://www.shaarhayichudresources.com/data/v1';
    expect(urls.root, base);
    expect(urls.index.toString(), '$base/index.json');
    expect(urls.catalog.toString(), '$base/catalog.json');
    expect(urls.chaptersIndex.toString(), '$base/chapters/index.json');
    expect(urls.chapter(7).toString(), '$base/chapters/chapter_07.json');
    expect(urls.alignmentsIndex.toString(), '$base/alignments/index.json');
    expect(
      urls.alignment('01 - Intro.mp3').toString(),
      '$base/alignments/01%20-%20Intro.mp3.json',
    );
    expect(urls.transcriptsIndex.toString(), '$base/transcripts/index.json');
    expect(
      urls.schema('catalog.schema.json').toString(),
      '$base/schema/catalog.schema.json',
    );
    expect(
      const DataUrls(siteBase: 'https://preview.example/').catalog.toString(),
      'https://preview.example/data/v1/catalog.json',
    );
  });
}
