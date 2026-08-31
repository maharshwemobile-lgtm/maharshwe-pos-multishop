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
// 0977 as the POS writes it, MS0978 where somebody typed the prefix in.
const VOUCHER_PATTERN = /^[A-Za-z]{0,8}\d{1,6}$/;

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

// The repair a sheet row refers to, found by the paper voucher it carries.
// Rows imported before the two numbers were separated have no external
// reference, so the old match on trailing digits stays as a fallback for them.
async function findRepairByVoucher(shopId, voucherNo) {
  const key = String(voucherNo || '').trim();
  if (!key) return null;
  const columns = `id, repair_number AS "repairNumber", status, payment_status AS "paymentStatus",
            final_cost AS "finalCost", delivered_at AS "deliveredAt",
            customer_name AS "customerName", device_brand AS "deviceBrand",
            device_model AS "deviceModel", problem, notes`;

  const byReference = await prisma.$queryRawUnsafe(
    `SELECT ${columns} FROM repairs
      WHERE shop_id = $1::uuid AND external_repair_id = $2 LIMIT 1`,
    shopId, key,
  ).catch(() => []);
  if (byReference[0]) return byReference[0];

  const number = digitsOf(key);
  if (number === null) return null;
  const byNumber = await prisma.$queryRawUnsafe(
    `SELECT ${columns} FROM repairs
      WHERE shop_id = $1::uuid
        AND external_repair_id IS NULL
        AND CAST(NULLIF(regexp_replace(repair_number, '^[A-Za-z]+', ''), '') AS INTEGER) = $2
      LIMIT 1`,
    shopId, number,
  ).catch(() => []);
  return byNumber[0] || null;
}

// The machine's own series, taken the same way the counter takes it.
async function nextRepairNumber(shopId, prefix) {
  const code = String(prefix || 'RP').toUpperCase();
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO repair_sequences (shop_id, period, last_value, updated_at)
     VALUES ($1::uuid, $2, 1, NOW())
     ON CONFLICT (shop_id, period)
     DO UPDATE SET last_value = repair_sequences.last_value + 1, updated_at = NOW()
     RETURNING last_value`,
    shopId, code,
  );
  return `${code}${String(rows[0].last_value).padStart(4, '0')}`;
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

// dd/mm/yyyy, the way the sheet writes it. Anything else is left to Date.
function sheetDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// "Oppo A16" — the sheet keeps brand and model in one cell, so the first word
// is the brand and the rest is the model. One word is a model with no brand.
function splitDevice(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { brand: null, model: parts[0] || null };
  return { brand: parts[0], model: parts.slice(1).join(' ') };
}

/**
 * A row the POS has never seen. The shop takes repairs in at the counter and
 * through the bot into the sheet, so a voucher written there has to become a
 * repair here rather than being reported missing forever.
 *
 * Only rows that describe an actual job are taken: a voucher number on its own,
 * or a half-typed line, is left alone until it says who and what.
 */
async function createRepairFromSheet(shopId, prefix, voucherNo, row, trusted) {
  // Rows from other tabs reach here when an older script reports the whole
  // workbook. They do not look like an intake: a VPN key row arrived as a
  // customer called "Available" with no phone, and a credit row as "50000".
  // A voucher is digits, and a real intake names both a person and a phone.
  const customerName = String(row.customerName || '').trim();
  const device = splitDevice(row.phoneModel);
  // Where the callback named the tab and the server matched it, the row is
  // known to come from the repair book and an older entry missing a model is
  // still a repair. Without that assurance, take only rows that carry both.
  if (trusted ? (!customerName && !device.model) : (!customerName || !device.model)) return null;

  const repairNumber = await nextRepairNumber(shopId, prefix);
  const status = STATUS_FROM_SHEET[sheetWord(row.repairStatus)] || 'RECEIVED';
  const payment = PAYMENT_FROM_SHEET[sheetWord(row.paymentStatus)] || 'PENDING';
  const price = Number(String(row.customerPrice || '').replace(/[^\d.]/g, ''));
  const collected = row.pickupStatus !== undefined && sheetWord(row.pickupStatus) === '';

  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO repairs (
       id, shop_id, repair_number, customer_name, device_brand, device_model,
       problem, final_cost, payment_status, status, received_at, delivered_at,
       completed_at, notes, source_type, source_provider, priority,
       external_repair_id, created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1::uuid, $2, $3, $4, $5,
       -- final_cost is NOT NULL with a default of 0, and passing an explicit
       -- NULL overrides the default rather than falling back to it.
       $6, COALESCE($7::numeric, 0), $8::"PaymentStatus", $9::"RepairStatus", COALESCE($10::timestamptz, NOW()),
       CASE WHEN $11::boolean IS TRUE THEN NOW() ELSE NULL END,
       CASE WHEN $9 IN ('COMPLETED','CANNOT_REPAIR') THEN NOW() ELSE NULL END,
       $12, 'IMPORTED', 'GOOGLE_SHEET', 'NORMAL',
       $13, NOW(), NOW()
     )
     ON CONFLICT DO NOTHING
     RETURNING id, repair_number AS "repairNumber"`,
    shopId,
    repairNumber,
    customerName || 'စောင့်ယူ',
    device.brand,
    device.model,
    // Blank in the book means nothing was written down. A dash here is an
    // invention, and it goes straight back out to the sheet as one.
    String(row.repairPart || '').trim(),
    Number.isFinite(price) && price > 0 ? price : null,
    payment,
    status,
    sheetDate(row.date),
    collected,
    String(row.note || '').trim() || null,
    String(voucherNo).trim(),
  ).catch((error) => {
    console.warn('Sheet row could not be created as a repair:', error.message);
    return [];
  });

  return rows[0] || null;
}

/**
 * Apply one sheet row to the POS. Returns what changed, or why nothing did.
 * Never queues an outbound sync — that is what would start a loop.
 */
async function applySheetRow(shopId, prefix, row, trusted = false) {
  const voucherNo = String(row.voucherNo || row['Repair ID/Voucher'] || '').trim();
  if (!voucherNo) return { voucherNo, applied: false, reason: 'no voucher number' };

  if (!VOUCHER_PATTERN.test(voucherNo)) {
    return { voucherNo, applied: false, reason: 'not a voucher number' };
  }
  // The two numbers are kept apart on purpose. The paper voucher belongs to the
  // book and the POS number belongs to the machine; letting the book drive the
  // machine's counter is what pushed it to 4590. The sheet's number is carried
  // as an external reference instead.

  let repair = await findRepairByVoucher(shopId, voucherNo);
  if (!repair) {
    const created = await createRepairFromSheet(shopId, prefix, voucherNo, row, trusted);
    if (!created) return { voucherNo, applied: false, reason: 'not in POS' };
    return { voucherNo, applied: true, created: true, repairNumber: created.repairNumber };
  }

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

  // A row is typed left to right, and the trigger fires on the way. The repair
  // gets created as soon as the voucher and the name are down, and everything
  // typed after that — the fault, most often — never arrived, because only the
  // status and the money were ever compared. Filled-in text is carried too now.
  //
  // Only a value that is actually there overwrites: blank in the sheet means
  // not written down yet, never "clear what the counter recorded".
  const device = splitDevice(row.phoneModel);
  const text = {
    customerName: String(row.customerName || '').trim(),
    deviceBrand: device.brand || '',
    deviceModel: device.model || '',
    problem: String(row.repairPart || '').trim(),
    notes: String(row.note || '').trim(),
  };
  Object.keys(text).forEach((field) => {
    const value = text[field];
    if (value && value !== String(repair[field] || '').trim()) changes[field] = value;
  });

  if (!Object.keys(changes).length) return { voucherNo, applied: false, reason: 'already matches' };

  await prisma.$executeRawUnsafe(
    `UPDATE repairs SET
        status = COALESCE($3::"RepairStatus", status),
        payment_status = COALESCE($4::"PaymentStatus", payment_status),
        final_cost = COALESCE($5::numeric, final_cost),
        customer_name = COALESCE($7, customer_name),
        device_brand = COALESCE($8, device_brand),
        device_model = COALESCE($9, device_model),
        problem = COALESCE($10, problem),
        notes = COALESCE($11, notes),
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
    changes.customerName ?? null,
    changes.deviceBrand ?? null,
    changes.deviceModel ?? null,
    changes.problem ?? null,
    changes.notes ?? null,
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
