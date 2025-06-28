// Available metrics for optimization and filtering

export function getAvailableMetrics() {
  return [
    {
      key: 'netProfit',
      name: 'Net Profit',
      format: 'currency',
      description: 'Total profit or loss from all trades'
    },
    {
      key: 'totalTrades',
      name: 'Total Trades',
      format: 'number',
      description: 'Number of completed trades'
    },
    {
      key: 'percentProfitable',
      name: 'Percent Profitable',
      format: 'percentage',
      description: 'Percentage of winning trades'
    },
    {
      key: 'maxDrawdown',
      name: 'Max Drawdown',
      format: 'percentage',
      description: 'Maximum peak-to-trough decline'
    },
    {
      key: 'avgTrade',
      name: 'Avg P&L',
      format: 'currency',
      description: 'Average profit/loss per trade'
    },
    {
      key: 'avgBarsInTrade',
      name: 'Avg # bars in trades',
      format: 'number',
      description: 'Average number of bars in trades'
    },
    {
      key: 'sharpeRatio',
      name: 'Sharpe Ratio',
      format: 'number',
      description: 'Risk-adjusted return metric'
    },
    {
      key: 'sortinoRatio',
      name: 'Sortino Ratio',
      format: 'number',
      description: 'Downside risk-adjusted return metric'
    },
    {
      key: 'profitFactor',
      name: 'Profit Factor',
      format: 'number',
      description: 'Ratio of gross profit to gross loss'
    }
  ];
}

 