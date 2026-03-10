-- ===========================================
-- MINIMAL FIX - Add Only Required Columns
-- Run this in Supabase SQL Editor
-- ===========================================

-- Add the missing columns
ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS slug TEXT,
ADD COLUMN IF NOT EXISTS icon TEXT,
ADD COLUMN IF NOT EXISTS color TEXT,
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 999;

-- Generate slugs from names
UPDATE public.categories
SET slug = LOWER(REPLACE(TRIM(name), ' ', '_'))
WHERE slug IS NULL OR slug = '';

-- Set all as active
UPDATE public.categories
SET is_active = true
WHERE is_active IS NULL;

-- Set display order
UPDATE public.categories
SET display_order = ROW_NUMBER() OVER (ORDER BY name)
WHERE display_order IS NULL;

-- Add basic icons (adjust if your category names are different)
UPDATE public.categories SET icon = 'apple', color = '#FF6B6B' WHERE LOWER(name) LIKE '%fruit%';
UPDATE public.categories SET icon = 'leaf', color = '#51CF66' WHERE LOWER(name) LIKE '%vegetable%';
UPDATE public.categories SET icon = 'cow', color = '#FFD43B' WHERE LOWER(name) LIKE '%dairy%';
UPDATE public.categories SET icon = 'cookie', color = '#845EF7' WHERE LOWER(name) LIKE '%snack%';
UPDATE public.categories SET icon = 'cup', color = '#339AF0' WHERE LOWER(name) LIKE '%beverage%';
UPDATE public.categories SET icon = 'package-variant', color = '#9E9E9E' WHERE icon IS NULL;

-- Done! Now press 'r' in your terminal to reload the app
SELECT 'Success! Now reload your app by pressing r in the terminal' as message;
