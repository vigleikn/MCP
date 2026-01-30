# Jula Product Scraper

Apify Actor som scraper og cacher produkter fra Jula.no via sitemaps.

## Moduser

### 1. Filtrert scraping (standard)
Scrape produkter basert på søkeord/kategori.

```json
{
    "keyword": "veggfeste",
    "maxProducts": 50
}
```

### 2. Full indeksering
Scrape ALLE ~23.500 produkter fra Jula. Tar 6-13 timer.

```json
{
    "fullIndex": true
}
```

### 3. Oppdater kun nye
Scrape kun produkter som ikke finnes i cache.

```json
{
    "updateOnly": true
}
```

### 4. Søk i cache (instant)
Søk i cached data uten scraping. Krever at du har kjørt indeksering først.

```json
{
    "searchOnly": true,
    "keyword": "veggfeste",
    "maxProducts": 20
}
```

## Input-parametere

| Parameter | Type | Default | Beskrivelse |
|-----------|------|---------|-------------|
| `searchOnly` | boolean | false | Søk i cache uten scraping |
| `fullIndex` | boolean | false | Scrape alle produkter |
| `updateOnly` | boolean | false | Kun scrape nye produkter |
| `keyword` | string | "" | Filtrer på søkeord |
| `category` | string | "" | Filtrer på kategori |
| `maxProducts` | integer | 50 | Maks antall produkter |

## Output

Hvert produkt inneholder:

```json
{
    "name": "Veggbrakett for TV 37-70\" 40 kg",
    "articleNumber": "030678",
    "ean": "7320561306789",
    "brand": "Bright",
    "price": 299,
    "priceExVat": 239.2,
    "currency": "NOK",
    "categories": ["hjem og husholdning", "hjemmeelektronikk", "tv og bilde", "veggfester og mobler"],
    "description": "Slankt veggfeste for TV...",
    "features": ["Slank design - 22 mm dyp", "Passer til buede og flate skjermer"],
    "specs": {"Skjermstørrelse": "37-70\"", "Maks belastning": "40 kg"},
    "images": ["https://www.jula.no/..."],
    "inStock": true,
    "availableInStores": 44,
    "rating": 4.9,
    "reviewCount": 10,
    "url": "https://www.jula.no/catalog/.../veggbrakett-for-tv-030678/",
    "source": "Jula",
    "scrapedAt": "2026-01-30T21:50:00.000Z"
}
```

## Caching

Produkter lagres automatisk i Apify Key-Value Store (`jula-products`):
- `all-products`: Array med alle produkter
- `cache-metadata`: Info om siste oppdatering

## Anbefalt workflow

1. **Første gang:** Kjør full indeksering (tar flere timer)
   ```json
   { "fullIndex": true }
   ```

2. **Daglig:** Sett opp scheduled run med updateOnly
   ```json
   { "updateOnly": true }
   ```

3. **Bruk:** Søk i cache (instant)
   ```json
   { "searchOnly": true, "keyword": "drill", "maxProducts": 20 }
   ```

## Koble til Cursor via MCP

Legg til i `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "Apify": {
      "command": "npx",
      "args": ["-y", "@apify/mcp-server"],
      "env": {
        "APIFY_TOKEN": "din_api_token"
      }
    }
  }
}
```

Finn API-token: Apify Console → Settings → Integrations → API tokens
