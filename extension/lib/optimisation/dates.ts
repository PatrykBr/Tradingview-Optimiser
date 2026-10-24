export const DAY_MS = 24 * 60 * 60 * 1000;

export const parseDate = (value: string): number => {
  const timestamp = Date.parse(value + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    formatDate(timestamp) !== value
  ) {
    throw new Error('Invalid backtest date: ' + value);
  }
  return timestamp;
};

export const formatDate = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);
