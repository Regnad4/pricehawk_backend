scheduler.js
const cron = require('node-cron');
const db = require('./db');
const { scrapeProduct } = require('./scraper');
const { createNotification } = require('./notifications');
let globalPushToken = null;
function setPushToken(token) {
globalPushToken = token;
}
async function checkAllProducts() {
console.log(`[${new Date().toISOString()}] Running price check...`);
const products = db.get('products').filter({ is_active: 1 }).value();
for (const product of products) {
console.log(`Checking: ${product.name}`);
const result = await scrapeProduct(product.url);
if (!result.success || result.price === null) continue;
const newPrice = result.price;
const oldPrice = product.current_price;
const now = new Date().toISOString();
db.get('products').find({ id: product.id })
.assign({ current_price: newPrice, last_checked: now }).write();
const histId = db.get('_nextHistoryId').value();
db.get('price_history').push({ id: histId, product_id: product.id, price:
newPrice, recorded_at: now }).write();
db.set('_nextHistoryId', histId + 1).write();
if (newPrice <= product.target_price) {
const message = `Price dropped to $${newPrice.toFixed(2)}! Your target was
$${product.target_price.toFixed(2)}.`;
createNotification(product.id, message, oldPrice, newPrice, globalPushToken);
} else if (oldPrice && newPrice < oldPrice) {
const message = `Price dropped from $${oldPrice.toFixed(2)} to
$${newPrice.toFixed(2)}.`;
createNotification(product.id, message, oldPrice, newPrice, null);
}
}
console.log(`[${new Date().toISOString()}] Price check complete.`);
}
function startScheduler(cronExpression = '0 * * * *') {
console.log('Scheduler started - checking prices every hour.');
cron.schedule(cronExpression, checkAllProducts);
}
module.exports = { startScheduler, checkAllProducts, setPushToken };
