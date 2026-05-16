/**
 * fetch-wikipedia.js — Fallback data source
 *
 * Used when Wikidata is missing data for a country/position.
 * Fetches Wikipedia article HTML and delegates to parse-infobox.js.
 */

const DELAY_MS = 200;
const USER_AGENT = 'WorldLeadersCurrent/1.0 (https://github.com/open-data-archive/world-leaders-current)';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch article HTML (section 0 = intro + infobox) from Wikipedia.
 * @param {string} articleTitle — e.g. "Prime_Minister_of_Thailand"
 * @param {string} lang — e.g. "en", "th"
 * @returns {string|null} HTML string or null
 */
export async function fetchArticleHTML(articleTitle, lang = 'en') {
  const apiBase = `https://${lang}.wikipedia.org/w/api.php`;

  const params = new URLSearchParams({
    action: 'parse',
    format: 'json',
    page: articleTitle,
    prop: 'text',
    section: '0',
    disableeditsection: 'true',
    disabletoc: 'true'
  });

  const res = await fetch(`${apiBase}?${params}`, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) {
    console.warn(`Wikipedia fetch failed for ${lang}:${articleTitle}: ${res.status}`);
    return null;
  }

  const data = await res.json();
  if (data.error) {
    console.warn(`Wikipedia API error for ${lang}:${articleTitle}: ${data.error.info}`);
    return null;
  }

  return data.parse?.text?.['*'] || null;
}

/**
 * Fetch the last revision timestamp for a Wikipedia article.
 * Useful for checking if data has been updated since last fetch.
 */
export async function fetchLastRevision(articleTitle, lang = 'en') {
  const apiBase = `https://${lang}.wikipedia.org/w/api.php`;

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: articleTitle,
    prop: 'revisions',
    rvprop: 'timestamp',
    rvlimit: '1'
  });

  const res = await fetch(`${apiBase}?${params}`, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) return null;

  const data = await res.json();
  const pages = data.query?.pages;
  if (!pages) return null;

  const page = Object.values(pages)[0];
  return page?.revisions?.[0]?.timestamp || null;
}

/**
 * Fetch incumbent info for a position using Wikipedia fallback.
 * Combines fetchArticleHTML + parseInfobox.
 */
export async function fetchIncumbentFallback(positionConfig, parseInfobox) {
  const html = await fetchArticleHTML(positionConfig.wiki_article_en, 'en');
  if (!html) return null;

  const result = parseInfobox(html);
  if (!result) return null;

  // Try local language for local name
  if (positionConfig.wiki_article_local) {
    await sleep(DELAY_MS);
    const localHtml = await fetchArticleHTML(
      positionConfig.wiki_article_local,
      positionConfig._lang || 'en'
    );
    if (localHtml) {
      const localResult = parseInfobox(localHtml);
      if (localResult?.name) {
        result.name_local = localResult.name;
      }
    }
  }

  return result;
}
