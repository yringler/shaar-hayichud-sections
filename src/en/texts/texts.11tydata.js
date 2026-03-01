module.exports = {
  layout: "layouts/text.njk",
  tags: ["texts"],
  eleventyComputed: {
    title(data) {
      // chapter_01 → "Chapter 1", chapter_02 → "Chapter 2", etc.
      const slug = data.page.fileSlug;
      const match = slug.match(/^chapter_(\d+)$/);
      if (match) {
        return `Chapter ${parseInt(match[1], 10)}`;
      }
      return slug;
    },
    permalink(data) {
      const slug = data.page.fileSlug;
      const match = slug.match(/^chapter_(\d+)$/);
      if (match) {
        return `/${data.lang}/texts/chapter-${parseInt(match[1], 10)}/`;
      }
      return null;
    },
  },
};
