scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
// Headers to mimic a real browser
const HEADERS = {
'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
'Accept':
'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
'Accept-Language': 'en-US,en;q=0.5',
'Accept-Encoding': 'gzip, deflate',
'Connection': 'keep-alive',
};
/**
* Parse a price string into a float (e.g. "$1,299.99" => 1299.99)
*/
function parsePrice(priceStr) {
if (!priceStr) return null;
const cleaned = priceStr.replace(/[^0-9.,]/g, '').replace(',', '');
const value = parseFloat(cleaned);
return isNaN(value) ? null : value;
}
/**
* Scrape Amazon product page
*/
async function scrapeAmazon(url, $) {
const name =
$('#productTitle').text().trim() ||
$('h1.a-size-large').text().trim();
const priceSelectors = [
'.a-price .a-offscreen',
'#priceblock_ourprice',
'#priceblock_dealprice',
'.a-price-whole',
'#price_inside_buybox',
];
let priceStr = null;
for (const sel of priceSelectors) {
const el = $(sel).first();
if (el.length) {
priceStr = el.text().trim();
break;
}
}
const imageUrl =
$('#landingImage').attr('src') ||
$('#imgBlkFront').attr('src') ||
null;
return {
name: name || 'Amazon Product',
price: parsePrice(priceStr),
imageUrl,
currency: 'USD',
};
}
/**
* Scrape eBay product page
*/
async function scrapeEbay(url, $) {
const name = $('h1.x-item-title__mainTitle span').text().trim() ||
$('h1').first().text().trim();
const priceStr =
$('.x-price-primary .ux-textspans').first().text().trim() ||
$('[itemprop="price"]').attr('content') ||
$('.display-price').first().text().trim();
const imageUrl = $('img.ux-image-magnify__image--original').attr('src') ||
null;
return {
name: name || 'eBay Product',
price: parsePrice(priceStr),
imageUrl,
currency: 'USD',
};
}
/**
* Generic scraper - tries common patterns
*/
async function scrapeGeneric($, url) {
// Try meta tags first (OpenGraph etc.)
const ogTitle = $('meta[property="og:title"]').attr('content');
const ogImage = $('meta[property="og:image"]').attr('content');
const name =
ogTitle ||
$('[itemprop="name"]').first().text().trim() ||
$('h1').first().text().trim() ||
'Unknown Product';
// Try structured data
const priceFromMeta =
$('[itemprop="price"]').attr('content') ||
$('[itemprop="price"]').text().trim() ||
$('meta[property="product:price:amount"]').attr('content');
// Try common CSS patterns
const commonPriceSelectors = [
'.price',
'.product-price',
'.sale-price',
'#price',
'[class*="price"]',
'[id*="price"]',
'.offer-price',
'.final-price',
];
let priceStr = priceFromMeta;
if (!priceStr) {
for (const sel of commonPriceSelectors) {
const el = $(sel).first();
if (el.length && el.text().match(/[\d.,$€£]/)) {
priceStr = el.text().trim();
break;
}
}
}
return {
name,
price: parsePrice(priceStr),
imageUrl: ogImage || null,
currency: 'USD',
};
}
/**
* Main scrape function - detects site and delegates
*/
async function scrapeProduct(url) {
try {
const response = await axios.get(url, {
headers: HEADERS,
timeout: 15000,
maxRedirects: 5,
});
const $ = cheerio.load(response.data);
const hostname = new URL(url).hostname.toLowerCase();
let result;
if (hostname.includes('amazon')) {
result = await scrapeAmazon(url, $);
} else if (hostname.includes('ebay')) {
result = await scrapeEbay(url, $);
} else {
result = await scrapeGeneric($, url);
}
return { success: true, ...result };
} catch (err) {
console.error(`Scrape failed for ${url}:`, err.message);
return { success: false, error: err.message };
}
}
module.exports = { scrapeProduct };
