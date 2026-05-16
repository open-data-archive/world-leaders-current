/**
 * update-country.js
 *
 * Builds the current.json for a single country by:
 * 1. Wikipedia infobox (PRIMARY) — get current incumbent name + since date
 * 2. Wikidata (ENRICHMENT) — get DOB, party, local name, Wikipedia URLs
 */

import {
  fetchPersonEntity,
  fetchPersonByName
} from './fetch-wikidata.js';
import { fetchArticleHTML } from './fetch-wikipedia.js';
import { parseOfficeInfobox } from './parse-infobox.js';

const DELAY_MS = 200;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Build current.json data for one country.
 */
export async function updateCountry(countryCode, countryConfig, sparqlResult) {
  const today = new Date().toISOString().split('T')[0];

  const result = {
    country: {
      iso_code: countryConfig.iso_code,
      name_en: countryConfig.name_en,
      name_local: countryConfig.name_local
    },
    snapshot_date: today,
    data_source: 'Wikipedia',
    positions: {},
    last_change: null
  };

  // Process head_of_government
  const hogConfig = countryConfig.positions.head_of_government;
  result.positions.head_of_government = await buildPosition(
    countryConfig, hogConfig, sparqlResult
  );

  await sleep(DELAY_MS);

  // Process head_of_state
  const hosConfig = countryConfig.positions.head_of_state;
  if (hosConfig._reference === 'head_of_government') {
    result.positions.head_of_state = {
      ...result.positions.head_of_government,
      title_en: hosConfig.title_en,
      is_same_as_head_of_state: true
    };
  } else {
    result.positions.head_of_state = await buildPosition(
      countryConfig, hosConfig, sparqlResult
    );
  }

  // Determine data source label
  const hogEnriched = result.positions.head_of_government?._enrichedWithWikidata;
  const hosEnriched = result.positions.head_of_state?._enrichedWithWikidata;
  if (hogEnriched || hosEnriched) {
    result.data_source = 'Wikipedia+Wikidata';
  }

  // Clean up internal flags
  delete result.positions.head_of_government?._enrichedWithWikidata;
  delete result.positions.head_of_state?._enrichedWithWikidata;

  return result;
}

/**
 * Build position data for one role.
 *
 * Flow:
 * 1. Fetch Wikipedia infobox → get incumbent name + since date
 * 2. Search Wikidata for that person → get DOB, party, local name, URLs
 */
async function buildPosition(countryConfig, posConfig, sparqlResult) {
  const localLang = countryConfig.local_lang;
  let incumbentName = null;
  let sinceDate = null;
  let wikiUrl = null;
  let enrichedWithWikidata = false;

  // === Step 1: Wikipedia infobox (PRIMARY) ===
  if (posConfig.wiki_article_en) {
    const html = await fetchArticleHTML(posConfig.wiki_article_en, 'en');
    if (html) {
      const parsed = parseOfficeInfobox(html);
      if (parsed) {
        incumbentName = parsed.name;
        sinceDate = parsed.since;
        wikiUrl = parsed.wikiUrl;
      }
    }
    await sleep(DELAY_MS);
  }

  if (!incumbentName) {
    console.warn(`  Could not parse incumbent for ${posConfig.title_en}`);
    return {
      title_en: posConfig.title_en,
      title_local: posConfig.title_local || null,
      current_holder: null
    };
  }

  // === Step 2: Wikidata enrichment ===
  // Find the Wikidata entity for the CURRENT incumbent (from Wikipedia URL).
  // Do NOT use SPARQL result here — it may be outdated.
  let person = null;

  // Option A: use person_qid_override from config (for special entities)
  if (posConfig.person_qid_override) {
    person = await fetchPersonEntity(posConfig.person_qid_override, localLang);
    await sleep(DELAY_MS);
  }

  // Option B: use Wikipedia URL from infobox to find correct Wikidata entity
  if (!person && wikiUrl) {
    person = await fetchPersonByName(wikiUrl, localLang);
    await sleep(DELAY_MS);
  }

  if (person) {
    enrichedWithWikidata = true;
  }

  // === Step 3: Try local Wikipedia for local name (if Wikidata didn't have it) ===
  let nameLocal = person?.name_local || null;
  if (!nameLocal && posConfig.wiki_article_local && localLang !== 'en') {
    const localHtml = await fetchArticleHTML(posConfig.wiki_article_local, localLang);
    if (localHtml) {
      const localParsed = parseOfficeInfobox(localHtml);
      if (localParsed?.name) {
        nameLocal = localParsed.name;
      }
    }
    await sleep(DELAY_MS);
  }

  // === Build result ===
  // Note: tenure_days and age are NOT stored — they change daily and cause unnecessary diffs.
  // They are computed at render time in templates instead.
  const position = {
    title_en: posConfig.title_en,
    title_local: posConfig.title_local || null,
    current_holder: {
      name_en: incumbentName,
      name_local: nameLocal,
      wikidata_id: person?.wikidata_id || null,
      since: sinceDate || null,
      party: person?.party || null,
      party_local: person?.party_local || null,
      born: person?.born || null,
      wikipedia_en: wikiUrl || person?.wikipedia_en || null,
      wikipedia_local: person?.wikipedia_local || null
    },
    office_wikipedia_en: posConfig.wiki_article_en
      ? `https://en.wikipedia.org/wiki/${posConfig.wiki_article_en}`
      : null,
    office_wikipedia_local: posConfig.wiki_article_local
      ? `https://${countryConfig.local_lang}.wikipedia.org/wiki/${posConfig.wiki_article_local}`
      : null,
    _enrichedWithWikidata: enrichedWithWikidata
  };

  if (posConfig.is_monarchy) position.is_monarchy = true;
  if (posConfig.is_same_as_head_of_state) position.is_same_as_head_of_state = true;

  return position;
}

export default updateCountry;
