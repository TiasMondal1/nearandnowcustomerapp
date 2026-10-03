import { logSilentFailure } from './logSilentFailure';
import { cached, peek, QC_KEYS, seedFromDisk } from './queryCache';
import { supabase } from './supabase';

export interface Category {
  id: string;
  name: string;
  slug: string;
  image_url?: string;
  icon?: string;
  color?: string;
  display_order?: number;
  is_active?: boolean;
  created_at?: string;
}

const CATEGORIES_TTL_MS = 3_600_000; // 60 min in memory
const CATEGORIES_PERSIST = { key: 'nn:qc:categories', version: 1, maxAgeMs: 7 * 86_400_000 } as const; // 7 d on disk

/**
 * Inner fetcher — THROWS on a Supabase error and on an empty result so
 * `cached()` never stores a failure (C8: one transient error used to persist
 * `categories: []` and hide the chips for the whole TTL). `.limit(500)` keeps
 * the select explicit about PostgREST's silent 1000-row cap.
 */
async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('display_order', { ascending: true })
    .limit(500);

  if (error) throw new Error(`Database error: ${error.message}`);

  // Filter by is_active in code if the column exists.
  const categories = ((data ?? []) as Category[]).filter((cat) => cat.is_active !== false);
  if (categories.length === 0) throw new Error('No categories returned');
  return categories;
}

/**
 * All active categories in display order.
 * `cached(QC_KEYS.categories, 60 min, persist 'nn:qc:categories' v1, maxAge 7 d)`;
 * `force` (pull-to-refresh) skips memory. Never rejects: on failure it logs
 * and resolves the last known list (`peek`) or `[]` — and that `[]` is NOT cached.
 */
export async function getAllCategories(opts?: { force?: boolean }): Promise<Category[]> {
  try {
    return await cached<Category[]>(QC_KEYS.categories, fetchCategories, {
      ttlMs: CATEGORIES_TTL_MS,
      persist: CATEGORIES_PERSIST,
      force: opts?.force,
    });
  } catch (err) {
    logSilentFailure('Fetch categories', err);
    return peek<Category[]>(QC_KEYS.categories) ?? [];
  }
}

/**
 * Loads the persisted `nn:qc:categories` row into memory (TTL 0: `peekCategories()` paints it on frame 1 while the
 * first `getAllCategories()` still revalidates). Called once from app/_layout.tsx module scope. Never rejects.
 */
export async function seedCategoriesFromDisk(): Promise<void> {
  await seedFromDisk<Category[]>(QC_KEYS.categories, CATEGORIES_PERSIST);
}

/** Synchronous memory read (may be stale beyond the TTL) for first paint; `undefined` when nothing is cached yet. */
export function peekCategories(): Category[] | undefined {
  return peek<Category[]>(QC_KEYS.categories);
}

/**
 * Exact, case-insensitive, trimmed name match → `slug` (fixes C15: slugs are
 * a DB column, never derived from the name). `null` when no category matches.
 */
export function resolveCategorySlug(name: string, categories: Category[]): string | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const hit = categories.find((c) => c.name.trim().toLowerCase() === needle);
  return hit ? hit.slug : null;
}

/**
 * Category by slug — memory first (`peekCategories()`), then one network row.
 * `null` when the slug is unknown, inactive, or the fetch fails (logged).
 */
export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const wanted = slug.trim();
  if (!wanted) return null;

  const fromMemory = peekCategories()?.find((c) => c.slug === wanted);
  if (fromMemory) return fromMemory.is_active === false ? null : fromMemory;

  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('slug', wanted)
      .limit(1)
      .maybeSingle();

    if (error) {
      logSilentFailure('Fetch category', error);
      return null;
    }

    const category = (data ?? null) as Category | null;
    if (!category || category.is_active === false) return null;
    return category;
  } catch (err) {
    logSilentFailure('Fetch category', err);
    return null;
  }
}
