/**
 * generate-html.js
 *
 * Generates GitHub Pages static site + static API files.
 * Output: docs/ folder (served by GitHub Pages)
 */

import { readFile, writeFile, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATES = join(ROOT, 'build', 'templates', 'html');
const DOCS = join(ROOT, 'docs');
const AI_CONTENT = join(ROOT, 'build', 'ai-content', 'countries');
const BASE_URL = 'https://open-data-archive.github.io/world-leaders-current';

function isoToFlag(iso) {
  if (!iso || iso.length < 2) return '';
  if (iso === 'EU') return '\u{1F1EA}\u{1F1FA}';
  if (iso === 'AU_AF') return '\u{1F30D}';
  const code = iso.substring(0, 2).toUpperCase();
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

/**
 * Generate all HTML pages and static API files.
 */
export async function generateHTML(allCountryData, countriesConfig) {
  const snapshotDate = new Date().toISOString().split('T')[0];
  const countriesCount = Object.keys(allCountryData).length;

  // Build flags + leaders summary
  const flags = {};
  const leaders = {};
  for (const [code, config] of Object.entries(countriesConfig)) {
    flags[config.iso_code] = isoToFlag(config.iso_code);
    const data = allCountryData[code];
    if (!data) continue;
    const hog = data.positions?.head_of_government?.current_holder;
    const hos = data.positions?.head_of_state?.current_holder;
    const isSame = data.positions?.head_of_government?.is_same_as_head_of_state;
    leaders[code] = {
      iso_code: config.iso_code,
      name_en: config.name_en,
      head_of_government: hog?.name_en || null,
      hog_title: data.positions?.head_of_government?.title_en || null,
      head_of_state: hos?.name_en || (isSame ? hog?.name_en : null),
      hos_title: data.positions?.head_of_state?.title_en || null,
      head_of_state_display: isSame ? `(Same — ${data.positions.head_of_government.title_en})` : null
    };
  }

  // Load templates
  const layoutTpl = await readFile(join(TEMPLATES, 'layout.ejs'), 'utf-8');
  const indexTpl = await readFile(join(TEMPLATES, 'index.ejs'), 'utf-8');
  const countryTpl = await readFile(join(TEMPLATES, 'country.ejs'), 'utf-8');

  // --- Index page ---
  const indexContent = ejs.render(indexTpl, { leaders, flags, snapshotDate, countriesCount }, { filename: join(TEMPLATES, 'index.ejs') });
  const indexJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'World Leaders Current',
    description: 'Current heads of state and government for ASEAN + G20 countries, updated daily from Wikipedia.',
    url: BASE_URL,
    license: 'https://creativecommons.org/licenses/by-sa/4.0/',
    dateModified: snapshotDate
  });
  const indexHtml = ejs.render(layoutTpl, {
    title: 'World Leaders Current — Heads of State & Government (ASEAN + G20)',
    description: 'Daily-updated list of current world leaders for ASEAN and G20 countries, sourced from Wikipedia.',
    canonical: '',
    jsonLd: indexJsonLd,
    content: indexContent,
    snapshotDate
  }, { filename: join(TEMPLATES, 'layout.ejs') });

  await mkdir(DOCS, { recursive: true });
  await writeFile(join(DOCS, 'index.html'), indexHtml);

  // --- Country pages ---
  const countriesDir = join(DOCS, 'countries');
  await mkdir(countriesDir, { recursive: true });

  for (const [code, config] of Object.entries(countriesConfig)) {
    const data = allCountryData[code];
    if (!data) continue;

    const flag = flags[config.iso_code] || '';
    let aiContent = null;
    const aiPath = join(AI_CONTENT, `${code}-context.md`);
    if (existsSync(aiPath)) {
      aiContent = (await readFile(aiPath, 'utf-8')).trim();
    }

    const countryContent = ejs.render(countryTpl, {
      config, data, flag, aiContent, snapshotDate, countryCode: code
    }, { filename: join(TEMPLATES, 'country.ejs') });

    const hogName = data.positions?.head_of_government?.current_holder?.name_en;
    const hosName = data.positions?.head_of_state?.current_holder?.name_en;
    const pageTitle = `${config.name_en} — Current Leaders (${hogName || ''}${hosName && hosName !== hogName ? ', ' + hosName : ''})`;

    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: pageTitle,
      description: `Current head of government and head of state of ${config.name_en}, updated daily from Wikipedia.`,
      url: `${BASE_URL}/countries/${code}/`,
      dateModified: snapshotDate
    });

    const html = ejs.render(layoutTpl, {
      title: pageTitle,
      description: `Current leaders of ${config.name_en}: ${hogName || ''} (${data.positions?.head_of_government?.title_en || ''})`,
      canonical: `countries/${code}/`,
      jsonLd: jsonLd,
      content: countryContent,
      snapshotDate
    }, { filename: join(TEMPLATES, 'layout.ejs') });

    const countryDir = join(countriesDir, code);
    await mkdir(countryDir, { recursive: true });
    await writeFile(join(countryDir, 'index.html'), html);
  }

  // --- Countries index page ---
  const countriesIndexContent = `<h2>All Countries</h2>
<ul>
${Object.entries(countriesConfig).map(([code, config]) => {
  const flag = flags[config.iso_code] || '';
  return `  <li>${flag} <a href="/world-leaders-current/countries/${code}/">${config.name_en}</a></li>`;
}).join('\n')}
</ul>`;
  const countriesIndexHtml = ejs.render(layoutTpl, {
    title: 'All Countries — World Leaders Current',
    description: 'Index of all tracked countries with current heads of state and government.',
    canonical: 'countries/',
    jsonLd: '{}',
    content: countriesIndexContent,
    snapshotDate
  }, { filename: join(TEMPLATES, 'layout.ejs') });
  await writeFile(join(countriesDir, 'index.html'), countriesIndexHtml);

  // --- Static API ---
  const apiDir = join(DOCS, 'api', 'v1');
  const apiCountriesDir = join(apiDir, 'countries');
  await mkdir(apiCountriesDir, { recursive: true });

  // /api/v1/all.json
  const allApi = {
    snapshot_date: snapshotDate,
    countries_count: countriesCount,
    leaders: {}
  };
  for (const [code, data] of Object.entries(allCountryData)) {
    const hog = data.positions?.head_of_government;
    const hos = data.positions?.head_of_state;
    allApi.leaders[code] = {
      country: data.country,
      head_of_government: hog?.current_holder ? {
        title: hog.title_en,
        name: hog.current_holder.name_en,
        name_local: hog.current_holder.name_local,
        since: hog.current_holder.since
      } : null,
      head_of_state: hos?.current_holder ? {
        title: hos.title_en,
        name: hos.current_holder.name_en,
        name_local: hos.current_holder.name_local,
        since: hos.current_holder.since
      } : null
    };
  }
  await writeFile(join(apiDir, 'all.json'), JSON.stringify(allApi, null, 2));

  // /api/v1/countries/{code}.json
  for (const [code, data] of Object.entries(allCountryData)) {
    await writeFile(join(apiCountriesDir, `${code}.json`), JSON.stringify(data, null, 2));
  }

  // /api/v1/by-region/
  const apiRegionDir = join(apiDir, 'by-region');
  await mkdir(apiRegionDir, { recursive: true });
  const regions = { asean: {}, g20: {} };
  for (const [code, config] of Object.entries(countriesConfig)) {
    for (const region of config.region) {
      if (regions[region] && allCountryData[code]) {
        regions[region][code] = allApi.leaders[code];
      }
    }
  }
  for (const [region, data] of Object.entries(regions)) {
    await writeFile(join(apiRegionDir, `${region}.json`), JSON.stringify({ region, snapshot_date: snapshotDate, leaders: data }, null, 2));
  }

  // --- Sitemap ---
  const urls = [
    '',
    'countries/',
    ...Object.keys(countriesConfig).map(c => `countries/${c}/`)
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${BASE_URL}/${u}</loc>
    <lastmod>${snapshotDate}</lastmod>
  </url>`).join('\n')}
</urlset>`;
  await writeFile(join(DOCS, 'sitemap.xml'), sitemap);

  // --- robots.txt ---
  await writeFile(join(DOCS, 'robots.txt'), `User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml
`);

  // --- .nojekyll (for GitHub Pages to serve as-is) ---
  await writeFile(join(DOCS, '.nojekyll'), '');

  console.log(`HTML site generated: ${Object.keys(allCountryData).length} country pages + static API`);
}

export default generateHTML;
