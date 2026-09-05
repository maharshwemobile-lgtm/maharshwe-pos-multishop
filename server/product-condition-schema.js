const { prisma } = require('./prisma');

let schemaPromise;

// Whether a phone is sold new or second-hand decides which warranty the slip
// prints, so it is recorded on the product and copied onto the sale line at the
// moment of sale -- the same way the category name is. A slip reprinted a year
// later has to say what was promised then, not what the product says now.
//
// These columns are added here rather than through a migration: this database
// was reconstructed from the live server and Prisma migrations were never run
// against it.
const statements = [
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT 'NEW'`,
  `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS condition_snapshot TEXT`,
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
