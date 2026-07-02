-- Phase 10 supplier and purchase order foundation

CREATE TABLE "suppliers" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "supplier_code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by_id" UUID,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "suppliers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "suppliers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "suppliers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "suppliers_shop_id_supplier_code_key" UNIQUE ("shop_id", "supplier_code")
);

CREATE INDEX "suppliers_shop_id_active_name_idx" ON "suppliers"("shop_id", "active", "name");

CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL,
  "shop_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "order_number" VARCHAR(60) NOT NULL,
  "order_date" DATE NOT NULL,
  "expected_date" DATE,
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "approved_at" TIMESTAMPTZ(6),
  "approved_by_id" UUID,
  "created_by_id" UUID,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_orders_status_check" CHECK ("status" IN ('DRAFT','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  CONSTRAINT "purchase_orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT,
  CONSTRAINT "purchase_orders_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_orders_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "purchase_orders_shop_id_order_number_key" UNIQUE ("shop_id", "order_number")
);

CREATE INDEX "purchase_orders_shop_id_status_order_date_idx" ON "purchase_orders"("shop_id", "status", "order_date");
CREATE INDEX "purchase_orders_shop_id_supplier_id_order_date_idx" ON "purchase_orders"("shop_id", "supplier_id", "order_date");
