const { prisma } = require('./prisma');

let schemaPromise;

// Whether a phone is sold new or second-hand decides which warranty the slip
// prints. It is set on the category, because that is how a shop already keeps
// the two apart -- a "Phone" shelf and a second-hand one -- and marking two
// hundred products one at a time to say the same thing would be busywork.
//
// The answer is copied onto the sale line at the moment of sale, the same way
// the category name is: a slip reprinted a year later has to say what was
// promised on the day, not what the category says now.
//
// These columns are added here rather than through a migration: this database
// was reconstructed from the live server and Prisma migrations were never run
// against it.
const statements = [
  `ALTER TABLE categories ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT 'NEW'`,
  `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS condition_snapshot TEXT`,
  // Why a discount was given, written at the counter -- "swapped for a Note 13
  // Pro second-hand". Prisma reads every column of a sale, so on a new database
  // this has to run before anything lists sales; the live one had it added by
  // hand ahead of the deploy for that reason.
  `ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_note TEXT`,
];

async function ensureProductConditionSchema() {
  if (!schemaPromise) {
    schemaPromise = prisma.$transaction(async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      return true;
    }, { maxWait: 5000, timeout: 30000 }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { ensureProductConditionSchema };
