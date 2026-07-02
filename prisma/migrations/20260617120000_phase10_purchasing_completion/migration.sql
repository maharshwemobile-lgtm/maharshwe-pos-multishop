-- Phase 10 purchasing completion: receiving, supplier payments, returns and repair-part costing

ALTER TABLE "purchase_order_items"
  ADD COLUMN IF NOT EXISTS "returned_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "purchase_order_items"
  DROP CONSTRAINT IF EXISTS "purchase_order_items_returned_quantity_check";

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_returned_quantity_check"
  CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "received_quantity");

CREATE TABLE IF NOT EXISTS "purchase_receipts" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "receipt_number" VARCHAR(60) NOT NULL,
  "received_date" DATE NOT NULL,
  "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_receipts_amount_check" CHECK ("total_amount" >= 0),
  CONSTRAINT "purchase_receipts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "purchase_receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_receipts_shop_id_receipt_number_key" UNIQUE ("shop_id", "receipt_number")
);

CREATE INDEX IF NOT EXISTS "purchase_receipts_shop_id_received_date_idx"
  ON "purchase_receipts"("shop_id", "received_date");
CREATE INDEX IF NOT EXISTS "purchase_receipts_shop_id_purchase_order_id_idx"
  ON "purchase_receipts"("shop_id", "purchase_order_id");

CREATE TABLE IF NOT EXISTS "purchase_receipt_items" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "purchase_receipt_id" UUID NOT NULL,
  "purchase_order_item_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "before_quantity" INTEGER NOT NULL,
  "after_quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_receipt_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "purchase_receipt_items_amount_check" CHECK ("unit_cost" >= 0 AND "line_total" >= 0),
  CONSTRAINT "purchase_receipt_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_receipt_items_purchase_receipt_id_fkey" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_receipt_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT,
  CONSTRAINT "purchase_receipt_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "purchase_receipt_items_shop_id_receipt_idx"
  ON "purchase_receipt_items"("shop_id", "purchase_receipt_id");
CREATE INDEX IF NOT EXISTS "purchase_receipt_items_shop_id_variant_idx"
  ON "purchase_receipt_items"("shop_id", "product_variant_id");

CREATE TABLE IF NOT EXISTS "supplier_payments" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "purchase_order_id" UUID,
  "payment_number" VARCHAR(60) NOT NULL,
  "payment_date" DATE NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "method" VARCHAR(30) NOT NULL,
  "money_account_id" UUID,
  "reference" VARCHAR(180),
  "note" TEXT,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "supplier_payments_method_check" CHECK ("method" IN ('CASH','KPAY','WAVE_PAY','OTHER')),
  CONSTRAINT "supplier_payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  CONSTRAINT "supplier_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "supplier_payments_money_account_id_fkey" FOREIGN KEY ("money_account_id") REFERENCES "money_accounts"("id") ON DELETE SET NULL,
  CONSTRAINT "supplier_payments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "supplier_payments_shop_id_payment_number_key" UNIQUE ("shop_id", "payment_number")
);

CREATE INDEX IF NOT EXISTS "supplier_payments_shop_id_supplier_date_idx"
  ON "supplier_payments"("shop_id", "supplier_id", "payment_date");
CREATE INDEX IF NOT EXISTS "supplier_payments_shop_id_order_idx"
  ON "supplier_payments"("shop_id", "purchase_order_id");

CREATE TABLE IF NOT EXISTS "purchase_returns" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "return_number" VARCHAR(60) NOT NULL,
  "return_date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_returns_amount_check" CHECK ("total_amount" >= 0),
  CONSTRAINT "purchase_returns_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  CONSTRAINT "purchase_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "purchase_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_returns_shop_id_return_number_key" UNIQUE ("shop_id", "return_number")
);

CREATE INDEX IF NOT EXISTS "purchase_returns_shop_id_return_date_idx"
  ON "purchase_returns"("shop_id", "return_date");
CREATE INDEX IF NOT EXISTS "purchase_returns_shop_id_order_idx"
  ON "purchase_returns"("shop_id", "purchase_order_id");

CREATE TABLE IF NOT EXISTS "purchase_return_items" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "purchase_return_id" UUID NOT NULL,
  "purchase_order_item_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "product_name_snapshot" VARCHAR(180) NOT NULL,
  "variant_name_snapshot" VARCHAR(180),
  "sku_snapshot" VARCHAR(100),
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "before_quantity" INTEGER NOT NULL,
  "after_quantity" INTEGER NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_return_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "purchase_return_items_amount_check" CHECK ("unit_cost" >= 0 AND "line_total" >= 0),
  CONSTRAINT "purchase_return_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_return_items_purchase_return_id_fkey" FOREIGN KEY ("purchase_return_id") REFERENCES "purchase_returns"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_return_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT,
  CONSTRAINT "purchase_return_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "purchase_return_items_shop_id_return_idx"
  ON "purchase_return_items"("shop_id", "purchase_return_id");
CREATE INDEX IF NOT EXISTS "purchase_return_items_shop_id_variant_idx"
  ON "purchase_return_items"("shop_id", "product_variant_id");

CREATE TABLE IF NOT EXISTS "repair_part_usages" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "repair_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "before_quantity" INTEGER NOT NULL,
  "after_quantity" INTEGER NOT NULL,
  "note" TEXT,
  "reversed_at" TIMESTAMPTZ(6),
  "reversal_reason" TEXT,
  "created_by_id" UUID,
  "reversed_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "repair_part_usages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "repair_part_usages_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "repair_part_usages_amount_check" CHECK ("unit_cost" >= 0 AND "total_cost" >= 0),
  CONSTRAINT "repair_part_usages_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "repair_part_usages_repair_id_fkey" FOREIGN KEY ("repair_id") REFERENCES "repairs"("id") ON DELETE CASCADE,
  CONSTRAINT "repair_part_usages_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT,
  CONSTRAINT "repair_part_usages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "repair_part_usages_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "repair_part_usages_shop_id_repair_idx"
  ON "repair_part_usages"("shop_id", "repair_id", "created_at");
CREATE INDEX IF NOT EXISTS "repair_part_usages_shop_id_variant_idx"
  ON "repair_part_usages"("shop_id", "product_variant_id");
