const crypto = require('crypto');
const { getDb } = require('./db');

function numberValue(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function table() {
  const db = await getDb();
  await db.exec('CREATE TABLE IF NOT EXISTS pos_products (id TEXT PRIMARY KEY, brand TEXT, model TEXT, category TEXT, cost_price REAL DEFAULT 0, selling_price REAL DEFAULT 0, stock_qty REAL DEFAULT 0, raw_json TEXT NOT NULL)');
  return db;
}

function attachProductCrudApi(app, { protect }) {
  app.post('/api/products', protect, async (req, res) => {
    const db = await table();
    const product = {
      id: req.body.id || `product_${crypto.randomUUID()}`,
      brand: String(req.body.brand || '').trim(),
      model: String(req.body.model || '').trim(),
      category: String(req.body.category || 'Accessories').trim(),
      costPrice: numberValue(req.body.costPrice),
      sellingPrice: numberValue(req.body.sellingPrice),
      stockQty: numberValue(req.body.stockQty),
    };
    if (!product.brand && !product.model) return res.status(400).json({ ok: false, message: 'Brand or model is required' });
    await db.run('INSERT INTO pos_products (id, brand, model, category, cost_price, selling_price, stock_qty, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', product.id, product.brand, product.model, product.category, product.costPrice, product.sellingPrice, product.stockQty, JSON.stringify(product));
    res.status(201).json({ ok: true, product });
  });

  app.put('/api/products/:id', protect, async (req, res) => {
    const db = await table();
    const current = await db.get('SELECT * FROM pos_products WHERE id = ?', req.params.id);
    if (!current) return res.status(404).json({ ok: false, message: 'Product not found' });
    const product = {
      id: req.params.id,
      brand: String(req.body.brand ?? current.brand ?? '').trim(),
      model: String(req.body.model ?? current.model ?? '').trim(),
      category: String(req.body.category ?? current.category ?? '').trim(),
      costPrice: numberValue(req.body.costPrice ?? current.cost_price),
      sellingPrice: numberValue(req.body.sellingPrice ?? current.selling_price),
      stockQty: numberValue(req.body.stockQty ?? current.stock_qty),
    };
    await db.run('UPDATE pos_products SET brand=?, model=?, category=?, cost_price=?, selling_price=?, stock_qty=?, raw_json=? WHERE id=?', product.brand, product.model, product.category, product.costPrice, product.sellingPrice, product.stockQty, JSON.stringify(product), req.params.id);
    res.json({ ok: true, product });
  });

  app.delete('/api/products/:id', protect, async (req, res) => {
    const db = await table();
    const result = await db.run('DELETE FROM pos_products WHERE id = ?', req.params.id);
    res.json({ ok: true, removed: result.changes || 0 });
  });
}

module.exports = attachProductCrudApi;
