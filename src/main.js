import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { parseStringPromise } from 'xml2js';

await Actor.init();

let input = await Actor.getInput() ?? {};

// Håndter tilfelle der input er en streng (feil format fra UI)
if (typeof input === 'string') {
    try {
        input = JSON.parse(input);
    } catch (e) {
        input = { keyword: input };
    }
}

const { 
    keyword = '', 
    maxProducts = 50, 
    category = '',
    fullIndex = false,      // Kjør full indeksering av alle produkter
    updateOnly = false,     // Kun oppdater nye produkter (sjekk mot cache)
    searchOnly = false,     // Søk i cached data uten scraping
} = input;

console.log(`Starting Jula scraper`);
console.log(`  Mode: ${fullIndex ? 'FULL INDEX' : updateOnly ? 'UPDATE ONLY' : searchOnly ? 'SEARCH ONLY' : 'FILTERED SCRAPE'}`);
console.log(`  keyword: "${keyword}", maxProducts: ${maxProducts}, category: "${category}"`);

// Key-Value Store for caching
const kvStore = await Actor.openKeyValueStore('jula-products');

// Hvis searchOnly, søk i cached data og avslutt
if (searchOnly) {
    console.log('\n=== SEARCH MODE ===');
    const cachedProducts = await kvStore.getValue('all-products') || [];
    console.log(`Loaded ${cachedProducts.length} products from cache`);
    
    let results = cachedProducts;
    
    if (keyword) {
        const kwLower = keyword.toLowerCase();
        results = results.filter(p => 
            p.name?.toLowerCase().includes(kwLower) ||
            p.description?.toLowerCase().includes(kwLower) ||
            p.brand?.toLowerCase().includes(kwLower) ||
            p.categories?.some(c => c.toLowerCase().includes(kwLower)) ||
            JSON.stringify(p.features || []).toLowerCase().includes(kwLower) ||
            JSON.stringify(p.specs || {}).toLowerCase().includes(kwLower)
        );
        console.log(`After keyword search: ${results.length} matches`);
    }
    
    if (category) {
        const catLower = category.toLowerCase();
        results = results.filter(p => 
            p.categories?.some(c => c.toLowerCase().includes(catLower))
        );
        console.log(`After category filter: ${results.length} matches`);
    }
    
    // Begrens resultater
    results = results.slice(0, maxProducts);
    
    await Actor.pushData(results);
    console.log(`\n=== DONE ===`);
    console.log(`Returned ${results.length} products from cache`);
    await Actor.exit();
}

// Last eksisterende cache for updateOnly-modus
let existingUrls = new Set();
if (updateOnly) {
    const cachedProducts = await kvStore.getValue('all-products') || [];
    existingUrls = new Set(cachedProducts.map(p => p.url));
    console.log(`Loaded ${existingUrls.size} existing URLs from cache`);
}

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
    // Støtt flere søkevarianter: "veggfeste" matcher "veggfester", "veggfeste-", etc.
    const kwLower = keyword.toLowerCase().trim();
    const kwVariants = [
        kwLower,
        kwLower.replace(/\s+/g, '-'),
        kwLower.replace(/\s+/g, ''),
        kwLower + 'r',  // flertall
        kwLower + 'er', // flertall
    ];
    
    filteredUrls = filteredUrls.filter(url => {
        const urlLower = url.toLowerCase();
        return kwVariants.some(kw => urlLower.includes(kw));
    });
    console.log(`After keyword filter "${keyword}": ${filteredUrls.length} URLs`);
    
    // Vis noen eksempler
    if (filteredUrls.length > 0) {
        console.log(`  Examples: ${filteredUrls.slice(0, 3).join('\n            ')}`);
    }
}

if (category) {
    const catLower = category.toLowerCase().trim();
    filteredUrls = filteredUrls.filter(url => 
        url.toLowerCase().includes(catLower)
    );
    console.log(`After category filter "${category}": ${filteredUrls.length} URLs`);
}

// For fullIndex, bruk alle URLer
let urlsToScrape;
if (fullIndex) {
    urlsToScrape = filteredUrls;
    console.log(`FULL INDEX: Will scrape all ${urlsToScrape.length} products`);
} else {
    urlsToScrape = filteredUrls.slice(0, maxProducts);
    console.log(`Will scrape ${urlsToScrape.length} products`);
}

// For updateOnly, filtrer ut allerede scrapede URLer
if (updateOnly && existingUrls.size > 0) {
    const beforeCount = urlsToScrape.length;
    urlsToScrape = urlsToScrape.filter(url => !existingUrls.has(url));
    console.log(`UPDATE MODE: Filtered from ${beforeCount} to ${urlsToScrape.length} new URLs`);
}

// Steg 3: Scrape hver produktside
const results = [];

const crawler = new CheerioCrawler({
    maxRequestsPerMinute: 30,
    
    async requestHandler({ request, $ }) {
        try {
            // Grunnleggende info
            const name = $('h1').first().text().trim();
            const brand = $('a[href*="/varemerker/"]').first().text().trim();
            
            // Pris
            let price = null;
            let priceExVat = null;
            const priceText = $('[class*="price"]').first().text() || '';
            const priceMatch = priceText.match(/(\d[\d\s]*)/);
            if (priceMatch) {
                price = parseInt(priceMatch[1].replace(/\s/g, ''));
            }
            const exVatMatch = $('body').text().match(/Eks\.?\s*mva\.?[:\s]*([\d\s,]+)/i);
            if (exVatMatch) {
                priceExVat = parseFloat(exVatMatch[1].replace(/\s/g, '').replace(',', '.'));
            }
            
            // Artikelnummer
            const articleMatch = $('body').text().match(/Artikkelnr[:\s]*(\d+)/i);
            const articleNumber = articleMatch ? articleMatch[1] : null;
            
            // EAN/Strekkode
            const eanMatch = $('body').text().match(/EAN[:\s]*(\d{13})/i);
            const ean = eanMatch ? eanMatch[1] : null;
            
            // Kategori fra URL
            const urlParts = request.url.split('/catalog/')[1]?.split('/') || [];
            const categories = urlParts.slice(0, -1).map(c => c.replace(/-/g, ' '));
            
            // Produktbeskrivelse - hent alt
            const descriptionParts = [];
            $('p').each((_, el) => {
                const text = $(el).text().trim();
                if (text.length > 20 && text.length < 2000) {
                    descriptionParts.push(text);
                }
            });
            const description = descriptionParts.join('\n\n');
            
            // Produktegenskaper/features (bullet points)
            const features = [];
            $('li').each((_, el) => {
                const text = $(el).text().trim();
                if (text.length > 5 && text.length < 200 && !text.includes('http')) {
                    features.push(text);
                }
            });
            
            // Alle spesifikasjoner
            const specs = {};
            
            // Fra definition lists
            $('dl').each((_, dl) => {
                $(dl).find('dt').each((i, dt) => {
                    const key = $(dt).text().trim();
                    const value = $(dt).next('dd').text().trim();
                    if (key && value && key.length < 100) {
                        specs[key] = value;
                    }
                });
            });
            
            // Fra tabeller
            $('table tr').each((_, tr) => {
                const cells = $(tr).find('td, th');
                if (cells.length >= 2) {
                    const key = $(cells[0]).text().trim();
                    const value = $(cells[1]).text().trim();
                    if (key && value && key.length < 100) {
                        specs[key] = value;
                    }
                }
            });
            
            // Bilder - hent alle
            const images = [];
            $('img').each((_, img) => {
                const src = $(img).attr('src') || $(img).attr('data-src');
                if (src && (src.includes('product') || src.includes('catalog') || src.includes('jula'))) {
                    if (!images.includes(src) && !src.includes('logo') && !src.includes('icon')) {
                        images.push(src);
                    }
                }
            });
            
            // OG meta tags
            const ogImage = $('meta[property="og:image"]').attr('content');
            if (ogImage && !images.includes(ogImage)) {
                images.unshift(ogImage);
            }
            
            // Lagerstatus
            const stockText = $('body').text();
            const inStock = stockText.includes('På lager') || stockText.includes('nettlager');
            const stockMatch = stockText.match(/(\d+)\s*varehus/i);
            const availableInStores = stockMatch ? parseInt(stockMatch[1]) : null;
            
            // Vurdering/rating
            const ratingMatch = $('body').text().match(/([\d,\.]+)\s*stjerner?/i);
            const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;
            const reviewMatch = $('body').text().match(/(\d+)\s*(?:anmeldelse|review)/i);
            const reviewCount = reviewMatch ? parseInt(reviewMatch[1]) : null;
            
            const product = {
                // Identifikasjon
                name,
                articleNumber,
                ean,
                brand,
                
                // Priser
                price,
                priceExVat,
                currency: 'NOK',
                
                // Kategorisering
                categories,
                
                // Beskrivelser
                description: description || null,
                features: features.length > 0 ? [...new Set(features)].slice(0, 20) : null,
                
                // Spesifikasjoner
                specs: Object.keys(specs).length > 0 ? specs : null,
                
                // Media
                images: images.length > 0 ? images.slice(0, 10) : null,
                
                // Tilgjengelighet
                inStock,
                availableInStores,
                
                // Vurderinger
                rating,
                reviewCount,
                
                // Metadata
                url: request.url,
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

// Steg 4: Lagre resultater til Dataset
await Actor.pushData(results);

// Steg 5: Oppdater cache i Key-Value Store
if (results.length > 0) {
    console.log('\nUpdating cache...');
    
    // Last eksisterende cache
    let cachedProducts = await kvStore.getValue('all-products') || [];
    const cacheMap = new Map(cachedProducts.map(p => [p.url, p]));
    
    // Oppdater/legg til nye produkter
    for (const product of results) {
        cacheMap.set(product.url, product);
    }
    
    // Konverter tilbake til array
    cachedProducts = Array.from(cacheMap.values());
    
    // Lagre oppdatert cache
    await kvStore.setValue('all-products', cachedProducts);
    console.log(`Cache updated: ${cachedProducts.length} total products`);
    
    // Lagre metadata
    await kvStore.setValue('cache-metadata', {
        lastUpdated: new Date().toISOString(),
        totalProducts: cachedProducts.length,
        lastRunScraped: results.length,
    });
}

console.log(`\n=== DONE ===`);
console.log(`Scraped ${results.length} products successfully`);

await Actor.exit();
