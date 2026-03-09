const fs = require("fs");

function translationPermalinkForSlug(slug) {
  const match = slug.match(/^chapter_(\d+)$/);
  if (!match) return null;
  return `/en/translation/chapter-${parseInt(match[1], 10)}/`;
}

module.exports = {
  layout: "layouts/text.njk",
  tags: ["texts"],
  pagination: {
    data: "xmlLocales",
    size: 1,
    alias: "locale",
  },
  eleventyComputed: {
    tags: (data) => data.locale.section === "translation" ? [] : ["texts"],
    hasTranslation(data) {
      if (!data.page.inputPath) return false;
      const content = fs.readFileSync(data.page.inputPath, "utf8");
      return content.includes("<translation");
    },
    translationPermalink: (data) => translationPermalinkForSlug(data.page.fileSlug),
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
      if (!match) return;
      const n = parseInt(match[1], 10);
      if (data.locale.section === "translation") {
        return translationPermalinkForSlug(slug);
      }
      return `/${data.locale.lang}/texts/chapter-${n}/`;
    },
  },
};
