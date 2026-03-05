const { readdirSync } = require("fs");
const { resolve } = require("path");

module.exports = function () {
  const root = resolve(__dirname, "../texts");
  return readdirSync(root)
    .filter((f) => /^chapter_.*\.xml$/.test(f))
    .sort();
};
