# Methodology

## Data Collection

This repository collects data on current world leaders using a two-tier approach:

### Primary Source: Wikidata
- Structured, machine-readable data via SPARQL queries and Entity API
- Properties used: P6 (head of government), P35 (head of state), P569 (date of birth), P102 (political party)
- Labels available in all languages — no per-language parsing needed

### Fallback Source: Wikipedia
- Used only when Wikidata is missing specific fields
- Parses English Wikipedia infobox "Incumbent" field using Cheerio
- Local language Wikipedia used for local name extraction when needed

## Update Schedule
- Daily at 12:00 UTC via GitHub Actions
- Change detection compares current data vs previous snapshot
- Only affected files are regenerated

## Attribution
All data sourced from Wikidata and Wikipedia under CC-BY-SA-4.0 license.
