const { EleventyI18nPlugin } = require("@11ty/eleventy");
const { renderXmlToHtml } = require("./lib/xml-renderer");

module.exports = function (eleventyConfig) {
  // Register .xml as a native 11ty template format.
  // The compile function receives the raw XML (after any YAML front matter is
  // stripped by Eleventy) and returns an async render function that produces an
  // HTML fragment. The fragment is then passed through the layout system normally.
  eleventyConfig.addExtension("xml", {
    outputFileExtension: "html",
    compile(inputContent, _inputPath) {
      return async (data) => renderXmlToHtml(inputContent, data);
    },
  });

  // i18n plugin — path-prefix based locale detection (en, he)
  eleventyConfig.addPlugin(EleventyI18nPlugin, {
    defaultLanguage: "en",
  });

  // Pass CNAME and _headers through to _site/ unchanged
  eleventyConfig.addPassthroughCopy("src/CNAME");
  eleventyConfig.addPassthroughCopy("src/_headers");

  // Serve raw XML chapter files at /xml/
  eleventyConfig.addPassthroughCopy({ "src/texts/chapter_*.xml": "xml" });

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
  // Use getAll() instead of getFilteredByTag() to bypass i18n plugin locale filtering,
  // which otherwise excludes non-default-language (he) pagination pages.
  eleventyConfig.addCollection("texts", (api) =>
    api.getAll()
      .filter((item) => (item.data.tags || []).includes("texts"))
      .sort((a, b) => a.inputPath.localeCompare(b.inputPath))
  );

  eleventyConfig.addCollection("translations", (api) =>
    api.getAll()
      .filter((item) => (item.data.tags || []).includes("translations"))
      .sort((a, b) => a.inputPath.localeCompare(b.inputPath))
  );

  eleventyConfig.addCollection("classes", (api) =>
    api.getFilteredByTag("classes").sort((a, b) =>
      a.inputPath.localeCompare(b.inputPath)
    )
  );

  eleventyConfig.setServerOptions({
    // Other options
    middleware: [
      function(req, res, next) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        next();
      }
    ]
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "html", "md", "xml"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
