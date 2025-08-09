import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import pkg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

dotenv.config();
const { Pool } = pkg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(bodyParser.json());

// Swagger
const swaggerDocument = YAML.load('./swagger.yaml');
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/', (req, res) => res.json({ ok: true, service: 'darraa-pay-backend' }));

// إنشاء عملية دفع
app.post('/payments/create', async (req, res) => {
  const { orderId, amountMRU, provider } = req.body || {};
  if (!orderId || !amountMRU || !provider) return res.status(400).json({ error: 'missing fields' });
  try {
    const ts = Date.now();
    const prefix = provider === 'bankily' ? 'BK' : provider === 'sedad' ? 'SD' : 'MS';
    const merchantRef = `${prefix}-${ts}`;
    const result = await pool.query(
      `INSERT INTO payments (order_id, provider, amount, status, provider_ref, provider_payload)
       VALUES ($1,$2,$3,'pending',$4,$5) RETURNING id, provider_ref`,
      [orderId, provider, amountMRU, merchantRef, {}]
    );
    res.json({ paymentId: result.rows[0].id, merchantRef: result.rows[0].provider_ref });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

// حالة الدفع
app.get('/payments/:id/status', async (req, res) => {
  try {
    const q = await pool.query('SELECT status, provider_ref FROM payments WHERE id=$1', [req.params.id]);
    if (!q.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(q.rows[0]);
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

// توقيع الويبهوك
function verifySig(headerName, secretEnvName, req) {
  const sig = req.headers[headerName];
  if (!sig) return false;
  const payload = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', process.env[secretEnvName] || '').update(payload).digest('hex');
  return sig === expected;
}

// Webhooks
app.post('/webhooks/bankily', async (req, res) => {
  if (!verifySig('x-bankily-signature', 'BANKILY_SECRET', req)) return res.status(401).send('Invalid signature');
  const { merchantRef, status, providerRef } = req.body || {};
  try {
    await pool.query('UPDATE payments SET status=$1, provider_ref=$2 WHERE provider_ref=$3 AND provider=$4',
      [status === 'success' ? 'success' : 'failed', providerRef || merchantRef, merchantRef, 'bankily']);
    res.sendStatus(200);
  } catch { res.status(500).send('DB error'); }
});

app.post('/webhooks/sedad', async (req, res) => {
  if (!verifySig('x-sedad-signature', 'SEDAD_SECRET', req)) return res.status(401).send('Invalid signature');
  const { merchantRef, status, providerRef } = req.body || {};
  try {
    await pool.query('UPDATE payments SET status=$1, provider_ref=$2 WHERE provider_ref=$3 AND provider=$4',
      [status === 'success' ? 'success' : 'failed', providerRef || merchantRef, merchantRef, 'sedad']);
    res.sendStatus(200);
  } catch { res.status(500).send('DB error'); }
});

app.post('/webhooks/masrvi', async (req, res) => {
  if (!verifySig('x-masrvi-signature', 'MASRVI_SECRET', req)) return res.status(401).send('Invalid signature');
  const { merchantRef, status, providerRef } = req.body || {};
  try {
    await pool.query('UPDATE payments SET status=$1, provider_ref=$2 WHERE provider_ref=$3 AND provider=$4',
      [status === 'success' ? 'success' : 'failed', providerRef || merchantRef, merchantRef, 'masrvi']);
    res.sendStatus(200);
  } catch { res.status(500).send('DB error'); }
});

// محاكاة (تطوير فقط)
if (process.env.NODE_ENV !== 'production') {
  app.post('/simulate/webhook', async (req, res) => {
    const { secret, provider, merchantRef, status } = req.body || {};
    if (secret !== process.env.DEV_WEBHOOK_SECRET) return res.status(401).json({ error: 'Invalid dev secret' });
    if (!['bankily','sedad','masrvi'].includes(provider)) return res.status(400).json({ error: 'Unknown provider' });
    if (!['success','failed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
      const q = await pool.query('UPDATE payments SET status=$1 WHERE provider=$2 AND provider_ref=$3 RETURNING id',
        [status, provider, merchantRef]);
      if (!q.rowCount) return res.status(404).json({ error: 'Payment not found' });
      res.json({ ok: true, paymentId: q.rows[0].id, provider, merchantRef, status });
    } catch { res.status(500).json({ error: 'DB error' }); }
  });
}

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Backend listening on :${port}`));
