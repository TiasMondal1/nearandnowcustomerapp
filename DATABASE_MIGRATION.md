# Database Migration Guide

## Purpose
This guide helps you set up or update the `categories` table in your Supabase database to support the modernized Near & Now customer app.

**Note**: If you already have a `categories` table, skip to Step 2 to add missing columns.

---

## Step 1: Create the Categories Table (if it doesn't exist)

Run this SQL in your Supabase SQL Editor:

```sql
-- Create categories table
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  image_url TEXT,
  icon TEXT,
  color TEXT,
  display_order INTEGER DEFAULT 999,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_categories_slug 
  ON public.categories (slug);

CREATE INDEX IF NOT EXISTS idx_categories_active 
  ON public.categories (is_active, display_order);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION update_categories_updated_at();
```

---

## Step 2: Add Missing Columns (for existing tables)

If you already have a `categories` table, add any missing columns:

```sql
-- Add missing columns (only adds if they don't exist)
ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS slug TEXT,
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS icon TEXT,
ADD COLUMN IF NOT EXISTS color TEXT,
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 999,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Make slug unique (will fail if duplicates exist - fix those first)
ALTER TABLE public.categories 
ADD CONSTRAINT categories_slug_unique UNIQUE (slug);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_categories_slug 
  ON public.categories (slug);

CREATE INDEX IF NOT EXISTS idx_categories_active 
  ON public.categories (is_active, display_order);
```

---

## Step 2: Enable Row Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE public.master_categories ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (anon users can read active categories)
CREATE POLICY "Enable read access for all users"
  ON public.master_categories
  FOR SELECT
  USING (is_active = true);

-- Create policy for authenticated admin insert/update
-- (Adjust based on your admin user setup)
CREATE POLICY "Enable write access for authenticated users"
  ON public.master_categories
  FOR ALL
  USING (auth.role() = 'authenticated');
```sql
-- Enable RLS
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (anon users can read active categories)
CREATE POLICY "Enable read access for all users"
  ON public.categories
  FOR SELECT
  USING (is_active = true);

-- Create policy for authenticated admin insert/update
-- (Adjust based on your admin user setup)
CREATE POLICY "Enable write access for authenticated users"
  ON public.categories
  FOR ALL
  USING (auth.role() = 'authenticated');
```

---

## Step 3: Update Existing Categories (if you have data)

If your table already has categories, update them with slugs, icons, and colors:

```sql
-- Generate slugs from names (if missing)
UPDATE public.categories
SET slug = LOWER(REPLACE(name, ' ', '_'))
WHERE slug IS NULL OR slug = '';

-- Add icons and colors based on category names
UPDATE public.categories SET icon = 'apple', color = '#FF6B6B', display_order = 1 
WHERE LOWER(name) LIKE '%fruit%' AND icon IS NULL;

UPDATE public.categories SET icon = 'leaf', color = '#51CF66', display_order = 2 
WHERE LOWER(name) LIKE '%vegetable%' AND icon IS NULL;

UPDATE public.categories SET icon = 'cow', color = '#FFD43B', display_order = 3 
WHERE LOWER(name) LIKE '%dairy%' AND icon IS NULL;

UPDATE public.categories SET icon = 'cookie', color = '#845EF7', display_order = 4 
WHERE LOWER(name) LIKE '%snack%' AND icon IS NULL;

UPDATE public.categories SET icon = 'cup', color = '#339AF0', display_order = 5 
WHERE LOWER(name) LIKE '%beverage%' OR LOWER(name) LIKE '%drink%' AND icon IS NULL;

UPDATE public.categories SET icon = 'sack', color = '#FAB005', display_order = 6 
WHERE LOWER(name) LIKE '%staple%' OR LOWER(name) LIKE '%grain%' AND icon IS NULL;

UPDATE public.categories SET icon = 'face-woman-shimmer', color = '#E599F7', display_order = 7 
WHERE LOWER(name) LIKE '%personal%' OR LOWER(name) LIKE '%care%' AND icon IS NULL;

UPDATE public.categories SET icon = 'home-outline', color = '#74C0FC', display_order = 8 
WHERE LOWER(name) LIKE '%household%' OR LOWER(name) LIKE '%cleaning%' AND icon IS NULL;

-- Set remaining categories with default icon
UPDATE public.categories SET icon = 'package-variant', color = '#9E9E9E' 
WHERE icon IS NULL;

-- Ensure all categories are active
UPDATE public.categories SET is_active = true WHERE is_active IS NULL;
```

---

## Step 4: Insert Fresh Categories (if table is empty)

If you don't have categories yet, insert these defaults:

```sql
-- Insert default categories
INSERT INTO public.categories (name, slug, icon, color, display_order) VALUES
  ('Fruits', 'fruits', 'apple', '#FF6B6B', 1),
  ('Vegetables', 'vegetables', 'leaf', '#51CF66', 2),
  ('Dairy', 'dairy', 'cow', '#FFD43B', 3),
  ('Snacks', 'snacks', 'cookie', '#845EF7', 4),
  ('Beverages', 'beverages', 'cup', '#339AF0', 5),
  ('Staples', 'staples', 'sack', '#FAB005', 6),
  ('Personal Care', 'personal_care', 'face-woman-shimmer', '#E599F7', 7),
  ('Household', 'household', 'home-outline', '#74C0FC', 8)
ON CONFLICT (slug) DO NOTHING;
```

---

## Step 5: Verify Setup

```sql
-- Check all categories are created
SELECT * FROM public.categories ORDER BY display_order;

-- Count products per category
SELECT 
  c.name as category_name,
  COUNT(DISTINCT mp.id) as product_count
FROM public.categories c
LEFT JOIN public.master_products mp ON mp.category = c.name AND mp.is_active = true
WHERE c.is_active = true
GROUP BY c.name, c.display_order
ORDER BY c.display_order;
```

---

## Step 6: Update Existing Products (if needed)

If your products use different category names, update them:

```sql
-- Example: Update product categories to match new category names
UPDATE public.master_products
SET category = 'Fruits'
WHERE category IN ('fruits', 'Fruit', 'FRUITS');

UPDATE public.master_products
SET category = 'Vegetables'
WHERE category IN ('vegetables', 'Vegetable', 'VEGETABLES', 'Veggies');

-- Repeat for other categories as needed
```

---

## Optional: Add Category Images

To use custom category images instead of icons:

```sql
-- Update categories with image URLs
UPDATE public.categories
SET image_url = 'https://your-cdn.com/images/fruits.jpg'
WHERE slug = 'fruits';

UPDATE public.categories
SET image_url = 'https://your-cdn.com/images/vegetables.jpg'
WHERE slug = 'vegetables';

-- Continue for other categories...
```

**Note**: Image URLs should be publicly accessible. You can upload images to:
- Supabase Storage
- Cloudinary
- AWS S3
- Any CDN service

---

## Troubleshooting

### Categories not showing in app:

1. **Check RLS policies:**
   ```sql
   SELECT * FROM public.categories; -- Run as authenticated user
   ```

2. **Verify is_active flag:**
   ```sql
   UPDATE public.categories SET is_active = true;
   ```

3. **Check Supabase connection:**
   - Verify `EXPO_PUBLIC_SUPABASE_URL` in `.env`
   - Verify `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`

### Products not showing in categories:

1. **Check category name matching:**
   ```sql
   -- See which products don't match any category
   SELECT DISTINCT mp.category
   FROM public.master_products mp
   LEFT JOIN public.categories mc ON mp.category = mc.name
   WHERE mc.id IS NULL AND mp.is_active = true;
   ```

2. **Update mismatched products:**
   ```sql
   UPDATE public.master_products
   SET category = 'Vegetables'
   WHERE category = 'Veggies';
   ```

---

## Managing Categories (Admin)

### Add New Category:
```sql
INSERT INTO public.categories (name, slug, icon, color, display_order)
VALUES ('Frozen Foods', 'frozen_foods', 'snowflake', '#4FC3F7', 9);
```

### Reorder Categories:
```sql
UPDATE public.categories SET display_order = 1 WHERE slug = 'fruits';
UPDATE public.categories SET display_order = 2 WHERE slug = 'dairy';
-- etc...
```

### Disable Category (instead of deleting):
```sql
UPDATE public.categories
SET is_active = false
WHERE slug = 'old_category';
```

### Change Category Icon/Color:
```sql
UPDATE public.categories
SET icon = 'food-drumstick', color = '#FF5722'
WHERE slug = 'snacks';
```

---

## Icon Reference

Available MaterialCommunityIcons you can use:

- `apple` - Fruits
- `leaf` - Vegetables
- `cow` - Dairy
- `cookie` - Snacks/Bakery
- `cup` - Beverages
- `sack` - Staples/Grains
- `face-woman-shimmer` - Personal Care
- `home-outline` - Household
- `food-drumstick` - Meat
- `fish` - Seafood
- `snowflake` - Frozen
- `bottle-soda` - Drinks
- `bread-slice` - Bakery
- `carrot` - Vegetables (alt)
- `candy` - Sweets

Full icon list: https://pictogrammers.com/library/mdi/

---

## Rollback (if needed)

If you need to revert to hardcoded categories:

```sql
-- Drop table and all dependencies
DROP TABLE IF EXISTS public.categories CASCADE;
```

Then restore the old `constants/categoryConfig.ts` file from git history.

---

## Next Steps

After completing this migration:

1. ✅ Test categories loading in the app
2. ✅ Verify all products show in correct categories
3. ✅ Test pull-to-refresh functionality
4. ✅ Add category images (optional)
5. ✅ Update admin dashboard to manage categories (if you have one)

---

## Support

If you encounter issues:

1. Check Supabase logs in Dashboard → Logs
2. Check app console for error messages
3. Verify RLS policies are correct
4. Ensure products.category matches master_categories.name exactly (case-sensitive)

---

## Summary

This migration adds a database-driven category system to your app, making it easier to:
- Add/remove categories without code changes
- Manage category order dynamically
- Use custom category images
- Track category analytics
- Implement seasonal/promotional categories

Your app will now pull categories from Supabase instead of hardcoded config files!
