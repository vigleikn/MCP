import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { parseStringPromise } from 'xml2js';

await Actor.init();

const input = await Actor.getInput() ?? {};
const { keyword = '', maxProducts = 50, category = '' } = input;

console.log(`Starting Jula scraper - keyword: "${keyword}", max: ${maxProducts}`);

// Steg 1: Hent alle produkt-URLer fra sitemaps
const sitemapUrls = Array.from({ length: 25 }, (_, i) => 
    `https://www.jula.no/sitemap.${i + 1}.xml`
);

const allProductUrls = [];

for (const sitemapUrl of sitemapUrls) {
    try {
        console.log(`Fetching ${sitemapUrl}...`);
        const response = await fetch(sitemapUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JulaScraper/1.0)' }
        });
        
        if (!response.ok) continue;
        
        const xml = await response.text();
        const parsed = await parseStringPromise(xml);
        
        if (!parsed.urlset?.url) continue;
        
        const urls = parsed.urlset.url
            .map(u => u.loc?.[0])
            .filter(url => url && url.includes('/catalog/'));
        
        allProductUrls.push(...urls);
        console.log(`  Found ${urls.length} product URLs`);
        
        // Litt pause mellom requests
        await new Promise(r => setTimeout(r, 500));
    } catch (e) {
        console.log(`  Failed: ${e.message}`);
    }
}

console.log(`Total product URLs found: ${allProductUrls.length}`);

// Steg 2: Filtrer basert på keyword og kategori
let filteredUrls = allProductUrls;

if (keyword) {
    const kw = keyword.toLowerCase().replace(/\s+/g, '-');
    filteredUrls = filteredUrls.filter(url => 
        url.toLowerCase().includes(kw)
    );
    console.log(`After keyword filter: ${filteredUrls.length}`);
}

if (category) {
    filteredUrls = filteredUrls.filter(url => 
        url.toLowerCase().includes(category.toLowerCase())
    );
    console.log(`After category filter: ${filteredUrls.length}`);
}

// Begrens antall
const urlsToScrape = filteredUrls.slice(0, maxProducts);
console.log(`Will scrape ${urlsToScrape.length} products`);

// Steg 3: Scrape hver produktside
const results = [];

const crawler = new CheerioCrawler({
    maxRequestsPerMinute: 30,
    
    async requestHandler({ request, $ }) {
        try {
            const name = $('h1').first().text().trim();
            const brand = $('a[href*="/varemerker/"]').first().text().trim();
            
            // Pris - prøv flere selektorer
            let price = null;
            const priceText = $('[class*="price"]').first().text() || 
                             $('[data-price]').attr('data-price') || '';
            const priceMatch = priceText.match(/(\d[\d\s]*)/);
            if (priceMatch) {
                price = parseInt(priceMatch[1].replace(/\s/g, ''));
            }
            
            // Artikelnummer
            const articleMatch = $('body').text().match(/Artikkelnr[:\s]*(\d+)/i);
            const articleNumber = articleMatch ? articleMatch[1] : null;
            
            // VESA-størrelser
            const bodyText = $('body').text();
            const vesaMatches = bodyText.match(/(\d{2,3})\s*x\s*(\d{2,3})\s*mm/gi) || [];
            const vesaSizes = [...new Set(vesaMatches)];
            
            // Produktbeskrivelse
            const description = $('[class*="description"]').first().text().trim().slice(0, 500);
            
            // Spesifikasjoner
            const specs = {};
            $('dt, th').each((_, el) => {
                const key = $(el).text().trim();
                const value = $(el).next('dd, td').text().trim();
                if (key && value && key.length < 50) specs[key] = value;
            });
            
            // Bilde-URL
            const imageUrl = $('img[src*="catalog"]').first().attr('src') || 
                            $('meta[property="og:image"]').attr('content') || null;
            
            const product = {
                name,
                brand,
                price,
                currency: 'NOK',
                articleNumber,
                description: description || null,
                vesaSizes: vesaSizes.length > 0 ? vesaSizes : null,
                imageUrl,
                url: request.url,
                specs: Object.keys(specs).length > 0 ? specs : null,
                source: 'Jula',
                scrapedAt: new Date().toISOString()
            };
            
            results.push(product);
            console.log(`✓ ${name} - ${price} kr`);
            
        } catch (e) {
            console.log(`✗ Error scraping ${request.url}: ${e.message}`);
        }
    },
    
    failedRequestHandler({ request, error }) {
        console.log(`Failed: ${request.url} - ${error.message}`);
    }
});

if (urlsToScrape.length > 0) {
    await crawler.run(urlsToScrape);
}

// Steg 4: Lagre resultater
await Actor.pushData(results);

console.log(`\n=== DONE ===`);
console.log(`Scraped ${results.length} products successfully`);

await Actor.exit();
