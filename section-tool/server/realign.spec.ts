import { chapterKeyOf } from './realign';

describe('chapterKeyOf', () => {
  it('names the chapter of a chapter file and nothing else', () => {
    expect(chapterKeyOf('data/chapters/chapter_18.json')).toBe('chapter_18');
    expect(chapterKeyOf('data/chapters/index.json')).toBeNull();
    expect(chapterKeyOf('data/chapters/sub/chapter_18.json')).toBeNull();
  });
});
