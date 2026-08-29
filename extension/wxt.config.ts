import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'TradingView Optuna Optimiser',
    description: 'Optimise the Pine strategy on your current TradingView chart with Optuna v5.',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['https://*.tradingview.com/*'],
    action: {
      default_title: 'Toggle optimiser',
    },
  },
});
