/**
 * generate-readmes.js
 *
 * Renders all README.md files from EJS templates + data.
 * Also generates aggregate JSON/CSV files.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATES = join(ROOT, 'build', 'templates');
const DATA = join(ROOT, 'data');
const CONFIG_PATH = join(ROOT, 'build', 'config', 'countries.json');
const AI_CONTENT = join(ROOT, 'build', 'ai-content', 'countries');

// Country flag emoji lookup (ISO 2-letter → flag)
const FLAGS = {};
function isoToFlag(iso) {
  if (!iso || iso.length < 2) return '';
  // Special entities
  if (iso === 'EU') return '\u{1F1EA}\u{1F1FA}';
  if (iso === 'AU_AF') return '\u{1F30D}';
  const code = iso.substring(0, 2).toUpperCase();
  return String.fromCodePoint(
    ...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

/**
 * Generate all output files from current data.
 *
 * @param {object} allCountryData — { countryCode: current.json content }
 * @param {object} countriesConfig — from countries.json
 * @param {Array} changes — detected changes (may be empty)
 * @param {object} options — { changedCountries: Set, forceAll: boolean }
 */
export async function generateAll(allCountryData, countriesConfig, changes = [], options = {}) {
  const { changedCountries = new Set(), forceAll = false } = options;
  const lastUpdated = new Date().toISOString().split('T')[0];

  // Build leaders summary for templates
  const leaders = buildLeadersSummary(allCountryData, countriesConfig);
  const flags = buildFlags(countriesConfig);
  const countriesCount = Object.keys(allCountryData).length;

  // --- Aggregate data files (always) ---
  await generateAggregateFiles(allCountryData, countriesConfig, leaders, lastUpdated);

  // --- Country READMEs ---
  for (const [code, config] of Object.entries(countriesConfig)) {
    if (!forceAll && !changedCountries.has(code)) continue;
    if (!allCountryData[code]) continue;

    await generateCountryReadme(code, config, allCountryData[code], changes, lastUpdated, flags);
  }

  // If forceAll, generate all country READMEs
  if (forceAll) {
    for (const [code, config] of Object.entries(countriesConfig)) {
      if (!allCountryData[code]) continue;
      await generateCountryReadme(code, config, allCountryData[code], changes, lastUpdated, flags);
    }
  }

  // --- Always-regenerate READMEs ---
  await generateFromTemplate('root-readme.ejs', join(ROOT, 'README.md'), {
    leaders, flags, lastUpdated, countriesCount,
    recentChanges: changes
  });

  await generateFromTemplate('current-readme.ejs', join(DATA, 'current', 'README.md'), {
    leaders, flags, lastUpdated, countriesCount
  });

  await generateCountriesIndex(leaders, countriesConfig, flags, lastUpdated);
  await generateRegionReadmes(allCountryData, countriesConfig, leaders, flags, lastUpdated);
  await generateChangesReadme(lastUpdated);
  await generateByPositionReadmes(allCountryData, countriesConfig, flags, lastUpdated);

  console.log('All READMEs generated.');
}

async function generateCountryReadme(code, config, data, changes, lastUpdated, flags) {
  const countryChanges = changes.filter(c => c.country === code);

  // Load AI content if exists
  let aiContent = null;
  const aiPath = join(AI_CONTENT, `${code}-context.md`);
  if (existsSync(aiPath)) {
    aiContent = await readFile(aiPath, 'utf-8');
  }

  const localWikiLabel = config.local_lang !== 'en'
    ? `Wikipedia ${config.name_local}`
    : 'Wikipedia';

  const dir = join(DATA, 'countries', code);
  await mkdir(dir, { recursive: true });

  await generateFromTemplate('country-readme.ejs', join(dir, 'README.md'), {
    config, data, changes: countryChanges, aiContent,
    lastUpdated, flags, localWikiLabel
  });
}

async function generateCountriesIndex(leaders, countriesConfig, flags, lastUpdated) {
  const asean = [];
  const g20 = [];

  for (const [code, config] of Object.entries(countriesConfig)) {
    const entry = [code, { ...leaders[code], government_system: formatSystem(config.government_system) }];
    if (config.region.includes('asean')) asean.push(entry);
    if (config.region.includes('g20')) g20.push(entry);
  }

  await generateFromTemplate('countries-index-readme.ejs',
    join(DATA, 'countries', 'README.md'), {
      asean, g20, flags, lastUpdated
    });
}

async function generateRegionReadmes(allCountryData, countriesConfig, allLeaders, flags, lastUpdated) {
  const regions = {
    asean: { name: 'ASEAN', countries: {} },
    g20: { name: 'G20', countries: {} }
  };

  for (const [code, config] of Object.entries(countriesConfig)) {
    for (const region of config.region) {
      if (regions[region]) {
        regions[region].countries[code] = allLeaders[code];
      }
    }
  }

  for (const [regionKey, region] of Object.entries(regions)) {
    const dir = join(DATA, 'by-region', regionKey);
    await mkdir(dir, { recursive: true });

    const otherRegions = Object.entries(regions)
      .filter(([k]) => k !== regionKey)
      .map(([k, v]) => ({ key: k, name: v.name }));

    await generateFromTemplate('region-readme.ejs', join(dir, 'README.md'), {
      regionName: region.name,
      leaders: region.countries,
      flags, lastUpdated, otherRegions
    });

    // Region JSON
    await writeFile(join(dir, 'leaders.json'),
      JSON.stringify(region.countries, null, 2));

    // Region CSV
    const csv = leadersToCsv(region.countries);
    await writeFile(join(dir, 'leaders.csv'), csv);
  }
}

async function generateChangesReadme(lastUpdated) {
  const changesDir = join(DATA, 'changes');
  await mkdir(changesDir, { recursive: true });

  const changesByYear = {};
  const currentYear = new Date().getFullYear();

  for (let year = currentYear; year >= currentYear - 2; year--) {
    const filePath = join(changesDir, `${year}.json`);
    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(await readFile(filePath, 'utf-8'));
        changesByYear[year] = data.changes || [];
      } catch {
        changesByYear[year] = [];
      }
    } else {
      changesByYear[year] = [];
    }
  }

  await generateFromTemplate('changes-readme.ejs', join(changesDir, 'README.md'), {
    changesByYear, lastUpdated
  });
}

async function generateByPositionReadmes(allCountryData, countriesConfig, flags, lastUpdated) {
  const dir = join(DATA, 'by-position');
  await mkdir(dir, { recursive: true });

  const positions = {
    presidents: { title: 'President', leaders: [] },
    'prime-ministers': { title: 'Prime Minister', leaders: [] },
    monarchs: { title: 'Monarch', leaders: [] },
    chancellors: { title: 'Chancellor', leaders: [] }
  };

  for (const [code, data] of Object.entries(allCountryData)) {
    const config = countriesConfig[code];
    for (const [posKey, pos] of Object.entries(data.positions)) {
      if (!pos?.current_holder) continue;
      if (pos.is_same_as_head_of_state && posKey === 'head_of_state') continue;

      const titleLower = pos.title_en.toLowerCase();
      let bucket;
      if (titleLower.includes('chancellor')) bucket = 'chancellors';
      else if (titleLower.includes('prime minister') || titleLower.includes('premier')) bucket = 'prime-ministers';
      else if (titleLower.includes('king') || titleLower.includes('queen') || titleLower.includes('emperor') || titleLower.includes('sultan') || titleLower.includes('monarch') || pos.is_monarchy) bucket = 'monarchs';
      else bucket = 'presidents';

      positions[bucket].leaders.push({
        country_code: code,
        country_name: config.name_en,
        iso_code: config.iso_code,
        name: pos.current_holder.name_en,
        since: pos.current_holder.since
      });
    }
  }

  for (const [filename, posData] of Object.entries(positions)) {
    if (posData.leaders.length === 0) continue;

    await generateFromTemplate('by-position-readme.ejs',
      join(dir, 'README.md').replace('README.md', `${filename}.md`),
      // Actually let's put all in one README
      { positionTitle: posData.title, leaders: posData.leaders, flags, lastUpdated, filename: `${filename}.json` }
    );

    await writeFile(join(dir, `${filename}.json`),
      JSON.stringify(posData.leaders, null, 2));
  }

  // Index README
  const indexContent = `# Leaders by Position\n\n> Last updated: ${lastUpdated}\n\n` +
    Object.entries(positions)
      .filter(([, v]) => v.leaders.length > 0)
      .map(([k, v]) => `- [${v.title}s](${k}.md) (${v.leaders.length})`)
      .join('\n') +
    '\n\n## Related\n\n- [All countries](../countries/)\n- [By region](../by-region/)\n';

  await writeFile(join(dir, 'README.md'), indexContent);
}

async function generateAggregateFiles(allCountryData, countriesConfig, leaders, lastUpdated) {
  const currentDir = join(DATA, 'current');
  await mkdir(currentDir, { recursive: true });

  // all-leaders.json
  const allLeadersJson = {
    snapshot_date: lastUpdated,
    captured_at: new Date().toISOString(),
    countries_count: Object.keys(allCountryData).length,
    leaders: {}
  };

  for (const [code, data] of Object.entries(allCountryData)) {
    const hog = data.positions?.head_of_government?.current_holder;
    const hos = data.positions?.head_of_state?.current_holder;
    const isSame = data.positions?.head_of_government?.is_same_as_head_of_state;

    allLeadersJson.leaders[code] = {
      head_of_government: hog?.name_en || null,
      head_of_government_since: hog?.since || null,
      head_of_state: hos?.name_en || hog?.name_en || null,
      head_of_state_since: hos?.since || hog?.since || null,
      is_same: isSame || false
    };
  }

  await writeFile(join(currentDir, 'all-leaders.json'),
    JSON.stringify(allLeadersJson, null, 2));

  // all-leaders.csv
  const csv = leadersToCsv(leaders);
  await writeFile(join(currentDir, 'all-leaders.csv'), csv);

  // last-updated.json
  await writeFile(join(currentDir, 'last-updated.json'),
    JSON.stringify({ last_updated: new Date().toISOString(), snapshot_date: lastUpdated }, null, 2));

  // by-position.json
  const byPosition = { presidents: [], prime_ministers: [], monarchs: [], chancellors: [] };
  for (const [code, data] of Object.entries(allCountryData)) {
    for (const [, pos] of Object.entries(data.positions)) {
      if (!pos?.current_holder) continue;
      const titleLower = (pos.title_en || '').toLowerCase();
      const entry = { country: code, ...pos.current_holder };
      if (titleLower.includes('chancellor')) byPosition.chancellors.push(entry);
      else if (titleLower.includes('prime') || titleLower.includes('premier')) byPosition.prime_ministers.push(entry);
      else if (pos.is_monarchy) byPosition.monarchs.push(entry);
      else byPosition.presidents.push(entry);
    }
  }
  await writeFile(join(currentDir, 'by-position.json'),
    JSON.stringify(byPosition, null, 2));
}

// --- Helpers ---

function buildLeadersSummary(allCountryData, countriesConfig) {
  const leaders = {};
  for (const [code, data] of Object.entries(allCountryData)) {
    const config = countriesConfig[code];
    const hog = data.positions?.head_of_government?.current_holder;
    const hos = data.positions?.head_of_state?.current_holder;
    const isSame = data.positions?.head_of_government?.is_same_as_head_of_state;

    leaders[code] = {
      iso_code: config.iso_code,
      name_en: config.name_en,
      head_of_government: hog?.name_en || null,
      hog_title: data.positions?.head_of_government?.title_en || null,
      hog_since: hog?.since || null,
      head_of_state: hos?.name_en || (isSame ? hog?.name_en : null),
      hos_title: data.positions?.head_of_state?.title_en || (isSame ? data.positions?.head_of_government?.title_en : null),
      hos_since: hos?.since || (isSame ? hog?.since : null),
      head_of_state_display: isSame
        ? `(Same — ${data.positions.head_of_government.title_en})`
        : (hos?.name_en || null)
    };
  }
  return leaders;
}

function buildFlags(countriesConfig) {
  const flags = {};
  for (const config of Object.values(countriesConfig)) {
    flags[config.iso_code] = isoToFlag(config.iso_code);
  }
  return flags;
}

function formatSystem(system) {
  return (system || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function leadersToCsv(leaders) {
  const rows = [['Country', 'ISO', 'HoG Title', 'Head of Government', 'HoG Since', 'HoS Title', 'Head of State', 'HoS Since']];
  for (const [code, l] of Object.entries(leaders)) {
    rows.push([
      l.name_en || code,
      l.iso_code || '',
      l.hog_title || '',
      l.head_of_government || '',
      l.hog_since || '',
      l.hos_title || '',
      l.head_of_state || l.head_of_state_display || '',
      l.hos_since || ''
    ]);
  }
  return rows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

async function generateFromTemplate(templateFile, outputPath, data) {
  const templatePath = join(TEMPLATES, templateFile);
  const template = await readFile(templatePath, 'utf-8');
  const content = ejs.render(template, data, { filename: templatePath });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content);
}

export default generateAll;
