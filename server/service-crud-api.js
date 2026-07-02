const crypto = require('crypto');
const { getDb } = require('./db');

function numberValue(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function table() {
  const db = await getDb();
  await db.exec('CREATE TABLE IF NOT EXISTS pos_service_jobs (id TEXT PRIMARY KEY, repair_id TEXT, job_date TEXT, customer TEXT, device TEXT, issue TEXT, status TEXT, pickup TEXT, cost REAL DEFAULT 0, raw_json TEXT NOT NULL)');
  return db;
}

function attachServiceCrudApi(app, { protect }) {
  app.post('/api/service-jobs', protect, async (req, res) => {
    const db = await table();
    const repairId = String(req.body.repairId || `MS${Date.now().toString().slice(-6)}`);
    const job = {
      id: `service_${crypto.randomUUID()}`,
      repairId,
      date: String(req.body.date || new Date().toISOString().slice(0, 10)),
      customer: String(req.body.customer || '').trim(),
      device: String(req.body.device || '').trim(),
      issue: String(req.body.issue || '').trim(),
      status: String(req.body.status || 'Pending'),
      pickup: String(req.body.pickup || 'Not Collected'),
      cost: numberValue(req.body.cost),
    };
    if (!job.customer || !job.device) return res.status(400).json({ ok: false, message: 'Customer and device are required' });
    await db.run('INSERT INTO pos_service_jobs (id, repair_id, job_date, customer, device, issue, status, pickup, cost, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', job.id, job.repairId, job.date, job.customer, job.device, job.issue, job.status, job.pickup, job.cost, JSON.stringify(job));
    res.status(201).json({ ok: true, job });
  });

  app.put('/api/service-jobs/:id', protect, async (req, res) => {
    const db = await table();
    const current = await db.get('SELECT * FROM pos_service_jobs WHERE id = ? OR repair_id = ?', req.params.id, req.params.id);
    if (!current) return res.status(404).json({ ok: false, message: 'Service job not found' });
    const job = {
      id: current.id,
      repairId: current.repair_id,
      date: String(req.body.date ?? current.job_date),
      customer: String(req.body.customer ?? current.customer),
      device: String(req.body.device ?? current.device),
      issue: String(req.body.issue ?? current.issue),
      status: String(req.body.status ?? current.status),
      pickup: String(req.body.pickup ?? current.pickup),
      cost: numberValue(req.body.cost ?? current.cost),
    };
    await db.run('UPDATE pos_service_jobs SET job_date=?, customer=?, device=?, issue=?, status=?, pickup=?, cost=?, raw_json=? WHERE id=?', job.date, job.customer, job.device, job.issue, job.status, job.pickup, job.cost, JSON.stringify(job), current.id);
    res.json({ ok: true, job });
  });

  app.delete('/api/service-jobs/:id', protect, async (req, res) => {
    const db = await table();
    const result = await db.run('DELETE FROM pos_service_jobs WHERE id = ? OR repair_id = ?', req.params.id, req.params.id);
    res.json({ ok: true, removed: result.changes || 0 });
  });
}

module.exports = attachServiceCrudApi;
