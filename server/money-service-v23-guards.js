const crypto = require('crypto');
const { prisma } = require('./prisma');
const { requireAuth, requireShopUser } = require('./auth-api');
const { ensureSchema } = require('./finance-settings-v23-api');

const DEFAULTS = [
  { name: 'Cash', type: 'CASH', code: 'CASH', kind: 'CASH', supports: false },
  { name: 'KPay', type: 'KPAY', code: 'KPAY', kind: 'WALLET', supports: true },
  { name: 'Wave Pay', type: 'WAVE_PAY', code: 'WAVE_PAY', kind: 'WALLET', supports: true },
];

async function findOrCreateAccount(shopId, item) {
  const existing = await prisma.moneyAccount.findFirst({
    where: { shopId, name: item.name },
    select: { id: true },
  });
  if (existing) return existing;

  try {
    return await prisma.moneyAccount.create({
      data: { shopId, name: item.name, type: item.type, active: true },
      select: { id: true },
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      const retry = await prisma.moneyAccount.findFirst({
        where: { shopId, name: item.name },
        select: { id: true },
      });
      if (retry) return retry;
    }
    throw error;
  }
}

async function ensurePaymentMethod(req, item, account, sortOrder) {
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id
       FROM finance_payment_methods
      WHERE shop_id=$1::uuid
        AND (LOWER(code)=LOWER($2) OR LOWER(name)=LOWER($3))
      LIMIT 1`,
    req.auth.shopId,
    item.code,
    item.name,
  );

  if (existing[0]) {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_payment_methods
          SET account_id=$3::uuid,
              supports_money_service=$4,
              active=TRUE,
              updated_at=NOW()
        WHERE id=$1::uuid AND shop_id=$2::uuid`,
      existing[0].id,
      req.auth.shopId,
      account.id,
      item.supports,
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO finance_payment_methods(
        id,shop_id,name,code,kind,account_id,supports_money_service,active,sort_order,created_by_id,created_at,updated_at
     )
     VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,TRUE,$8,$9::uuid,NOW(),NOW())
     ON CONFLICT DO NOTHING`,
    crypto.randomUUID(),
    req.auth.shopId,
    item.name,
    item.code,
    item.kind,
    account.id,
    item.supports,
    sortOrder,
    req.auth.userId,
  );
}

async function seedDefaults(req, _res, next) {
  try {
    await ensureSchema();
    for (let index = 0; index < DEFAULTS.length; index += 1) {
      const item = DEFAULTS[index];
      const account = await findOrCreateAccount(req.auth.shopId, item);
      await ensurePaymentMethod(req, item, account, index + 1);
    }
    next();
  } catch (error) {
    next(error);
  }
}

async function validateCashOutAccount(req, res, next) {
  try {
    if (req.body?.mode !== 'CASH_OUT') return next();

    const account = await prisma.moneyAccount.findFirst({
      where: { id: req.body?.cashAccountId, shopId: req.auth.shopId, active: true },
      select: { type: true, name: true },
    });

    if (!account) return res.status(404).json({ ok: false, message: 'Cash payout account not found' });
    if (account.type !== 'CASH') return res.status(400).json({ ok: false, message: 'Cash Out requires a CASH account' });

    next();
  } catch (error) {
    next(error);
  }
}

function attachMoneyServiceV23Guards(app) {
  app.use('/api/money-service', requireAuth, requireShopUser, seedDefaults);
  app.post('/api/money-service/transactions', validateCashOutAccount);
}

module.exports = attachMoneyServiceV23Guards;
