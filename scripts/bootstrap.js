/**
 * bootstrap.js — Initial setup
 *
 * Fetches all 28 countries from Wikidata/Wikipedia,
 * generates all data files and READMEs from scratch.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { fetchAllLeadersSPARQL } from './fetch-wikidata.js';
import { updateCountry } from './update-country.js';
import { generateAll } from './generate-readmes.js';
import { generateLlmsTxt } from './generate-llms-txt.js';
import { generateHTML } from './generate-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'build', 'config', 'countries.json');
const DATA = join(ROOT, 'data');

const DELAY_MS = 200;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== World Leaders Bootstrap ===\n');

  // Step 1: Load config
  console.log('Step 1: Loading countries config...');
  const countriesConfig = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  const countryCount = Object.keys(countriesConfig).length;
  console.log(`  Loaded ${countryCount} countries.\n`);

  // Step 2: Fetch all leaders via SPARQL
  console.log('Step 2: Fetching leaders from Wikidata SPARQL...');
  let sparqlResults;
  try {
    sparqlResults = await fetchAllLeadersSPARQL(countriesConfig);
    console.log(`  SPARQL returned data for ${Object.keys(sparqlResults).length} entities.\n`);
  } catch (err) {
    console.error(`  SPARQL failed: ${err.message}`);
    console.log('  Will rely on fallback for all countries.\n');
    sparqlResults = {};
  }

  // Step 3: Update each country
  console.log('Step 3: Building country data...');
  const allCountryData = {};
  let successCount = 0;
  let failCount = 0;

  for (const [code, config] of Object.entries(countriesConfig)) {
    process.stdout.write(`  ${config.name_en}... `);

    try {
      const sparqlData = sparqlResults[config.wikidata_id] || null;
      const countryData = await updateCountry(code, config, sparqlData);

      if (countryData) {
        allCountryData[code] = countryData;

        // Save current.json
        const countryDir = join(DATA, 'countries', code);
        await mkdir(countryDir, { recursive: true });
        await writeFile(join(countryDir, 'current.json'),
          JSON.stringify(countryData, null, 2));

        // Initialize empty history and changes
        await writeFile(join(countryDir, 'history.json'),
          JSON.stringify({
            country: config.name_en,
            head_of_government_history: [],
            head_of_state_history: []
          }, null, 2));

        await writeFile(join(countryDir, 'changes.json'),
          JSON.stringify({ country: config.name_en, changes: [] }, null, 2));

        const hogName = countryData.positions?.head_of_government?.current_holder?.name_en;
        const hosName = countryData.positions?.head_of_state?.current_holder?.name_en;
        console.log(`HoG: ${hogName || '?'}, HoS: ${hosName || '?'} [${countryData.data_source}]`);
        successCount++;
      } else {
        console.log('SKIPPED (no data)');
        failCount++;
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failCount++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n  Results: ${successCount} success, ${failCount} failed.\n`);

  if (failCount > 5) {
    console.error('Too many failures (>5). Check network/API. Aborting.');
    process.exit(1);
  }

  // Step 4: Initialize changes log
  console.log('Step 4: Initializing changes log...');
  const changesDir = join(DATA, 'changes');
  await mkdir(changesDir, { recursive: true });
  const year = new Date().getFullYear().toString();
  await writeFile(join(changesDir, `${year}.json`),
    JSON.stringify({ year: parseInt(year), changes: [] }, null, 2));

  // Step 5: Save daily snapshot
  console.log('Step 5: Saving daily snapshot...');
  const today = new Date().toISOString().split('T')[0];
  const [y, m] = today.split('-');
  const snapshotDir = join(ROOT, 'snapshots', y, m);
  await mkdir(snapshotDir, { recursive: true });
  await writeFile(join(snapshotDir, `${today}.json`),
    JSON.stringify({
      snapshot_date: today,
      captured_at: new Date().toISOString(),
      countries: allCountryData
    }, null, 2));

  // Step 6: Generate all READMEs
  console.log('Step 6: Generating READMEs...');
  await generateAll(allCountryData, countriesConfig, [], { forceAll: true });

  // Step 7: Generate llms.txt
  console.log('Step 7: Generating llms.txt...');
  await generateLlmsTxt(allCountryData, countriesConfig);

  // Step 8: Generate HTML site + static API
  console.log('Step 8: Generating HTML site + static API...');
  await generateHTML(allCountryData, countriesConfig);

  // Step 9: Generate docs
  console.log('Step 9: Setting up docs...');
  const docsDir = join(ROOT, 'docs');
  await mkdir(docsDir, { recursive: true });

  await writeFile(join(docsDir, 'methodology.md'), `# Methodology

## Data Collection

This repository collects data on current world leaders using a two-tier approach:

### Primary Source: Wikidata
- Structured, machine-readable data via SPARQL queries and Entity API
- Properties used: P6 (head of government), P35 (head of state), P569 (date of birth), P102 (political party)
- Labels available in all languages — no per-language parsing needed

### Fallback Source: Wikipedia
- Used only when Wikidata is missing specific fields
- Parses English Wikipedia infobox "Incumbent" field using Cheerio
- Local language Wikipedia used for local name extraction when needed

## Update Schedule
- Daily at 12:00 UTC via GitHub Actions
- Change detection compares current data vs previous snapshot
- Only affected files are regenerated

## Attribution
All data sourced from Wikidata and Wikipedia under CC-BY-SA-4.0 license.
`);

  await writeFile(join(docsDir, 'disclaimer.md'), `# Disclaimer

## Data Source
All data in this repository is sourced from Wikidata and Wikipedia via their free, public APIs.

## Accuracy
While we strive for accuracy, this data reflects what is published on Wikidata/Wikipedia at the time of each daily snapshot. For the most current information, always refer to the original sources.

## License
This work is licensed under CC-BY-SA-4.0, matching the license of Wikipedia and Wikidata.

## No Political Stance
This repository does not take political stances. For countries with disputed leadership (e.g., Myanmar), we follow Wikidata/Wikipedia's representation.

## Not a Replacement
This repository supplements, not replaces, Wikipedia and Wikidata. Always verify critical information against the original sources.
`);

  console.log('\n=== Bootstrap Complete ===');
  console.log(`  Countries: ${successCount}/${countryCount}`);
  console.log(`  Snapshot: snapshots/${y}/${m}/${today}.json`);
  console.log(`  READMEs: generated for all countries`);
}

main().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
