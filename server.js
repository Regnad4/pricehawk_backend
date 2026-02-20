const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { scrapeProduct } = require('./scraper');
const { startScheduler, checkAllProducts, setPushToken } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────

// GET all products
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json(products);
});

// GET single product with price history
app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const history = db.prepare(
    'SELECT price, recorded_at FROM price_history WHERE product_id = ? ORDER BY recorded_at ASC'
  ).all(req.params.id);

  res.json({ ...product, history });
});

// POST add a new product to track
app.post('/api/products', async (req, res) => {
  const { url, target_price, name: manualName } = req.body;

  if (!url || !target_price) {
    return res.status(400).json({ error: 'url and target_price are required' });
  }

  // Scrape initial info
  const scraped = await scrapeProduct(url);

  const id = uuidv4();
  const productName = manualName || scraped.name || 'Unknown Product';
  const currentPrice = scraped.price || null;

  db.prepare(`
    INSERT INTO products (id, name, url, image_url, current_price, target_price, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, productName, url, scraped.imageUrl || null, currentPrice, parseFloat(target_price), 'USD');

  if (currentPrice) {
    db.prepare('INSERT INTO price_history (product_id, price) VALUES (?, ?)').run(id, currentPrice);
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.status(201).json(product);
});

// PATCH update target price or active status
app.patch('/api/products/:id', (req, res) => {
  const { target_price, is_active, name } = req.body;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  db.prepare(`
    UPDATE products
    SET target_price = COALESCE(?, target_price),
        is_active = COALESCE(?, is_active),
        name = COALESCE(?, name)
    WHERE id = ?
  `).run(target_price ?? null, is_active ?? null, name ?? null, req.params.id);

  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// DELETE remove a product
app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM price_history WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM notifications WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST manually trigger a price check for one product
app.post('/api/products/:id/check', async (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const result = await scrapeProduct(product.url);
  if (!result.success) return res.status(500).json({ error: result.error });

  db.prepare(`
    UPDATE products SET current_price = ?, last_checked = datetime('now') WHERE id = ?
  `).run(result.price, req.params.id);

  if (result.price) {
    db.prepare('INSERT INTO price_history (product_id, price) VALUES (?, ?)').run(req.params.id, result.price);
  }

  res.json({ price: result.price, product: db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) });
});

// POST preview scrape a URL before adding
app.post('/api/scrape-preview', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const result = await scrapeProduct(url);
  res.json(result);
});

// ─────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────

// GET all notifications
app.get('/api/notifications', (req, res) => {
  const notifications = db.prepare(`
    SELECT n.*, p.name as product_name
    FROM notifications n
    LEFT JOIN products p ON n.product_id = p.id
    ORDER BY n.created_at DESC
    LIMIT 50
  `).all();
  res.json(notifications);
});

// PATCH mark notification(s) as read
app.patch('/api/notifications/read', (req, res) => {
  const { ids } = req.body; // array of ids, or 'all'
  if (ids === 'all') {
    db.prepare('UPDATE notifications SET is_read = 1').run();
  } else if (Array.isArray(ids)) {
    const stmt = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?');
    ids.forEach(id => stmt.run(id));
  }
  res.json({ success: true });
});

// ─────────────────────────────────────────
// PUSH TOKEN REGISTRATION
// ─────────────────────────────────────────

app.post('/api/register-push-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  setPushToken(token);
  res.json({ success: true });
});

// ─────────────────────────────────────────
// MANUAL TRIGGER (dev/testing)
// ─────────────────────────────────────────

app.post('/api/run-check', async (req, res) => {
  await checkAllProducts();
  res.json({ success: true, message: 'Price check complete' });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🦅 PriceHawk backend running on http://localhost:${PORT}`);
  startScheduler(); // every hour
});
