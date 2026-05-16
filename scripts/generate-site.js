/**
 * generate-site.js — Standalone HTML generation
 *
 * Usage:
 *   node generate-site.js          → for GitHub Pages (prefix /world-leaders-current/)
 *   node generate-site.js --local  → for local preview (prefix /)
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateHTML } from './generate-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const config = JSON.parse(await readFile(join(ROOT, 'build', 'config', 'countries.json'), 'utf-8'));
const allData = {};
for (const code of Object.keys(config)) {
  try {
    allData[code] = JSON.parse(await readFile(join(ROOT, 'data', 'countries', code, 'current.json'), 'utf-8'));
  } catch {}
}

await generateHTML(allData, config);
