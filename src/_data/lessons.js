const rawData = require('./lessons-raw.json');

const allSections = {};

function processSection(section) {
  if (allSections[section.id]) return;
  allSections[section.id] = section;
  for (const item of section.content || []) {
    if (item.contentType === 'section' && item.section) {
      processSection(item.section);
    }
  }
}

for (const sectionId of Object.keys(rawData.sections)) {
  processSection(rawData.sections[sectionId]);
}

module.exports = {
  topSectionIds: rawData.topSectionIds.map(id => String(id)),
  allSections,
};
