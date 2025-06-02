import React from 'react';

function Header() {
  return (
    <div className="bg-tv-gray-800 border-b border-tv-gray-700 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">TradingView Strategy Optimizer</h1>
          <p className="text-sm text-tv-gray-400 mt-1">Optimize your strategy parameters with Bayesian optimization</p>
        </div>
        <div className="text-xs text-tv-gray-500">
          v1.0.0
        </div>
      </div>
    </div>
  );
}

export default Header; 