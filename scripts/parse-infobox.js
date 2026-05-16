/**
 * parse-infobox.js — Wikipedia infobox parser (PRIMARY source)
 *
 * Parses the "Incumbent" field from Wikipedia office pages
 * (e.g., "Prime Minister of Thailand").
 *
 * Wikipedia infobox HTML varies significantly — this parser handles:
 * 1. <th>Incumbent</th><td>...</td> (classic table layout)
 * 2. <div>Incumbent<br/><a>Name</a></div> (modern template layout)
 * 3. Other variations
 */

import { load } from 'cheerio';

/**
 * Parse an office page's infobox to extract incumbent info.
 * @param {string} html — HTML of the Wikipedia article section 0
 * @returns {{ name, wikiUrl, since }|null}
 */
export function parseOfficeInfobox(html) {
  const $ = load(html);

  // Strategy 1: Find "Incumbent" in bold div (modern Wikipedia template)
  // Pattern: <div style="...bold...">Incumbent<br/><a href="...">Name</a></div>
  let result = parseModernInfobox($);
  if (result) return result;

  // Strategy 2: Find "Incumbent" in th/td table row (classic infobox)
  result = parseClassicInfobox($);
  if (result) return result;

  // Strategy 3: Search all text for "Incumbent" and find nearest link
  result = parseFallback($);
  if (result) return result;

  return null;
}

/**
 * Modern Wikipedia infobox: Incumbent is inside a styled div
 */
function parseModernInfobox($) {
  let name = null;
  let wikiUrl = null;
  let since = null;

  // Look for elements containing "Incumbent" text
  $('div, th, td').each((i, el) => {
    const text = $(el).text().trim();
    if (!text.match(/^Incumbent/i)) return;

    // Found "Incumbent" — search for person link in this element, parent, and nearby rows
    const row = $(el).closest('tr');
    const searchAreas = [$(el), $(el).parent(), row, row.next('tr'), row.next('tr').next('tr'), row.next('tr').next('tr').next('tr')];

    for (const area of searchAreas) {
      if (name) break;
      if (!area.length) continue;

      area.find('a').each((j, a) => {
        if (name) return false;
        const href = $(a).attr('href') || '';
        const linkText = $(a).text().trim();
        if (isPersonLink(href, linkText)) {
          name = linkText;
          wikiUrl = href.startsWith('http') ? href : `https://en.wikipedia.org${href}`;
          return false;
        }
      });
    }

    // Extract "since" date from surrounding text (search multiple nearby rows)
    const surroundingTexts = [
      $(el).parent().text(),
      row.text(),
      row.next('tr').text(),
      row.next('tr').next('tr').text(),
      row.next('tr').next('tr').next('tr').text()
    ].filter(Boolean);
    for (const t of surroundingTexts) {
      since = extractSinceDate(t);
      if (since) break;
    }

    if (name) return false; // break
  });

  if (!name) return null;
  // Clean name — remove trailing "since..." text that may stick due to HTML structure
  name = name.replace(/since\s*\d.*/i, '').trim();
  return { name, wikiUrl, since };
}

/**
 * Classic Wikipedia infobox: <th>Incumbent</th><td>...</td>
 */
function parseClassicInfobox($) {
  const infobox = $('.infobox, .vcard').first();
  if (!infobox.length) return null;

  let name = null;
  let wikiUrl = null;
  let since = null;

  infobox.find('tr').each((i, tr) => {
    const th = $(tr).find('th').first();
    const thText = th.text().trim().toLowerCase();
    if (!thText.includes('incumbent')) return;

    const td = $(tr).find('td').first();
    if (!td.length) return;

    const link = td.find('a').filter((j, a) => {
      return isPersonLink($(a).attr('href') || '', $(a).text());
    }).first();

    if (link.length) {
      name = link.text().trim();
      const href = link.attr('href') || '';
      wikiUrl = href.startsWith('http') ? href : `https://en.wikipedia.org${href}`;
    } else {
      // No link, try raw text
      const tdText = td.text().trim().split('\n')[0].trim();
      if (tdText && tdText.length > 1 && tdText.length < 100) {
        name = tdText;
      }
    }

    since = extractSinceDate(td.text());
    if (name) return false; // break
  });

  if (!name) return null;
  return { name, wikiUrl, since };
}

/**
 * Fallback: search for "Incumbent" text anywhere and find the nearest person link
 */
function parseFallback($) {
  const fullText = $.text();
  const match = fullText.match(/Incumbent[:\s]*([A-Z][a-zA-Z\s\-'\.]+)/);
  if (!match) return null;

  const candidateName = match[1].trim().split('\n')[0].trim();
  if (candidateName.length < 2 || candidateName.length > 80) return null;

  // Try to find a matching link
  let wikiUrl = null;
  $('a').each((i, a) => {
    if ($(a).text().trim() === candidateName) {
      const href = $(a).attr('href') || '';
      wikiUrl = href.startsWith('http') ? href : `https://en.wikipedia.org${href}`;
      return false;
    }
  });

  const since = extractSinceDate(fullText.substring(fullText.indexOf('Incumbent')));

  return { name: candidateName, wikiUrl, since };
}

/**
 * Check if a link likely points to a person (not an organization/concept)
 */
function isPersonLink(href, text) {
  if (!href || !text) return false;
  // Skip common non-person patterns
  const skipPatterns = [
    /^#/, /^\/wiki\/File:/, /^\/wiki\/Help:/,
    /^\/wiki\/Wikipedia:/, /^\/wiki\/Template:/,
    /^\/wiki\/Category:/, /\.(jpg|png|svg|gif)/i
  ];
  for (const p of skipPatterns) {
    if (p.test(href)) return false;
  }
  // Skip very short text or text that looks like a reference
  if (text.length < 2 || text.match(/^\[?\d+\]?$/) || text.match(/^\(.*\)$/)) return false;
  return true;
}

/**
 * Extract "since" date from text
 * Handles: "since 7 September 2025", "since January 20, 2025", etc.
 */
function extractSinceDate(text) {
  if (!text) return null;

  // "since DD Month YYYY" (British format)
  const sinceMatch = text.match(/since\s+(\d{1,2}\s+\w+\s+\d{4})/i);
  if (sinceMatch) return parseEnglishDate(sinceMatch[1]);

  // "since Month DD, YYYY" (US format)
  const usMatch = text.match(/since\s+(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (usMatch) return parseEnglishDate(usMatch[1]);

  // "Assumed office\nDD Month YYYY"
  const assumedMatch = text.match(/Assumed\s+office\s*[\n\r]*\s*(\d{1,2}\s+\w+\s+\d{4})/i);
  if (assumedMatch) return parseEnglishDate(assumedMatch[1]);

  // "Assumed office\nMonth DD, YYYY"
  const assumedUsMatch = text.match(/Assumed\s+office\s*[\n\r]*\s*(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (assumedUsMatch) return parseEnglishDate(assumedUsMatch[1]);

  return null;
}

/**
 * Parse English date to ISO format.
 * Handles: "7 September 2025" (DD Month YYYY) and "January 20, 2025" (Month DD, YYYY)
 */
function parseEnglishDate(dateStr) {
  const months = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12'
  };

  // Try DD Month YYYY
  let match = dateStr.trim().match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (match) {
    const month = months[match[2].toLowerCase()];
    if (month) {
      return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
    }
  }

  // Try Month DD, YYYY (US format)
  match = dateStr.trim().match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (match) {
    const month = months[match[1].toLowerCase()];
    if (month) {
      return `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
    }
  }

  return null;
}

export default parseOfficeInfobox;
