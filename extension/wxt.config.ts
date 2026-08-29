import react from '@vitejs/plugin-react';
import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    plugins: [react()],
  }),
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
