const { readdirSync } = require("fs");
const { resolve } = require("path");

module.exports = function () {
  const root = resolve(__dirname, "../..");
  return readdirSync(root)
    .filter((f) => /^chapter_.*\.xml$/.test(f))
    .sort();
};
