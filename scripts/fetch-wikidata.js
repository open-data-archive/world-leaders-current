/**
 * fetch-wikidata.js — Primary data source
 *
 * Fetches current heads of state/government from Wikidata using:
 * 1. SPARQL query to get all leaders at once
 * 2. Entity API for person details (labels, DOB, party, sitelinks)
 */

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const DELAY_MS = 200;

const USER_AGENT = 'WorldLeadersCurrent/1.0 (https://github.com/open-data-archive/world-leaders-current)';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all leaders for given country Wikidata IDs via SPARQL.
 * Returns { countryQid: { hog: personQid, hogStart, hos: personQid, hosStart } }
 */
export async function fetchAllLeadersSPARQL(countriesConfig) {
  const qids = Object.values(countriesConfig)
    .map(c => `wd:${c.wikidata_id}`)
    .join(' ');

  // SPARQL: get current P6 and P35 for each country
  // Prefer PreferredRank, but fall back to NormalRank (no end date)
  const sparql = `
    SELECT ?country ?hog ?hogStart ?hos ?hosStart WHERE {
      VALUES ?country { ${qids} }
      OPTIONAL {
        {
          ?country p:P6 ?hogStmt .
          ?hogStmt ps:P6 ?hog ;
                   wikibase:rank wikibase:PreferredRank .
          OPTIONAL { ?hogStmt pq:P580 ?hogStart . }
          FILTER NOT EXISTS { ?hogStmt pq:P582 ?hogEnd . }
        } UNION {
          ?country p:P6 ?hogStmt .
          ?hogStmt ps:P6 ?hog ;
                   wikibase:rank wikibase:NormalRank .
          OPTIONAL { ?hogStmt pq:P580 ?hogStart . }
          FILTER NOT EXISTS { ?hogStmt pq:P582 ?hogEnd . }
          FILTER NOT EXISTS {
            ?country p:P6 ?prefStmt .
            ?prefStmt wikibase:rank wikibase:PreferredRank .
            FILTER NOT EXISTS { ?prefStmt pq:P582 ?prefEnd . }
          }
        }
      }
      OPTIONAL {
        {
          ?country p:P35 ?hosStmt .
          ?hosStmt ps:P35 ?hos ;
                   wikibase:rank wikibase:PreferredRank .
          OPTIONAL { ?hosStmt pq:P580 ?hosStart . }
          FILTER NOT EXISTS { ?hosStmt pq:P582 ?hosEnd . }
        } UNION {
          ?country p:P35 ?hosStmt .
          ?hosStmt ps:P35 ?hos ;
                   wikibase:rank wikibase:NormalRank .
          OPTIONAL { ?hosStmt pq:P580 ?hosStart . }
          FILTER NOT EXISTS { ?hosStmt pq:P582 ?hosEnd . }
          FILTER NOT EXISTS {
            ?country p:P35 ?prefStmt2 .
            ?prefStmt2 wikibase:rank wikibase:PreferredRank .
            FILTER NOT EXISTS { ?prefStmt2 pq:P582 ?prefEnd2 . }
          }
        }
      }
    }
  `;

  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/sparql-results+json' }
  });

  if (!res.ok) {
    throw new Error(`SPARQL query failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const results = {};

  for (const row of data.results.bindings) {
    const countryQid = row.country.value.split('/').pop();
    if (!results[countryQid]) {
      results[countryQid] = {};
    }
    // Only take first result per property (UNION may return dupes)
    if (row.hog && !results[countryQid].hog) {
      results[countryQid].hog = row.hog.value.split('/').pop();
      results[countryQid].hogStart = row.hogStart?.value?.split('T')[0] || null;
    }
    if (row.hos && !results[countryQid].hos) {
      results[countryQid].hos = row.hos.value.split('/').pop();
      results[countryQid].hosStart = row.hosStart?.value?.split('T')[0] || null;
    }
  }

  return results;
}

/**
 * Fallback SPARQL: try normal rank if preferred rank returned nothing
 */
export async function fetchLeaderNormalRank(countryQid, property) {
  const sparql = `
    SELECT ?person ?start WHERE {
      wd:${countryQid} p:${property} ?stmt .
      ?stmt ps:${property} ?person .
      OPTIONAL { ?stmt pq:P580 ?start . }
      FILTER NOT EXISTS { ?stmt pq:P582 ?end . }
    }
    ORDER BY DESC(?start)
    LIMIT 1
  `;

  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/sparql-results+json' }
  });

  if (!res.ok) return null;

  const data = await res.json();
  const row = data.results.bindings[0];
  if (!row?.person) return null;

  return {
    qid: row.person.value.split('/').pop(),
    start: row.start?.value?.split('T')[0] || null
  };
}

/**
 * Fetch a person's details from Wikidata entity API.
 * Returns { name_en, name_local, born, party, partyLocal, partyQid, wikipediaUrls, wikidata_id }
 */
export async function fetchPersonEntity(personQid, localLang) {
  // Include 'mul' (multilingual) as some entities use it instead of 'en'
  const langParts = ['en', 'mul'];
  if (localLang && localLang !== 'en') langParts.push(localLang);
  const langs = [...new Set(langParts)].join('|');

  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: personQid,
    props: 'labels|claims|sitelinks',
    languages: langs,
    sitefilter: localLang && localLang !== 'en'
      ? `enwiki|${localLang}wiki`
      : 'enwiki',
    format: 'json'
  });

  const res = await fetch(`${WIKIDATA_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) return null;

  const data = await res.json();
  const entity = data.entities?.[personQid];
  if (!entity) return null;

  // Resolve English name: try en, then mul (multilingual label)
  const nameEn = entity.labels?.en?.value
    || entity.labels?.mul?.value
    || null;

  const result = {
    wikidata_id: personQid,
    name_en: nameEn,
    name_local: (localLang && localLang !== 'en')
      ? (entity.labels?.[localLang]?.value || null)
      : null,
    born: extractDateClaim(entity.claims?.P569),
    party: null,
    party_local: null,
    party_qid: null,
    wikipedia_en: sitelinkToUrl(entity.sitelinks?.enwiki),
    wikipedia_local: (localLang && localLang !== 'en')
      ? sitelinkToUrl(entity.sitelinks?.[`${localLang}wiki`])
      : null
  };

  // Extract party (P102) — need separate fetch for party label
  const partyQid = extractEntityClaim(entity.claims?.P102);
  if (partyQid) {
    result.party_qid = partyQid;
    const partyData = await fetchEntityLabels(partyQid, langs);
    if (partyData) {
      result.party = partyData.en || null;
      result.party_local = (localLang && localLang !== 'en')
        ? partyData[localLang] || null
        : null;
    }
    await sleep(DELAY_MS);
  }

  return result;
}

/**
 * Fetch just labels for an entity (used for party names, etc.)
 */
async function fetchEntityLabels(qid, langs) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qid,
    props: 'labels',
    languages: langs,
    format: 'json'
  });

  const res = await fetch(`${WIKIDATA_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) return null;

  const data = await res.json();
  const entity = data.entities?.[qid];
  if (!entity?.labels) return null;

  const result = {};
  for (const [lang, label] of Object.entries(entity.labels)) {
    result[lang] = label.value;
  }
  return result;
}

/**
 * Extract an ISO date string from a Wikidata date claim (P569, etc.)
 * Takes the first preferred or normal rank value.
 */
function extractDateClaim(claims) {
  if (!claims || claims.length === 0) return null;

  // Prefer preferred rank, then normal
  const sorted = [...claims].sort((a, b) => {
    const rankOrder = { preferred: 0, normal: 1, deprecated: 2 };
    return (rankOrder[a.rank] || 1) - (rankOrder[b.rank] || 1);
  });

  const value = sorted[0]?.mainsnak?.datavalue?.value;
  if (!value?.time) return null;

  // Wikidata time format: "+2024-08-16T00:00:00Z"
  const match = value.time.match(/([+-]?\d{4}-\d{2}-\d{2})/);
  return match ? match[1].replace(/^\+/, '') : null;
}

/**
 * Extract entity QID from a claim (e.g., P102 party membership)
 * Prefers: preferred rank > no end date (P582) > latest start date (P580)
 */
function extractEntityClaim(claims) {
  if (!claims || claims.length === 0) return null;

  // Filter out deprecated
  const active = claims.filter(c => c.rank !== 'deprecated');
  if (active.length === 0) return null;

  // Prefer preferred rank
  const preferred = active.filter(c => c.rank === 'preferred');
  if (preferred.length > 0) {
    return preferred[0]?.mainsnak?.datavalue?.value?.id || null;
  }

  // Among normal rank: prefer ones without end date (P582)
  const noEnd = active.filter(c => !c.qualifiers?.P582);
  if (noEnd.length > 0) {
    // If multiple without end date, pick latest start date
    const sorted = noEnd.sort((a, b) => {
      const startA = a.qualifiers?.P580?.[0]?.datavalue?.value?.time || '';
      const startB = b.qualifiers?.P580?.[0]?.datavalue?.value?.time || '';
      return startB.localeCompare(startA); // descending
    });
    return sorted[0]?.mainsnak?.datavalue?.value?.id || null;
  }

  // All have end dates — pick latest end date
  const sorted = active.sort((a, b) => {
    const endA = a.qualifiers?.P582?.[0]?.datavalue?.value?.time || '';
    const endB = b.qualifiers?.P582?.[0]?.datavalue?.value?.time || '';
    return endB.localeCompare(endA);
  });
  return sorted[0]?.mainsnak?.datavalue?.value?.id || null;
}

/**
 * Convert a sitelink object to a Wikipedia URL
 */
function sitelinkToUrl(sitelink) {
  if (!sitelink?.title) return null;
  const site = sitelink.site || '';
  const lang = site.replace('wiki', '');
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(sitelink.title.replace(/ /g, '_'))}`;
}

/**
 * Find a Wikidata entity from a Wikipedia URL, then fetch person details.
 * Uses the Wikipedia API to get the Wikidata item ID from a page title.
 *
 * @param {string} wikiUrl — e.g. "https://en.wikipedia.org/wiki/Anutin_Charnvirakul"
 * @param {string} localLang — e.g. "th"
 * @returns {object|null} person details
 */
export async function fetchPersonByName(wikiUrl, localLang) {
  if (!wikiUrl) return null;

  // Extract article title from URL
  const match = wikiUrl.match(/wikipedia\.org\/wiki\/(.+)/);
  if (!match) return null;
  const title = decodeURIComponent(match[1]);

  // Use Wikipedia API to get Wikidata ID
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    format: 'json'
  });

  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) return null;

  const data = await res.json();
  const pages = data.query?.pages;
  if (!pages) return null;

  const page = Object.values(pages)[0];
  const qid = page?.pageprops?.wikibase_item;
  if (!qid) return null;

  return fetchPersonEntity(qid, localLang);
}

/**
 * Calculate age from birth date
 */
export function calculateAge(birthDateStr) {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Calculate tenure in days from start date
 */
export function calculateTenure(sinceDate) {
  if (!sinceDate) return null;
  const start = new Date(sinceDate);
  const now = new Date();
  return Math.floor((now - start) / (1000 * 60 * 60 * 24));
}
