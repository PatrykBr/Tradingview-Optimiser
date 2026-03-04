/**
 * Sanitize a label string into a stable parameter ID.
 *
 * Used by both detector (to assign IDs) and injector (to match them).
 * H5: Use label text instead of fragile paramIndex counter.
 */
export function labelToId(label: string, section: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const prefix = section
    ? section
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') + '__'
    : '';
  return prefix + base;
}

/**
 * Build a stable, per-scan allocator for duplicate parameter labels.
 * The first occurrence keeps the base ID; subsequent duplicates get
 * a numeric suffix (`_2`, `_3`, ...).
 */
export function createScopedLabelIdAllocator() {
  const seen = new Map<string, number>();
  return (label: string, section: string): string => {
    const baseId = labelToId(label, section);
    const nextCount = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, nextCount);
    return nextCount === 1 ? baseId : `${baseId}_${nextCount}`;
  };
}
