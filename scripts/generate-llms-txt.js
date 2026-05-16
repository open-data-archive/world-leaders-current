/**
 * generate-llms-txt.js
 *
 * Generates docs/llms.txt and docs/llms-full.txt for AI navigation.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATES = join(ROOT, 'build', 'templates');
const DOCS = join(ROOT, 'docs');

/**
 * Generate llms.txt and llms-full.txt
 */
export async function generateLlmsTxt(allCountryData, countriesConfig) {
  await mkdir(DOCS, { recursive: true });

  const lastUpdated = new Date().toISOString().split('T')[0];
  const countriesCount = Object.keys(allCountryData).length;

  // Build leaders summary
  const leaders = {};
  const aseanList = [];
  const g20List = [];

  for (const [code, config] of Object.entries(countriesConfig)) {
    const data = allCountryData[code];
    if (!data) continue;

    const hog = data.positions?.head_of_government?.current_holder;
    const hos = data.positions?.head_of_state?.current_holder;

    leaders[code] = {
      name_en: config.name_en,
      head_of_government: hog?.name_en || '?',
      head_of_state: hos?.name_en || hog?.name_en || '?'
    };

    if (config.region.includes('asean')) aseanList.push(config.name_en);
    if (config.region.includes('g20')) g20List.push(config.name_en);
  }

  // llms.txt
  const llmsTemplate = await readFile(join(TEMPLATES, 'llms-txt.ejs'), 'utf-8');
  const llmsTxt = ejs.render(llmsTemplate, {
    lastUpdated, countriesCount, leaders, aseanList, g20List
  }, { filename: join(TEMPLATES, 'llms-txt.ejs') });
  await writeFile(join(DOCS, 'llms.txt'), llmsTxt);

  // llms-full.txt
  const fullTemplate = await readFile(join(TEMPLATES, 'llms-full-txt.ejs'), 'utf-8');
  const fullTxt = ejs.render(fullTemplate, {
    lastUpdated, countriesCount, allData: allCountryData
  }, { filename: join(TEMPLATES, 'llms-full-txt.ejs') });
  await writeFile(join(DOCS, 'llms-full.txt'), fullTxt);

  console.log('Generated llms.txt and llms-full.txt');
}

export default generateLlmsTxt;
