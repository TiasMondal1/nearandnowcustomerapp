-- ============================================================
-- Database Optimizations for Near & Now Customer App
-- Run these in your Supabase SQL editor (once each).
-- ============================================================

-- ── 1. RPC for category counts (replaces 44-round-trip client loop) ──────────
-- Called by getCategoryCounts() in lib/productService.ts.
-- Returns one row per distinct category with product count — one network hop
-- instead of up to 44 paginated fetches of 1000 rows each.
CREATE OR REPLACE FUNCTION get_category_counts()
RETURNS TABLE(category text, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    LOWER(TRIM(COALESCE(category, 'Uncategorized'))) AS category,
    COUNT(*)::bigint AS cnt
  FROM master_products
  WHERE is_active = true
  GROUP BY 1;
$$;

GRANT EXECUTE ON FUNCTION get_category_counts() TO anon, authenticated;

-- ── 2. Indexes for master_products (44k rows) ─────────────────────────────────

-- Index for category-filtered queries (getProductsByCategory, getProductsPage).
-- Turns a sequential scan of 44k rows into an index seek.
CREATE INDEX IF NOT EXISTS idx_master_products_category_active
  ON master_products (category, is_active)
  WHERE is_active = true;

-- Index for popularity sorting (loadMasterCatalogFast, loadMasterCatalog).
CREATE INDEX IF NOT EXISTS idx_master_products_rating
  ON master_products (rating DESC NULLS LAST, rating_count DESC NULLS LAST)
  WHERE is_active = true;

-- Index for recency sorting fallback.
CREATE INDEX IF NOT EXISTS idx_master_products_created_at
  ON master_products (created_at DESC)
  WHERE is_active = true;

-- ── 3. Full-text search index (replaces ilike '%query%' sequential scan) ─────
-- ilike '%term%' on 44k rows does a full table scan even with a B-tree index.
-- pg_trgm enables GIN trigram indexes that make substring search fast.
--
-- Requires pg_trgm extension (available in Supabase by default):
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_master_products_name_trgm
  ON master_products USING GIN (name gin_trgm_ops)
  WHERE is_active = true;

-- Optional: combined name+category trgm index for the search OR query.
CREATE INDEX IF NOT EXISTS idx_master_products_search_trgm
  ON master_products USING GIN ((name || ' ' || COALESCE(category, '')) gin_trgm_ops)
  WHERE is_active = true;

-- ── 4. Orders indexes ─────────────────────────────────────────────────────────

-- getUserOrdersFromSupabase: filters by customer_id, orders by placed_at.
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_placed
  ON customer_orders (customer_id, placed_at DESC);

-- getOrderPaymentStatus: single-row lookup by order id.
-- (primary key already covers this — listed here for documentation)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_orders_id ON customer_orders (id);

-- store_orders → order_items join for the order detail screen.
CREATE INDEX IF NOT EXISTS idx_store_orders_customer_order_id
  ON store_orders (customer_order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_store_order_id
  ON order_items (store_order_id);

-- ── 5. Products table (store catalog) ────────────────────────────────────────
-- Used by createOrder to resolve master_product_id → products.id.
CREATE INDEX IF NOT EXISTS idx_products_master_product_id
  ON products (master_product_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_products_store_master
  ON products (store_id, master_product_id)
  WHERE is_active = true;

-- ── 6. Realtime subscription optimization ────────────────────────────────────
-- If you enable Realtime on customer_orders for order tracking, add a
-- publication filter so the socket only fires for rows the customer owns:
--
-- ALTER PUBLICATION supabase_realtime ADD TABLE customer_orders;
-- (Then filter in the client: .channel('...').on('postgres_changes', {
--   event: 'UPDATE', schema: 'public', table: 'customer_orders',
--   filter: `customer_id=eq.${userId}` }, handler)
-- )
--
-- This avoids broadcasting every order update to every connected customer.

-- ── 7. ANALYZE after index creation ──────────────────────────────────────────
ANALYZE master_products;
ANALYZE customer_orders;
ANALYZE store_orders;
ANALYZE order_items;
ANALYZE products;

-- ── 8. Row Level Security — public catalog reads ──────────────────────────────
-- The customer app no longer ships the service-role key in the bundle
-- (EXPO_PUBLIC_ removed). All catalog reads now use the anon key, which is
-- blocked by default when RLS is enabled. These policies open SELECT to both
-- anon and authenticated callers while leaving INSERT/UPDATE/DELETE gated.
--
-- master_products — public read (catalog is public, nothing sensitive here)
ALTER TABLE master_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read master_products" ON master_products;
CREATE POLICY "public read master_products"
  ON master_products FOR SELECT
  TO anon, authenticated
  USING (true);

-- categories — public read
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read categories" ON categories;
CREATE POLICY "public read categories"
  ON categories FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── 9. Full-text search RPC (replaces ilike client-side OR query) ─────────────
-- Called by searchProducts() in lib/productService.ts.
-- pg_trgm GIN index (created in step 3) makes this fast on 44k rows.
-- Returns up to `result_limit` rows ordered by trigram similarity then rating.
CREATE OR REPLACE FUNCTION search_products(query text, result_limit int DEFAULT 50)
RETURNS TABLE(
  id text,
  name text,
  category text,
  base_price numeric,
  discounted_price numeric,
  unit text,
  image_url text,
  is_loose boolean,
  is_active boolean,
  created_at timestamptz,
  rating numeric,
  rating_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    id::text,
    name::text,
    category::text,
    base_price::numeric,
    discounted_price::numeric,
    unit::text,
    image_url::text,
    is_loose::boolean,
    is_active::boolean,
    created_at::timestamptz,
    rating::numeric,
    rating_count::int
  FROM master_products
  WHERE is_active = true
    AND (
      name ILIKE '%' || query || '%'
      OR category ILIKE '%' || query || '%'
    )
  ORDER BY
    similarity(name, query) DESC,
    rating DESC NULLS LAST,
    rating_count DESC NULLS LAST
  LIMIT result_limit;
$$;

GRANT EXECUTE ON FUNCTION search_products(text, int) TO anon, authenticated;
