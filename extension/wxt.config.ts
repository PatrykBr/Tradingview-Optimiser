import { defineConfig } from 'wxt';
import react from '@wxt-dev/module-react';

export default defineConfig({
  modules: [react()],
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
