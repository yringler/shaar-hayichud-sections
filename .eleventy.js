module.exports = function (eleventyConfig) {
  // Don't let Eleventy read .gitignore — src/texts/*.html is gitignored (generated)
  // but we still need Eleventy to process it. Use .eleventyignore instead.
  eleventyConfig.setUseGitIgnore(false);

  // Pass CNAME through to _site/ unchanged
  eleventyConfig.addPassthroughCopy("src/CNAME");

  // Encode a full URL for use in src/href attributes
  eleventyConfig.addFilter("urlencode", (url) => encodeURI(url));

  // Count all audio files recursively under a node's children
  eleventyConfig.addFilter("trackCount", (children) => {
    function count(nodes) {
      return (nodes || []).reduce(
        (sum, node) => sum + (node.file ? 1 : count(node.children)),
        0
      );
    }
    return count(children);
  });

  // Add display titles ("Part N") to untitled leaf nodes within a part's children.
  // Direct file children share one counter; each ### subsection resets its own counter.
  eleventyConfig.addFilter("addPartNumbers", (children) => {
    let leafIdx = 0;
    return (children || []).map((item) => {
      if (item.file) {
        leafIdx++;
        return { ...item, displayTitle: item.title || `Part ${leafIdx}` };
      }
      if (item.children) {
        let subIdx = 0;
        return {
          ...item,
          children: item.children.map((track) => {
            if (track.file) {
              subIdx++;
              return { ...track, displayTitle: track.title || `Part ${subIdx}` };
            }
            return track;
          }),
        };
      }
      return item;
    });
  });

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
