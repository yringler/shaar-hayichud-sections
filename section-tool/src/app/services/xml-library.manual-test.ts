/**
 * Manual integration test for XmlLibraryService.
 * Requires the dev server running at http://localhost:8080 with xml/index.json.
 *
 * Run with:
 *   npx ts-node --esm src/app/services/xml-library.manual-test.ts
 * Or via Node (after tsc):
 *   node dist/xml-library.manual-test.js
 *
 * This test intentionally excluded from CI (no dev server available).
 */

const BASE_URL = 'http://localhost:8080';
const INDEX_URL = `${BASE_URL}/xml/index.json`;

async function run(): Promise<void> {
  console.log('--- XmlLibraryService manual test ---\n');

  // Step 1: Fetch file list
  console.log(`Fetching index: ${INDEX_URL}`);
  const indexResponse = await fetch(INDEX_URL);
  if (!indexResponse.ok) {
    throw new Error(`Index fetch failed: ${indexResponse.status} ${indexResponse.statusText}`);
  }

  const files = await indexResponse.json() as string[];
  console.log(`Got ${files.length} file(s):`);
  files.forEach((f, i) => console.log(`  [${i}] ${f}`));

  if (files.length === 0) {
    console.log('\nNo files to load. Done.');
    return;
  }

  // Step 2: Load first file
  const first = files[0];
  const fileUrl = `${BASE_URL}/xml/${first}`;
  console.log(`\nLoading first file: ${fileUrl}`);
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`File fetch failed: ${fileResponse.status} ${fileResponse.statusText}`);
  }

  const xml = await fileResponse.text();
  console.log(`Received ${xml.length} chars. First 200:\n`);
  console.log(xml.slice(0, 200));

  console.log('\n--- All checks passed ---');
}

run().catch((err) => {
  console.error('\nTest FAILED:', err);
  process.exit(1);
});
