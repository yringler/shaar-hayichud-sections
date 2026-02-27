module.exports = function (eleventyConfig) {
  // Don't let Eleventy read .gitignore — src/texts/*.html is gitignored (generated)
  // but we still need Eleventy to process it. Use .eleventyignore instead.
  eleventyConfig.setUseGitIgnore(false);

  // Pass CNAME through to _site/ unchanged
  eleventyConfig.addPassthroughCopy("src/CNAME");

  // Named collections (tags drive membership)
  eleventyConfig.addCollection("texts", (api) =>
    api.getFilteredByTag("texts").sort((a, b) =>
      a.inputPath.localeCompare(b.inputPath)
    )
  );

  eleventyConfig.addCollection("classes", (api) =>
    api.getFilteredByTag("classes").sort((a, b) =>
      a.inputPath.localeCompare(b.inputPath)
    )
  );

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "html", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
