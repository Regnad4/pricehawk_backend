server.js
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { scrapeProduct } = require('./scraper');
const { startScheduler, checkAllProducts, setPushToken } =
require('./scheduler');
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());
// nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn
// PRODUCTS
// nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn
app.get('/api/products', (req, res) => {
const products = db.get('products').sortBy(p => -new
Date(p.created_at)).value();
res.json(products);
});
app.get('/api/products/:id', (req, res) => {
const product = db.get('products').find({ id: req.params.id }).value();
if (!product) return res.status(404).json({ error: 'Product not found' });
const history = db.get('price_history')
.filter({ product_id: req.params.id })
.sortBy('recorded_at')
.value();
res.json({ ...product, history });
});
app.post('/api/products', async (req, res) => {
const { url, target_price, name: manualName } = req.body;
if (!url || !target_price) {
return res.status(400).json({ error: 'url and target_price are required' });
}
const scraped = await scrapeProduct(url);
const id = uuidv4();
const now = new Date().toISOString();
const product = {
id,
name: manualName || scraped.name || 'Unknown Product',
url,
image_url: scraped.imageUrl || null,
current_price: scraped.price || null,
target_price: parseFloat(target_price),
currency: 'USD',
last_checked: now,
created_at: now,
is_active: 1,
};
db.get('products').push(product).write();
if (scraped.price) {
const histId = db.get('_nextHistoryId').value();
db.get('price_history').push({ id: histId, product_id: id, price:
scraped.price, recorded_at: now }).write();
db.set('_nextHistoryId', histId + 1).write();
}
res.status(201).json(product);
});
app.patch('/api/products/:id', (req, res) => {
const { target_price, is_active, name } = req.body;
const product = db.get('products').find({ id: req.params.id });
if (!product.value()) return res.status(404).json({ error: 'Product not found'
});
const updates = {};
if (target_price !== undefined) updates.target_price =
parseFloat(target_price);
if (is_active !== undefined) updates.is_active = is_active;
if (name !== undefined) updates.name = name;
product.assign(updates).write();
res.json(product.value());
});
app.delete('/api/products/:id', (req, res) => {
db.get('products').remove({ id: req.params.id }).write();
db.get('price_history').remove({ product_id: req.params.id }).write();
db.get('notifications').remove({ product_id: req.params.id }).write();
res.json({ success: true });
});
app.post('/api/products/:id/check', async (req, res) => {
const product = db.get('products').find({ id: req.params.id }).value();
if (!product) return res.status(404).json({ error: 'Product not found' });
const result = await scrapeProduct(product.url);
if (!result.success) return res.status(500).json({ error: result.error });
const now = new Date().toISOString();
db.get('products').find({ id: req.params.id }).assign({ current_price:
result.price, last_checked: now }).write();
if (result.price) {
const histId = db.get('_nextHistoryId').value();
db.get('price_history').push({ id: histId, product_id: req.params.id, price:
result.price, recorded_at: now }).write();
db.set('_nextHistoryId', histId + 1).write();
}
const updated = db.get('products').find({ id: req.params.id }).value();
res.json({ price: result.price, product: updated });
});
app.post('/api/scrape-preview', async (req, res) => {
const { url } = req.body;
if (!url) return res.status(400).json({ error: 'url is required' });
const result = await scrapeProduct(url);
res.json(result);
});
// nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn
// NOTIFICATIONS
// nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn
app.get('/api/notifications', (req, res) => {
const notifications = db.get('notifications').sortBy(n => -new
Date(n.created_at)).take(50).value();
const products = db.get('products').value();
const withNames = notifications.map(n => ({
...n,
product_name: products.find(p => p.id === n.product_id)?.name || 'Unknown',
}));
res.json(withNames);
});
app.patch('/api/notifications/read', (req, res) => {
const { ids } = req.body;
if (ids === 'all') {
db.get('notifications').each(n => { n.is_read = 1; }).write();
} else if (Array.isArray(ids)) {
ids.forEach(id => {
db.get('notifications').find({ id }).assign({ is_read: 1 }).write();
});
}
res.json({ success: true });
});
// nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn
// PUSH TOKEN
// nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn
app.post('/api/register-push-token', (req, res) => {
const { token } = req.body;
if (!token) return res.status(400).json({ error: 'token is required' });
setPushToken(token);
res.json({ success: true });
});
// nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn
// MANUAL TRIGGER
// nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn
app.post('/api/run-check', async (req, res) => {
await checkAllProducts();
res.json({ success: true, message: 'Price check complete' });
});
app.get('/api/health', (req, res) => {
res.json({ status: 'ok', time: new Date().toISOString() });
});
app.listen(PORT, '0.0.0.0', () => {
console.log(`PriceHawk backend running on port ${PORT}`);
startScheduler();
});
