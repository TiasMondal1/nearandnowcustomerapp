// codename: lyra
import { getMemoryHomeCache, type HomeCatalogCache, type Product } from './productService';

/** One pre-lowercased row per catalog product; rebuilt only when the memory catalog object changes. */
type IndexRow = { p: Product; name: string; cat: string };

const DEFAULT_LIMIT = 20;
const MIN_QUERY_LENGTH = 2;

let indexFor: HomeCatalogCache | null = null;
let rows: IndexRow[] = [];

function getIndex(): IndexRow[] {
  const cache = getMemoryHomeCache();
  if (!cache) {
    indexFor = null;
    rows = [];
    return rows;
  }
  if (indexFor !== cache) {
    rows = cache.products.map((p) => ({
      p,
      name: (p.name || '').toLowerCase(),
      cat: (p.category || '').toLowerCase(),
    }));
    indexFor = cache;
  }
  return rows;
}

/**
 * Relevance of one row for a lower-cased, trimmed query (0 = no match):
 * 3 = name starts with the query · 2 = a later word of the name starts with it ·
 * 1 = substring anywhere in the name · 0.5 = substring in the category.
 */
function scoreRow(row: IndexRow, q: string): number {
  if (row.name.startsWith(q)) return 3;
  const at = row.name.indexOf(q);
  if (at > 0) {
    const before = row.name.charCodeAt(at - 1);
    // Word boundary: space, hyphen, slash, bracket, comma, dot.
    const isBoundary =
      before === 32 || before === 45 || before === 47 || before === 40 || before === 44 || before === 46;
    return isBoundary ? 2 : 1;
  }
  if (row.cat.includes(q)) return 0.5;
  return 0;
}

/**
 * Instant results from the memory catalog (`getMemoryHomeCache()?.products`)
 * for the search screen's keystroke path — no network, ~O(n) over a
 * pre-lowercased index, well under 5 ms for a few thousand products.
 *
 * - `query` is trimmed and lower-cased; shorter than 2 characters → `[]`
 * - `nearbyIds`: `undefined` = whole catalog, empty Set = `[]`, Set = only those ids
 * - ranked prefix (3) > word-prefix (2) > substring in name (1) > substring in category (0.5),
 *   ties keep catalog order (stable); capped at `limit` (default 20)
 * - `[]` until the catalog is in memory
 */
export function searchLocal(
  query: string,
  nearbyIds: Set<string> | undefined,
  limit: number = DEFAULT_LIMIT,
): Product[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];
  if (nearbyIds !== undefined && nearbyIds.size === 0) return [];
  if (limit <= 0) return [];

  const index = getIndex();
  if (index.length === 0) return [];

  const hits: { p: Product; score: number; i: number }[] = [];
  for (let i = 0; i < index.length; i++) {
    const row = index[i];
    if (nearbyIds && !nearbyIds.has(row.p.id)) continue;
    const score = scoreRow(row, q);
    if (score > 0) hits.push({ p: row.p, score, i });
  }
  if (hits.length === 0) return [];

  hits.sort((a, b) => b.score - a.score || a.i - b.i);
  const out: Product[] = [];
  for (let i = 0; i < hits.length && out.length < limit; i++) out.push(hits[i].p);
  return out;
}

/** Local results first, then server results not already present (dedupe by `id`); `limit` caps the merged list when given. */
export function mergeSearchResults(local: Product[], server: Product[], limit?: number): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of [...local, ...server]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return limit != null ? out.slice(0, limit) : out;
}
