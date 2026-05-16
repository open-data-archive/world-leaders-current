# Data Collection Methodology

The world-leaders-current project collects and maintains data on current heads of state and heads of government for countries in the ASEAN and G20 groupings, as well as the European Union and African Union.

The primary data source is Wikidata, queried via its SPARQL endpoint to retrieve structured information about current officeholders, including names, positions, and start dates. When Wikidata entries are incomplete or unavailable, Wikipedia serves as a fallback source for verification and supplementary details.

Data collection is automated through daily GitHub Actions workflows that query sources, validate results, and update the project's data files. This ensures the dataset remains current as leadership changes occur.
