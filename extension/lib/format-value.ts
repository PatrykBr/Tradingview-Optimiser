/** Display unknown values without losing object contents to default string coercion. */
export const formatValue = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return String(value);

  try {
    return (
      JSON.stringify(value, (_key, entry: unknown) =>
        typeof entry === 'bigint' ? entry.toString() : entry,
      ) ?? '[Unserializable value]'
    );
  } catch {
    return '[Unserializable value]';
  }
};
