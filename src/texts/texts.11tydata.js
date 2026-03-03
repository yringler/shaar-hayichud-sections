module.exports = {
  layout: "layouts/text.njk",
  tags: ["texts"],
  pagination: {
    data: "xmlLocales",
    size: 1,
    alias: "locale",
  },
  eleventyComputed: {
    lang: (data) => data.locale.lang,
    dir: (data) => data.locale.dir,
    title(data) {
      const slug = data.page.fileSlug;
      const match = slug.match(/^chapter_(\d+)$/);
      return match ? `Chapter ${parseInt(match[1], 10)}` : slug;
    },
    permalink(data) {
      const slug = data.page.fileSlug;
      const match = slug.match(/^chapter_(\d+)$/);
      if (match) {
        return `/${data.locale.lang}/texts/chapter-${parseInt(match[1], 10)}/`;
      }
    },
  },
};
