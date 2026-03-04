// Backend connection
export const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL ?? 'ws://localhost:8765/ws/optimize';
export const BACKEND_HEALTH_URL = import.meta.env.VITE_BACKEND_HEALTH_URL ?? 'http://localhost:8765/health';
export const MAX_BACKEND_MESSAGE_BYTES = 256 * 1024;

// Storage keys
export const STORAGE_KEYS = {
  SAVED_CONFIGS: 'saved_configs',
  FAVORITE_METRICS: 'favorite_metrics',
  LAST_OPTIMIZATION_STATE: 'last_optimization_state',
} as const;

// Anti-detection defaults
// Delays applied between trials (not between individual field edits).
// 200-600ms provides natural spacing between dialog close → reopen.
export const DEFAULT_ANTI_DETECTION = {
  enabled: true,
  minDelay: 200,
  maxDelay: 600,
} as const;

// Optimization defaults
export const DEFAULT_TOTAL_TRIALS = 50;
export const MAX_HISTORY_RUNS = 100;

// Available metrics (all available from TradingView performance summary)
export const AVAILABLE_METRICS = [
  // Top bar metrics
  { name: 'Total P&L', section: 'Top Bar', defaultDirection: 'maximize' as const },
  { name: 'Max equity drawdown', section: 'Top Bar', defaultDirection: 'minimize' as const },
  { name: 'Total trades', section: 'Top Bar', defaultDirection: 'maximize' as const },
  { name: 'Profitable trades', section: 'Top Bar', defaultDirection: 'maximize' as const },
  { name: 'Profit factor', section: 'Top Bar', defaultDirection: 'maximize' as const },

  // Returns
  { name: 'Net P&L', section: 'Returns', defaultDirection: 'maximize' as const },
  { name: 'Gross profit', section: 'Returns', defaultDirection: 'maximize' as const },
  { name: 'Gross loss', section: 'Returns', defaultDirection: 'minimize' as const },
  { name: 'Commission paid', section: 'Returns', defaultDirection: 'minimize' as const },
  { name: 'Expected payoff', section: 'Returns', defaultDirection: 'maximize' as const },

  // Ratios
  { name: 'Sharpe ratio', section: 'Ratios', defaultDirection: 'maximize' as const },
  { name: 'Sortino ratio', section: 'Ratios', defaultDirection: 'maximize' as const },

  // Benchmarking
  { name: 'Strategy outperformance', section: 'Benchmarking', defaultDirection: 'maximize' as const },

  // Trade Analysis
  { name: 'Winning trades', section: 'Trades', defaultDirection: 'maximize' as const },
  { name: 'Losing trades', section: 'Trades', defaultDirection: 'minimize' as const },
  { name: 'Percent profitable', section: 'Trades', defaultDirection: 'maximize' as const },
  { name: 'Avg P&L', section: 'Trades', defaultDirection: 'maximize' as const },
  { name: 'Avg winning trade', section: 'Trades', defaultDirection: 'maximize' as const },
  { name: 'Avg losing trade', section: 'Trades', defaultDirection: 'minimize' as const },
  { name: 'Ratio avg win / avg loss', section: 'Trades', defaultDirection: 'maximize' as const },
  { name: 'Largest winning trade', section: 'Trades', defaultDirection: 'maximize' as const },
  { name: 'Largest losing trade', section: 'Trades', defaultDirection: 'minimize' as const },

  // Capital Efficiency
  { name: 'Annualized return (CAGR)', section: 'Capital', defaultDirection: 'maximize' as const },
  { name: 'Return on initial capital', section: 'Capital', defaultDirection: 'maximize' as const },
  { name: 'Return on account size required', section: 'Capital', defaultDirection: 'maximize' as const },
  { name: 'Net profit as % of largest loss', section: 'Capital', defaultDirection: 'maximize' as const },

  // Run-ups and Drawdowns
  { name: 'Max equity run-up (close-to-close)', section: 'Drawdowns', defaultDirection: 'maximize' as const },
  { name: 'Max equity drawdown (close-to-close)', section: 'Drawdowns', defaultDirection: 'minimize' as const },
  { name: 'Return of max equity drawdown', section: 'Drawdowns', defaultDirection: 'maximize' as const },
] as const;

// Filter operators
export const FILTER_OPERATORS = [
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '==', label: '==' },
  { value: '!=', label: '!=' },
] as const;
