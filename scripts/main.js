/**
 * main.js — Daily orchestrator
 *
 * Runs daily via GitHub Actions to:
 * 1. Fetch current leaders from Wikidata (+ Wikipedia fallback)
 * 2. Detect changes vs previous snapshot
 * 3. Update data files and READMEs
 * 4. Save daily snapshot
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { fetchAllLeadersSPARQL } from './fetch-wikidata.js';
import { updateCountry } from './update-country.js';
import { detectChanges, appendChanges, validateChange } from './detect-changes.js';
import { generateAll } from './generate-readmes.js';
import { generateLlmsTxt } from './generate-llms-txt.js';
import { generateHTML } from './generate-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'build', 'config', 'countries.json');
const DATA = join(ROOT, 'data');
const ALL_LEADERS_PATH = join(DATA, 'current', 'all-leaders.json');

const DELAY_MS = 200;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`=== Daily Update: ${today} ===\n`);

  // Step 1: Load config
  console.log('Step 1: Loading config...');
  const countriesConfig = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));

  // Step 2: Fetch from Wikidata
  console.log('Step 2: Fetching from Wikidata SPARQL...');
  let sparqlResults;
  try {
    sparqlResults = await fetchAllLeadersSPARQL(countriesConfig);
    console.log(`  Got ${Object.keys(sparqlResults).length} results.\n`);
  } catch (err) {
    console.error(`  SPARQL failed: ${err.message}`);
    sparqlResults = {};
  }

  // Step 3: Update each country
  console.log('Step 3: Updating countries...');
  const allCountryData = {};
  let successCount = 0;
  let failCount = 0;

  for (const [code, config] of Object.entries(countriesConfig)) {
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
        successCount++;
      } else {
        // Preserve previous data if fetch failed
        const prevPath = join(DATA, 'countries', code, 'current.json');
        if (existsSync(prevPath)) {
          allCountryData[code] = JSON.parse(await readFile(prevPath, 'utf-8'));
          console.warn(`  ${config.name_en}: using previous data`);
        }
        failCount++;
      }
    } catch (err) {
      console.error(`  ${config.name_en}: ${err.message}`);
      // Try to preserve previous
      const prevPath = join(DATA, 'countries', code, 'current.json');
      if (existsSync(prevPath)) {
        allCountryData[code] = JSON.parse(await readFile(prevPath, 'utf-8'));
      }
      failCount++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`  ${successCount} updated, ${failCount} failed.\n`);

  if (failCount > 5) {
    console.error('Too many failures (>5). Something is systematically wrong. Aborting.');
    process.exit(1);
  }

  // Step 4: Detect changes
  console.log('Step 4: Detecting changes...');
  const changes = await detectChanges(allCountryData, ALL_LEADERS_PATH);

  // Validate changes (anti-vandalism)
  const validChanges = [];
  for (const change of changes) {
    const validation = validateChange(change);
    if (validation.valid) {
      validChanges.push(change);
    } else {
      console.warn(`  Suspicious change skipped for ${change.country_name_en}: ${validation.warnings.join(', ')}`);
    }
  }

  // Append valid changes to year file
  if (validChanges.length > 0) {
    const changesDir = join(DATA, 'changes');
    await mkdir(changesDir, { recursive: true });
    const yearData = await appendChanges(validChanges, changesDir);
    if (yearData) {
      await writeFile(join(changesDir, `${yearData.year}.json`),
        JSON.stringify(yearData, null, 2));
    }
  }

  // Step 5: Save snapshot
  console.log('Step 5: Saving snapshot...');
  const [y, m] = today.split('-');
  const snapshotDir = join(ROOT, 'snapshots', y, m);
  await mkdir(snapshotDir, { recursive: true });
  await writeFile(join(snapshotDir, `${today}.json`),
    JSON.stringify({
      snapshot_date: today,
      captured_at: new Date().toISOString(),
      countries: allCountryData
    }, null, 2));

  // Step 6: Generate READMEs
  console.log('Step 6: Generating READMEs...');
  const changedCountries = new Set(validChanges.map(c => c.country));
  await generateAll(allCountryData, countriesConfig, validChanges, {
    changedCountries,
    forceAll: validChanges.length > 0 // regenerate all if any change
  });

  // Step 7: Generate llms.txt
  console.log('Step 7: Generating llms.txt...');
  await generateLlmsTxt(allCountryData, countriesConfig);

  // Step 8: Generate HTML site + static API
  console.log('Step 8: Generating HTML + static API...');
  await generateHTML(allCountryData, countriesConfig);

  console.log(`\n=== Daily Update Complete ===`);
  if (validChanges.length > 0) {
    console.log(`  Changes detected: ${validChanges.length}`);
    for (const c of validChanges) {
      console.log(`  - ${c.country_name_en}: ${c.new_holder_en} (${c.position_title})`);
    }
  } else {
    console.log('  No changes detected.');
  }
}

main().catch(err => {
  console.error('Daily update failed:', err);
  process.exit(1);
});
