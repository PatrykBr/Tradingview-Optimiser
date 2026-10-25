/** Display unknown values without losing object contents to default string coercion. */
export const formatValue = (value: unknown): string => {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'symbol':
    case 'function':
      return value.toString();
    case 'undefined':
      return 'undefined';
    default:
      break;
  }

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
