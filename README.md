# TradingView Strategy Optimizer

[![Build Status](https://github.com/PatrykBr/Tradingview-Optimiser/actions/workflows/ci.yml/badge.svg)](https://github.com/PatrykBr/Tradingview-Optimiser/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/PatrykBr/Tradingview-Optimiser)](https://github.com/PatrykBr/Tradingview-Optimiser/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/PatrykBr/Tradingview-Optimiser?style=social)](https://github.com/PatrykBr/Tradingview-Optimiser/stargazers)

A browser extension that optimizes TradingView strategy parameters using Bayesian optimization.

## Features

- Automatically tests different parameter combinations on TradingView strategies
- Uses machine learning to find optimal configurations
- Supports Chrome and Firefox browsers
- Maximizes profit factor, Sharpe ratio, and other trading metrics

## Installation

### Browser Extension

1. Download the latest release
2. Extract the ZIP file
3. Open Chrome/Firefox and go to extensions
4. Enable "Developer mode"
5. Click "Load unpacked" and select the extracted folder

### Python Backend

```bash
pip install -r requirements.txt
python start_server.py
```

## Usage

1. Start the Python server
2. Open TradingView and load a strategy
3. Click the extension icon
4. Configure optimization parameters
5. Start optimization

## Development

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Build extension
npm run build:chrome
npm run build:firefox

# Start development
npm run dev
python start_server.py
```

## License

MIT
