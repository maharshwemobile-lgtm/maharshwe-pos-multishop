// Sheet → POS. The other half of the mirror.
//
// The shop works in both places: a repair is taken in at the counter, but the
// status often gets ticked off in the spreadsheet, because that is where the
// bench has always kept score. So an edit there has to reach the POS the same
// way a change here reaches the sheet.
//
// Two things this has to get right:
//
//   Loops. Applying a sheet edit must not queue the row straight back out to
//   the sheet, or one edit ping-pongs forever. Inbound updates are written with
//   the sheet sync suppressed.
//
//   Numbering. The sheet is the older book — it is up to 0977 while the POS had
//   only reached 0006. Voucher numbers issued here must continue that series
//   rather than collide with it, so every number the sheet reports raises the
//   POS high-water mark.

const { prisma } = require('./prisma');
const { REPAIR_STATUS_TEXT } = require('./repair-sheet-row');

// The sheet's wording, read back. Several POS states share one sheet word, so
// a word only moves the repair when it means something the repair is not yet.
const STATUS_FROM_SHEET = {
  'ပြင်ပြီး': 'COMPLETED',
  'ပြင်မရ': 'CANNOT_REPAIR',
  'ပြင်ရန်': 'IN_PROGRESS',
};

const PAYMENT_FROM_SHEET = {
  'ရှင်းပြီး': 'PAID',
  'တစ်ဝက်': 'PARTIAL',
};

// Strip the tick and any spacing so "ပြင်ပြီး ✅" and "ပြင်ပြီး" both read.
function sheetWord(value) {
  return String(value || '').replace(/[✅❌⏳]/g, '').replace(/\s+/g, ' ').trim();
}

function digitsOf(value) {
  const match = String(value || '').match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

// A repair a sheet row refers to: same shop, same trailing digits.
async function findRepairByVoucher(shopId, voucherNo) {
  const number = digitsOf(voucherNo);
  if (number === null) return null;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, repair_number AS "repairNumber", status, payment_status AS "paymentStatus",
            final_cost AS "finalCost", delivered_at AS "deliveredAt"
       FROM repairs
      WHERE shop_id = $1::uuid
        AND CAST(NULLIF(regexp_replace(repair_number, '^[A-Za-z]+', ''), '') AS INTEGER) = $2
      LIMIT 1`,
    shopId, number,
  ).catch(() => []);
  return rows[0] || null;
}

// Every number the sheet has used is one the POS must not issue again.
async function raiseSequence(shopId, prefix, value) {
  if (!prefix || !Number.isFinite(value) || value <= 0) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO repair_sequences (shop_id, period, last_value, updated_at)
     VALUES ($1::uuid, $2, $3, NOW())
     ON CONFLICT (shop_id, period)
     DO UPDATE SET last_value = GREATEST(repair_sequences.last_value, EXCLUDED.last_value), updated_at = NOW()`,
    shopId, prefix, Math.trunc(value),
  ).catch(() => {});
}

/**
 * Apply one sheet row to the POS. Returns what changed, or why nothing did.
 * Never queues an outbound sync — that is what would start a loop.
 */
async function applySheetRow(shopId, prefix, row) {
  const voucherNo = String(row.voucherNo || row['Repair ID/Voucher'] || '').trim();
  if (!voucherNo) return { voucherNo, applied: false, reason: 'no voucher number' };

  await raiseSequence(shopId, prefix, digitsOf(voucherNo));

  const repair = await findRepairByVoucher(shopId, voucherNo);
  if (!repair) return { voucherNo, applied: false, reason: 'not in POS' };

  const changes = {};
  const status = STATUS_FROM_SHEET[sheetWord(row.repairStatus)];
  // ပြင်ရန် covers everything before it is finished, so it must not drag a
  // repair backwards out of a state the counter already moved it to.
  const inFlight = ['RECEIVED', 'CHECKING', 'IN_PROGRESS', 'WAITING_PART'];
  if (status && status !== repair.status) {
    if (!(status === 'IN_PROGRESS' && inFlight.includes(repair.status))) changes.status = status;
  }
  // The sheet marks collection in its own column: blank once the customer has
  // taken the phone, မယူရသေး while it is still on the shelf. It moves the
  // collection time and leaves the repair state alone.
  if (row.pickupStatus !== undefined) {
    const waiting = sheetWord(row.pickupStatus).startsWith('မယူ');
    const collected = sheetWord(row.pickupStatus) === '';
    if (collected && !repair.deliveredAt) changes.pickedUp = true;
    if (waiting && repair.deliveredAt) changes.pickedUp = false;
  }

  const payment = PAYMENT_FROM_SHEET[sheetWord(row.paymentStatus)];
  if (payment && payment !== repair.paymentStatus) changes.paymentStatus = payment;

  const price = Number(String(row.customerPrice || '').replace(/[^\d.]/g, ''));
  if (Number.isFinite(price) && price > 0 && price !== Number(repair.finalCost || 0)) changes.finalCost = price;

  if (!Object.keys(changes).length) return { voucherNo, applied: false, reason: 'already matches' };

  await prisma.$executeRawUnsafe(
    `UPDATE repairs SET
        status = COALESCE($3::"RepairStatus", status),
        payment_status = COALESCE($4::"PaymentStatus", payment_status),
        final_cost = COALESCE($5::numeric, final_cost),
        delivered_at = CASE
          WHEN $6::boolean IS TRUE THEN COALESCE(delivered_at, NOW())
          WHEN $6::boolean IS FALSE THEN NULL
          ELSE delivered_at END,
        completed_at = CASE WHEN $3 IN ('COMPLETED','CANNOT_REPAIR') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
        updated_at = NOW()
      WHERE id = $1::uuid AND shop_id = $2::uuid`,
    repair.id, shopId,
    changes.status || null,
    changes.paymentStatus || null,
    changes.finalCost === undefined ? null : changes.finalCost,
    changes.pickedUp === undefined ? null : changes.pickedUp,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO repair_events (id, shop_id, repair_id, event_type, status, source, note, payload, occurred_at)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'SHEET_EDIT', $3, 'GOOGLE_SHEET', $4, $5::jsonb, NOW())`,
    shopId, repair.id, changes.status || repair.status,
    'Google Sheet မှ ပြင်ဆင်မှု', JSON.stringify(changes),
  ).catch(() => {});

  return { voucherNo, applied: true, repairNumber: repair.repairNumber, changes };
}

module.exports = { applySheetRow, raiseSequence, STATUS_FROM_SHEET, PAYMENT_FROM_SHEET, sheetWord, digitsOf };
