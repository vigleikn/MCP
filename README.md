# Jula Sitemap Scraper

Apify Actor som scraper produkter fra Jula.no via sitemaps (respekterer robots.txt).

## Funksjoner

- Henter produkt-URLer fra Julas 25 sitemaps
- Filtrerer på søkeord og/eller kategori
- Scraper produktdetaljer: navn, pris, merke, VESA-størrelser, etc.
- Lagrer strukturert data i Apify Dataset

## Input

```json
{
    "keyword": "veggfeste",
    "maxProducts": 50,
    "category": "veggfester-og-mobler"
}
```

## Output

```json
{
    "name": "Veggbrakett for TV 37-70\" 40 kg",
    "brand": "Bright",
    "price": 299,
    "currency": "NOK",
    "articleNumber": "030678",
    "vesaSizes": ["200x200 mm", "300x300 mm", "400x400 mm"],
    "url": "https://www.jula.no/catalog/.../veggbrakett-for-tv-030678/",
    "source": "Jula",
    "scrapedAt": "2026-01-30T21:30:00.000Z"
}
```

## Bruk med MCP

Koble til Cursor via Apify MCP for AI-drevet produktsøk.
