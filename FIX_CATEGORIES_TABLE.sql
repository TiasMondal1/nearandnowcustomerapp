-- ============================================
-- QUICK FIX: Add Missing Columns to Categories Table
-- ============================================

-- Step 1: Check what columns you currently have
-- Copy the result to see what's missing
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'categories'
ORDER BY ordinal_position;

-- Step 2: Add missing columns (safe - only adds if they don't exist)
-- Run all of these - they will skip any that already exist

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS slug TEXT;

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS icon TEXT;

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS color TEXT;

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 999;

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now();

ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Step 3: Generate slugs from names (if slug column was just added)
UPDATE public.categories
SET slug = LOWER(REPLACE(TRIM(name), ' ', '_'))
WHERE slug IS NULL OR slug = '';

-- Step 4: Set default values for new columns
UPDATE public.categories
SET is_active = true
WHERE is_active IS NULL;

UPDATE public.categories
SET display_order = ROW_NUMBER() OVER (ORDER BY name)
WHERE display_order IS NULL;

-- Step 5: Add icons and colors based on category names
-- (Adjust these based on your actual category names)

UPDATE public.categories 
SET icon = 'apple', color = '#FF6B6B' 
WHERE (LOWER(name) LIKE '%fruit%' OR LOWER(name) LIKE '%apple%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'leaf', color = '#51CF66' 
WHERE (LOWER(name) LIKE '%vegetable%' OR LOWER(name) LIKE '%veggie%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'cow', color = '#FFD43B' 
WHERE LOWER(name) LIKE '%dairy%' 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'cookie', color = '#845EF7' 
WHERE (LOWER(name) LIKE '%snack%' OR LOWER(name) LIKE '%biscuit%' OR LOWER(name) LIKE '%cookie%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'cup', color = '#339AF0' 
WHERE (LOWER(name) LIKE '%beverage%' OR LOWER(name) LIKE '%drink%' OR LOWER(name) LIKE '%juice%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'sack', color = '#FAB005' 
WHERE (LOWER(name) LIKE '%staple%' OR LOWER(name) LIKE '%grain%' OR LOWER(name) LIKE '%rice%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'face-woman-shimmer', color = '#E599F7' 
WHERE (LOWER(name) LIKE '%personal%' OR LOWER(name) LIKE '%care%' OR LOWER(name) LIKE '%hygiene%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'home-outline', color = '#74C0FC' 
WHERE (LOWER(name) LIKE '%household%' OR LOWER(name) LIKE '%cleaning%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'fish', color = '#26C6DA' 
WHERE (LOWER(name) LIKE '%seafood%' OR LOWER(name) LIKE '%fish%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'food-drumstick', color = '#FF5722' 
WHERE (LOWER(name) LIKE '%meat%' OR LOWER(name) LIKE '%chicken%' OR LOWER(name) LIKE '%mutton%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'bread-slice', color = '#FFA726' 
WHERE (LOWER(name) LIKE '%bakery%' OR LOWER(name) LIKE '%bread%') 
  AND (icon IS NULL OR icon = '');

UPDATE public.categories 
SET icon = 'snowflake', color = '#4FC3F7' 
WHERE LOWER(name) LIKE '%frozen%' 
  AND (icon IS NULL OR icon = '');

-- Set default icon/color for any remaining categories
UPDATE public.categories 
SET icon = 'package-variant', color = '#9E9E9E' 
WHERE icon IS NULL OR icon = '';

-- Step 6: Make slug unique (optional - remove if you get errors about duplicates)
-- First check for duplicates:
SELECT slug, COUNT(*) 
FROM public.categories 
GROUP BY slug 
HAVING COUNT(*) > 1;

-- If no duplicates, make it unique:
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'categories_slug_unique'
  ) THEN
    ALTER TABLE public.categories 
    ADD CONSTRAINT categories_slug_unique UNIQUE (slug);
  END IF;
END $$;

-- Step 7: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_categories_slug 
  ON public.categories (slug);

CREATE INDEX IF NOT EXISTS idx_categories_active 
  ON public.categories (is_active, display_order);

-- Step 8: Verify everything worked
SELECT 
  id, 
  name, 
  slug, 
  icon, 
  color, 
  display_order, 
  is_active
FROM public.categories
ORDER BY display_order NULLS LAST, name;

-- ============================================
-- DONE! Now reload your app
-- ============================================
