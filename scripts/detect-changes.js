/**
 * detect-changes.js
 *
 * Compares today's leader data vs previous snapshot.
 * Returns list of leadership changes detected.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Detect leadership changes between today's data and previous snapshot.
 *
 * @param {object} todayData — { countryCode: current.json content }
 * @param {string} previousSnapshotPath — path to previous all-leaders.json
 * @returns {Array} list of change objects
 */
export async function detectChanges(todayData, previousSnapshotPath) {
  if (!existsSync(previousSnapshotPath)) {
    console.log('No previous snapshot found — skipping change detection (first run).');
    return [];
  }

  let previous;
  try {
    previous = JSON.parse(await readFile(previousSnapshotPath, 'utf-8'));
  } catch (err) {
    console.warn(`Could not read previous snapshot: ${err.message}`);
    return [];
  }

  const changes = [];
  const now = new Date().toISOString();

  for (const [countryCode, todayCountry] of Object.entries(todayData)) {
    const prevLeaders = previous.leaders?.[countryCode];
    if (!prevLeaders) continue; // new country, not a "change"

    // Check head_of_government
    const todayHog = todayCountry.positions?.head_of_government?.current_holder?.name_en;
    const prevHog = prevLeaders.head_of_government;
    if (todayHog && prevHog && todayHog !== prevHog) {
      changes.push({
        detected_at: now,
        country: countryCode,
        country_name_en: todayCountry.country.name_en,
        position: 'head_of_government',
        position_title: todayCountry.positions.head_of_government.title_en,
        old_holder_en: prevHog,
        new_holder_en: todayHog,
        new_holder_local: todayCountry.positions.head_of_government.current_holder.name_local,
        change_date: todayCountry.positions.head_of_government.current_holder.since,
        wikipedia_link: todayCountry.positions.head_of_government.current_holder.wikipedia_en
      });
    }

    // Check head_of_state
    const todayHos = todayCountry.positions?.head_of_state?.current_holder?.name_en;
    const prevHos = prevLeaders.head_of_state;
    if (todayHos && prevHos && todayHos !== prevHos) {
      changes.push({
        detected_at: now,
        country: countryCode,
        country_name_en: todayCountry.country.name_en,
        position: 'head_of_state',
        position_title: todayCountry.positions.head_of_state.title_en,
        old_holder_en: prevHos,
        new_holder_en: todayHos,
        new_holder_local: todayCountry.positions.head_of_state.current_holder.name_local,
        change_date: todayCountry.positions.head_of_state.current_holder.since,
        wikipedia_link: todayCountry.positions.head_of_state.current_holder.wikipedia_en
      });
    }
  }

  if (changes.length > 0) {
    console.log(`Detected ${changes.length} leadership change(s)!`);
    for (const c of changes) {
      console.log(`  ${c.country_name_en}: ${c.position_title} changed from ${c.old_holder_en} to ${c.new_holder_en}`);
    }
  } else {
    console.log('No leadership changes detected.');
  }

  return changes;
}

/**
 * Append changes to the year's changes file.
 */
export async function appendChanges(changes, changesDir) {
  if (changes.length === 0) return;

  const year = new Date().getFullYear().toString();
  const filePath = `${changesDir}/${year}.json`;

  let yearData = { year: parseInt(year), changes: [] };

  if (existsSync(filePath)) {
    try {
      yearData = JSON.parse(await readFile(filePath, 'utf-8'));
    } catch (err) {
      console.warn(`Could not read ${filePath}, creating new.`);
    }
  }

  yearData.changes.push(...changes);
  return yearData;
}

/**
 * Validate a detected change for plausibility (anti-vandalism).
 */
export function validateChange(change) {
  const warnings = [];

  // Name should have at least 2 characters
  if (!change.new_holder_en || change.new_holder_en.length < 2) {
    warnings.push('New holder name too short');
  }

  // Since date should be reasonable (not before 2000)
  if (change.change_date) {
    const year = parseInt(change.change_date.split('-')[0]);
    if (year < 2000 || year > new Date().getFullYear() + 1) {
      warnings.push(`Suspicious start date: ${change.change_date}`);
    }
  }

  // Names should not be identical (case-insensitive typo difference)
  if (change.old_holder_en?.toLowerCase() === change.new_holder_en?.toLowerCase()) {
    warnings.push('Old and new holder names differ only in case — may be formatting change');
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}

export default detectChanges;
