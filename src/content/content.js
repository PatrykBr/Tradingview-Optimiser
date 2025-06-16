// Content script for TradingView Strategy Optimizer
// This script runs in the context of TradingView pages

(async function() {
  'use strict';

  // Load DOM selectors configuration
  let domSelectors = {};
  try {
    const response = await fetch(chrome.runtime.getURL('config/dom_selectors.json'));
    domSelectors = await response.json();
  } catch (error) {
    console.error('Failed to load DOM selectors:', error);
  }

  // Utility functions for DOM interaction
  const DOMUtils = {
    // Wait for element to appear
    async waitForElement(selector, timeout = 10000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        const element = document.querySelector(selector);
        if (element) return element;
        await this.delay(100);
      }
      throw new Error(`Element ${selector} not found within ${timeout}ms`);
    },

    // Wait for any of multiple selectors
    async waitForAnyElement(selectors, timeout = 10000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) return element;
        }
        await this.delay(100);
      }
      throw new Error(`None of the elements found within ${timeout}ms`);
    },

    // Random delay for anti-detection
    async delay(ms) {
      const antiDetection = await this.getAntiDetectionSettings();
      const randomDelay = Math.random() * (antiDetection.maxDelay - antiDetection.minDelay) + antiDetection.minDelay;
      return new Promise(resolve => setTimeout(resolve, ms || randomDelay));
    },

    // Get anti-detection settings from storage
    async getAntiDetectionSettings() {
      return new Promise(resolve => {
        chrome.storage.local.get('antiDetection', (data) => {
          resolve(data.antiDetection || { minDelay: 500, maxDelay: 2000 });
        });
      });
    },

    // Click element with anti-detection delay
    async clickElement(element) {
      await this.delay();
      ['mousedown','mouseup','click'].forEach(type => {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      await this.delay();
    },

    // Right click element
    async rightClickElement(element) {
      await this.delay();
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: element.getBoundingClientRect().left + 10,
        clientY: element.getBoundingClientRect().top + 10
      });
      element.dispatchEvent(event);
      await this.delay();
    },

    // Hover element to reveal hidden buttons
    async hoverElement(element) {
      // Pause before hover
      await this.delay();
      // Dispatch hover events
      ['mouseover', 'mousemove', 'mouseenter'].forEach(type => {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      // Pause after hover
      await this.delay();
    },

    // Set input value with events
    setInputValue(input, value) {
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
    },

    // Parse metric value based on type
    parseMetricValue(text, parser) {
      if (!text) return null;
      
      // Clean up the text
      text = text.trim();
      // Normalize unicode minus sign to ASCII hyphen
      text = text.replace(/\u2212/g, '-');
      
      switch (parser) {
        case 'currency':
          // Remove currency symbols and parse
          return parseFloat(text.replace(/[^0-9.-]/g, ''));
        case 'percentage':
          // Remove % and parse
          return parseFloat(text.replace('%', ''));
        case 'number':
          // Parse as float
          return parseFloat(text);
        default:
          return text;
      }
    }
  };

  // Strategy detection and reading
  const StrategyManager = {
    // Detect all strategies on the chart
    async detectStrategies() {
      const strategies = [];
      const containers = document.querySelectorAll(domSelectors.strategy.container);
      
      containers.forEach((container, index) => {
        const titleElement = container.querySelector(domSelectors.strategy.title);
        if (titleElement) {
          strategies.push({
            index,
            name: titleElement.textContent.trim(),
            element: container
          });
        }
      });
      
      return strategies;
    },

    // Read settings for a specific strategy
    async readStrategySettings(strategyIndex) {
      console.log('Reading settings for strategy index:', strategyIndex);
      
      const strategies = await this.detectStrategies();
      if (strategyIndex >= strategies.length) {
        throw new Error('Strategy index out of range');
      }

      const strategy = strategies[strategyIndex];
      console.log('Strategy:', strategy.name);
      
      // Use legend button to open settings quickly
      const legendButton = strategy.element.querySelector(domSelectors.strategy.settingsButton);
      if (!legendButton) {
        throw new Error('Legend settings button not found');
      }
      console.log('Clicking legend settings button');
      ['mousedown','mouseup','click'].forEach(type => {
        legendButton.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      const dialog = await DOMUtils.waitForElement(domSelectors.settingsDialog.container, 5000);
      console.log('Settings dialog opened');
      
      // Click on inputs tab if exists
      const inputsTab = dialog.querySelector(domSelectors.settingsDialog.tabInputs);
      if (inputsTab && !inputsTab.classList.contains('selected')) {
        console.log('Clicking inputs tab');
        inputsTab.click();
        await DOMUtils.delay(100);
      }

      // Read all settings
      const settings = [];
      const inputRows = dialog.querySelectorAll(domSelectors.settingsDialog.inputRow);
      console.log('Found input rows:', inputRows.length);
      
      for (const row of inputRows) {
        // Identify input types first to determine label strategy
        const checkboxInput = row.querySelector(domSelectors.settingsDialog.checkboxInput);
        const selectInput = row.querySelector(domSelectors.settingsDialog.selectInput);
        const inputElement = row.querySelector('input:not([type="checkbox"])');
        
        // Skip rows that don't have any input elements
        if (!checkboxInput && !selectInput && !inputElement) continue;
        
        let label = null;
        let setting = {
          name: '',
          type: null,
          value: null,
          options: []
        };

        // For dropdown/select inputs, the label is usually in the previous row
        if (selectInput) {
          const prev = row.previousElementSibling;
          if (prev && prev.matches('div.cell-tBgV1m0B.first-tBgV1m0B')) {
            const prevLabel = prev.querySelector('div.inner-tBgV1m0B');
            if (prevLabel && prevLabel.textContent.trim()) {
              label = prevLabel;
            }
          }
          // If no previous label found, try current row
          if (!label) {
            label = row.querySelector(domSelectors.settingsDialog.inputLabel) || 
                   row.querySelector('label') || 
                   row.querySelector('[class*="label"]') || 
                   row.querySelector('span');
          }
          
          setting.type = 'select';
          setting.value = selectInput.textContent.trim();
          setting.options = await this.getDropdownOptions(selectInput);
        }
        // For checkboxes and number inputs, try current row first, then previous if needed
        else {
          label = row.querySelector(domSelectors.settingsDialog.inputLabel);
          if (!label) {
            label = row.querySelector('label') || row.querySelector('[class*="label"]') || row.querySelector('span');
          }
          // If label text is empty, fallback to preceding key cell label
          if (!label || !label.textContent.trim()) {
            const prev = row.previousElementSibling;
            if (prev && prev.matches('div.cell-tBgV1m0B.first-tBgV1m0B')) {
              const alt = prev.querySelector('div.inner-tBgV1m0B');
              if (alt) label = alt;
            }
          }
          
          if (checkboxInput) {
            setting.type = 'checkbox';
            setting.value = checkboxInput.checked;
          } else if (inputElement) {
            setting.type = 'number';
            setting.value = inputElement.value;
          }
        }

        // Set the setting name from the label
        if (label && label.textContent.trim()) {
          setting.name = label.textContent.trim();
          settings.push(setting);
        }
      }

      console.log('Read settings:', settings);

      // Close dialog
      const cancelButton = dialog.querySelector(domSelectors.settingsDialog.cancelButton);
      if (cancelButton) {
        cancelButton.click();
      } else {
        // Try ESC key as fallback
        const escEvent = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          bubbles: true
        });
        document.dispatchEvent(escEvent);
      }

      return settings;
    },

    // Apply settings to a strategy
    async applySettings(strategyIndex, newSettings) {
      const strategies = await this.detectStrategies();
      if (strategyIndex >= strategies.length) {
        throw new Error('Strategy index out of range');
      }

      const strategy = strategies[strategyIndex];
      
      // Open settings dialog (same as readStrategySettings)
      let settingsButton = strategy.element.querySelector(domSelectors.strategy.settingsButton);
      console.log('Settings button before hover in applySettings:', settingsButton);
      console.log('Hovering over strategy legend to reveal settings button');
      await DOMUtils.hoverElement(strategy.element);
      settingsButton = strategy.element.querySelector(domSelectors.strategy.settingsButton);
      console.log('Settings button after hover in applySettings:', settingsButton);
      
      if (settingsButton) {
        console.log('Clicking settings button in applySettings');
        await DOMUtils.clickElement(settingsButton);
      } else {
        // Try Strategy Tester panel
        const strategyTesterTab = document.querySelector(domSelectors.strategyTester.container);
        if (!strategyTesterTab) {
          throw new Error('Strategy Tester panel not found');
        }
        
        const testerSettingsButton = document.querySelector(domSelectors.strategyTester.strategySettingsButton);
        if (testerSettingsButton) {
          await DOMUtils.clickElement(testerSettingsButton);
        } else {
          // Try right-click
          const titleElement = strategy.element.querySelector(domSelectors.strategy.title);
          if (!titleElement) {
            throw new Error('Strategy title not found');
          }
          
          await DOMUtils.rightClickElement(titleElement);
          await DOMUtils.delay(500);
          
          const settingsMenuItem = await DOMUtils.waitForElement(domSelectors.strategy.menuItemSettings, 3000);
          if (settingsMenuItem) {
            await DOMUtils.clickElement(settingsMenuItem);
          } else {
            throw new Error('Settings menu item not found');
          }
        }
      }
      
      // Wait for dialog to open
      const dialog = await DOMUtils.waitForElement(domSelectors.settingsDialog.container);
      
      // Click on inputs tab if exists
      const inputsTab = dialog.querySelector(domSelectors.settingsDialog.tabInputs);
      if (inputsTab && !inputsTab.classList.contains('selected')) {
        await DOMUtils.clickElement(inputsTab);
        await DOMUtils.delay(500);
      }

      // Apply each setting
      const inputRows = dialog.querySelectorAll(domSelectors.settingsDialog.inputRow);
      
      for (const row of inputRows) {
        let label = row.querySelector(domSelectors.settingsDialog.inputLabel);
        if (!label) {
          label = row.querySelector('label') || row.querySelector('[class*="label"]') || row.querySelector('span');
        }
        if (!label) continue;

        // Fallback: if label text is empty, use previous label cell
        if (!label.textContent.trim()) {
          const prev = row.previousElementSibling;
          if (prev && prev.matches('div.cell-tBgV1m0B.first-tBgV1m0B')) {
            const alt = prev.querySelector('div.inner-tBgV1m0B');
            if (alt) {
              label = alt;
            }
          }
        }

        const settingName = label.textContent.trim();
        const newSetting = newSettings.find(s => s.name === settingName);
        
        if (!newSetting) continue;
        


        // Apply based on available input elements and value type
        const numberInput = row.querySelector(domSelectors.settingsDialog.numberInput);
        const checkboxInput = row.querySelector(domSelectors.settingsDialog.checkboxInput);
        const selectInput = row.querySelector(domSelectors.settingsDialog.selectInput);

        if (numberInput && (newSetting.type === 'number' || typeof newSetting.value === 'string' || typeof newSetting.value === 'number')) {
          DOMUtils.setInputValue(numberInput, newSetting.value);
          await DOMUtils.delay(200);
        } else if (checkboxInput && (newSetting.type === 'checkbox' || typeof newSetting.value === 'boolean')) {
          const targetValue = typeof newSetting.value === 'boolean' ? newSetting.value : newSetting.value === 'true';
          if (checkboxInput.checked !== targetValue) {
            await DOMUtils.clickElement(checkboxInput);
          }
        } else if (selectInput && (newSetting.type === 'select' || (!numberInput && !checkboxInput))) {
          // Handle select inputs (both native <select> and custom dropdowns)
          if (selectInput.tagName.toLowerCase() === 'select') {
            // Native select element
            DOMUtils.setInputValue(selectInput, newSetting.value);
            await DOMUtils.delay(200);
          } else {
            // Custom dropdown menu: use new method to handle separate overlay menus
            const success = await this.clickDropdownOption(selectInput, newSetting.value);
            if (!success) {
              console.warn(`Failed to set dropdown value: ${newSetting.value} for ${settingName}`);
            }
          }
        }
      }

      // Click OK to apply
      const okButton = dialog.querySelector(domSelectors.settingsDialog.okButton);
      if (okButton) {
        await DOMUtils.clickElement(okButton);
      }

      // If not in deep backtest mode, wait for backtest to complete
      const deepEnabled = !!document.querySelector(domSelectors.strategyTester.deepBacktest.toggleChecked);
      if (!deepEnabled) {
        await this.waitForBacktestComplete();
      }
    },

    // Wait for backtest to complete
    async waitForBacktestComplete() {
      // Ensure strategy tester tab is open
      if (!document.querySelector(domSelectors.strategyTester.containerActive)) {
        const panelToggle = document.querySelector(domSelectors.strategyTester.container);
        if (panelToggle) {
          await DOMUtils.clickElement(panelToggle);
          await DOMUtils.delay(1000);
        }
      }
      // Wait for at least one result row (performance or deep report) to appear
      const rowSelectors = [
        domSelectors.strategyTester.report.row,
        domSelectors.strategyTester.deepReport.row
      ].join(', ');
      await DOMUtils.waitForElement(rowSelectors, 30000);
      // Additional wait to ensure content is fully loaded
      await DOMUtils.delay(1000);
    },

    // Helper method to find dropdown options for custom dropdowns
    async getDropdownOptions(selectInput) {
      // For native select elements
      if (selectInput.tagName.toLowerCase() === 'select') {
        return Array.from(selectInput.options).map(opt => opt.text.trim());
      }
      
      try {
        // Click to open dropdown
        await DOMUtils.clickElement(selectInput);
        await DOMUtils.delay(150); // Reduced delay
        
        // Optimized single-pass strategy: find dropdown menu efficiently
        const selectId = selectInput.id;
        let dropdownMenu = null;
        
        // First try ID-based selectors (fastest)
        if (selectId) {
          dropdownMenu = document.querySelector(`[id*="${selectId}"][role="listbox"]`) ||
                        document.querySelector(`[id="${selectId}_listbox"]`) ||
                        document.querySelector(`[id="${selectId}_menu"]`);
        }
        
        // If not found, look for visible dropdown menus (limited scope)
        if (!dropdownMenu) {
          // Use more efficient approach - check only likely containers
          const containers = [
            document.querySelector('[data-name="indicator-properties-dialog"]'),
            document.body
          ].filter(Boolean);
          
          for (const container of containers) {
            const menus = container.querySelectorAll('[role="listbox"], [data-name="popup-menu-container"]');
            for (const menu of menus) {
              // Quick visibility check without getComputedStyle
              if (menu.offsetWidth > 0 && menu.offsetHeight > 0) {
                dropdownMenu = menu;
                break;
              }
            }
            if (dropdownMenu) break;
          }
        }
        
        let options = [];
        if (dropdownMenu) {
          options = Array.from(dropdownMenu.querySelectorAll('[role="option"]'))
            .map(opt => opt.textContent.trim());
        }
        
        // Quick close with escape key (faster than body click)
        const escEvent = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          bubbles: true
        });
        document.dispatchEvent(escEvent);
        await DOMUtils.delay(100); // Reduced delay
        
        return options;
      } catch (error) {
        console.log('Error getting dropdown options:', error);
        return [];
      }
    },

    // Helper method to find and click dropdown option in separate overlay
    async clickDropdownOption(selectInput, targetValue) {
      try {
        // Click to open dropdown
        await DOMUtils.clickElement(selectInput);
        await DOMUtils.delay(150); // Reduced delay
        
        // Optimized option finding (reuse logic from getDropdownOptions)
        const selectId = selectInput.id;
        let dropdownMenu = null;
        
        // First try ID-based selectors (fastest)
        if (selectId) {
          dropdownMenu = document.querySelector(`[id*="${selectId}"][role="listbox"]`) ||
                        document.querySelector(`[id="${selectId}_listbox"]`) ||
                        document.querySelector(`[id="${selectId}_menu"]`);
        }
        
        // If not found, look for visible dropdown menus (limited scope)
        if (!dropdownMenu) {
          const containers = [
            document.querySelector('[data-name="indicator-properties-dialog"]'),
            document.body
          ].filter(Boolean);
          
          for (const container of containers) {
            const menus = container.querySelectorAll('[role="listbox"], [data-name="popup-menu-container"]');
            for (const menu of menus) {
              // Quick visibility check
              if (menu.offsetWidth > 0 && menu.offsetHeight > 0) {
                dropdownMenu = menu;
                break;
              }
            }
            if (dropdownMenu) break;
          }
        }
        
        // Find and click the target option
        if (dropdownMenu) {
          const options = dropdownMenu.querySelectorAll('[role="option"]');
          for (const option of options) {
            if (option.textContent.trim().toLowerCase() === targetValue.toLowerCase()) {
              await DOMUtils.clickElement(option);
              await DOMUtils.delay(100); // Reduced delay
              return true;
            }
          }
        }
        
        return false;
      } catch (error) {
        console.log('Error clicking dropdown option:', error);
        return false;
      }
    }
  };

  // Metrics reading functionality
  const MetricsManager = {
    // Read a specific metric value from the table
    async readMetric(metricName) {
      console.log('[CT] readMetric start for', metricName);
      const metricConfig = domSelectors.metrics[metricName];
      if (!metricConfig) {
        console.log('[CT] Unknown metric:', metricName);
        throw new Error(`Unknown metric: ${metricName}`);
      }
      console.log('[CT] metricConfig.tab =', metricConfig.tab);
      // Click the appropriate tab if needed
      const tabSelectors = {
        performance: domSelectors.strategyTester.tabs.performance.split(', '),
        trades: domSelectors.strategyTester.tabs.trades.split(', '),
        ratios: domSelectors.strategyTester.tabs.ratios.split(', ')
      };

      if (metricConfig.tab && tabSelectors[metricConfig.tab]) {
        // Check if tab is already active
        const activeSelectors = {
          performance: domSelectors.strategyTester.tabs.performanceActive,
          trades: domSelectors.strategyTester.tabs.tradesActive,
          ratios: domSelectors.strategyTester.tabs.ratiosActive
        };

        const isActive = document.querySelector(activeSelectors[metricConfig.tab]);
        console.log('[CT] isActive for tab', metricConfig.tab, '=', !!isActive);
        if (!isActive) {
          console.log('[CT] waiting for tab button for selectors:', tabSelectors[metricConfig.tab]);
          const tabButton = await DOMUtils.waitForAnyElement(tabSelectors[metricConfig.tab]);
          console.log('[CT] tabButton element for', metricConfig.tab, '=', tabButton);
          if (tabButton) {
            console.log('[CT] clicking tab for', metricConfig.tab);
            await DOMUtils.clickElement(tabButton);
            await DOMUtils.delay(1000);
          }
        }
      }

      console.log('[CT] scanning rows for metric', metricName);
      // Read the metric value by scanning rows for the metric label
      const rowSelectors = [
        domSelectors.strategyTester.report.row,
        domSelectors.strategyTester.deepReport.row
      ];
      const selector = rowSelectors.join(', ');
      console.log('[CT] rowSelectors combined selector =', selector);
      const rows = document.querySelectorAll(selector);
      console.log('[CT] rows found =', rows.length);
      if (rows.length === 0) {
        console.log('[CT] No data rows found for metric', metricName);
        throw new Error('No data rows found');
      }
      for (const row of rows) {
        const labelElem = row.querySelector('.apply-overflow-tooltip');
        if (labelElem) {
          const actualLabel = labelElem.textContent.trim().toLowerCase();
          const expectedLabel = metricConfig.label.trim().toLowerCase();
          if (actualLabel === expectedLabel) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) {
              console.log('[CT] Data cell not found for metric:', metricConfig.label);
              throw new Error(`Data cell not found for metric: ${metricConfig.label}`);
            }
            const rawValue = cells[1].textContent.trim();
            console.log('[CT] rawValue for', metricName, '=', rawValue);
            return DOMUtils.parseMetricValue(rawValue, metricConfig.parser);
          }
        }
      }
      console.log('[CT] Metric row not found for', metricConfig.label);
      throw new Error(`Metric row not found: ${metricConfig.label}`);
    },

    // Read multiple metrics
    async readAllMetrics(metricNames) {
      const results = {};
      
      for (const metricName of metricNames) {
        try {
          results[metricName] = await this.readMetric(metricName);
        } catch (error) {
          console.error(`Failed to read metric ${metricName}:`, error);
          results[metricName] = null;
        }
      }
      
      return results;
    }
  };

  // Deep backtest functionality
  const DeepBacktestManager = {
    // Synchronize deep backtest state between extension and TradingView
    async syncDeepBacktest(enabled) {
      const toggle = document.querySelector(domSelectors.strategyTester.deepBacktest.toggle);
      if (!toggle) {
        throw new Error('Deep backtest toggle not found');
      }

      const isCurrentlyEnabled = toggle.getAttribute('aria-checked') === 'true' || toggle.checked;
      
      if (isCurrentlyEnabled !== enabled) {
        if (enabled) {
          console.log('[CT] Enabling deep backtest to match extension setting');
        } else {
          console.log('[CT] Disabling deep backtest to match extension setting');
        }
        await DOMUtils.clickElement(toggle);
        await DOMUtils.delay(1000);
      } else {
        console.log(`[CT] Deep backtest already ${enabled ? 'enabled' : 'disabled'} - no sync needed`);
      }
    },

    // Toggle deep backtest
    async toggleDeepBacktest(enabled) {
      const toggle = document.querySelector(domSelectors.strategyTester.deepBacktest.toggle);
      if (!toggle) {
        throw new Error('Deep backtest toggle not found');
      }

      const isCurrentlyEnabled = toggle.getAttribute('aria-checked') === 'true' || toggle.checked;
      if (isCurrentlyEnabled !== enabled) {
        await DOMUtils.clickElement(toggle);
        await DOMUtils.delay(1000);
      }
    },

    // Set date range for deep backtest
    async setDateRange(startDate, endDate) {
      // Locate date range container and inputs
      const container = document.querySelector(domSelectors.strategyTester.deepBacktest.dateRange.container);
      if (!container) {
        throw new Error('Date range container not found');
      }
      // Select date inputs by their placeholder (YYYY-MM-DD) to be more robust
      const dateInputs = Array.from(container.querySelectorAll('input[placeholder="YYYY-MM-DD"]'));
      if (dateInputs.length < 2) {
        throw new Error('Date range inputs not found');
      }
      const [startInput, endInput] = dateInputs;
      if (startDate) {
        DOMUtils.setInputValue(startInput, startDate);
        await DOMUtils.delay(500);
      }
      if (endDate) {
        DOMUtils.setInputValue(endInput, endDate);
        await DOMUtils.delay(500);
      }
      // Click generate button if available
      let generateBtn = container.querySelector(domSelectors.strategyTester.deepBacktest.dateRange.generateButton);
      if (!generateBtn) {
        generateBtn = document.querySelector(domSelectors.strategyTester.deepBacktest.dateRange.generateButton);
      }
      if (generateBtn) {
        await DOMUtils.clickElement(generateBtn);
        await DOMUtils.delay(500);
        // Wait for deep backtest report to finish loading
        await StrategyManager.waitForBacktestComplete();
      }
    }
  };

  // Message handler
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[CT] Received message:', request.action, request.data || request);
    handleMessage(request, sendResponse);
    return true; // Keep message channel open for async response
  });

  async function handleMessage(request, sendResponse) {
    console.log('[CT] handleMessage start for', request.action);
    try {
      switch (request.action) {
        case 'detectStrategies':
          const strategies = await StrategyManager.detectStrategies();
          console.log('[CT] detectStrategies -> responding', strategies);
          sendResponse({ success: true, strategies: strategies.map(({ index, name }) => ({ index, name })) });
          break;

        case 'readStrategySettings':
          const settings = await StrategyManager.readStrategySettings(request.strategyIndex);
          console.log('[CT] readStrategySettings -> responding', settings);
          sendResponse({ success: true, settings });
          break;

        case 'applySettings':
          console.log('[CT] applySettings start');
          await StrategyManager.applySettings(request.strategyIndex, request.settings);
          console.log('[CT] applySettings done');
          sendResponse({ success: true });
          break;

        case 'readMetric':
          console.log('[CT] readMetric request for', request.metricName);
          const value = await MetricsManager.readMetric(request.metricName);
          console.log('[CT] readMetric -> responding', value);
          sendResponse({ success: true, value });
          break;

        case 'readAllMetrics':
          console.log('[CT] readAllMetrics request for', request.metricNames);
          const metrics = await MetricsManager.readAllMetrics(request.metricNames);
          console.log('[CT] readAllMetrics -> responding', metrics);
          sendResponse({ success: true, metrics });
          break;

        case 'toggleDeepBacktest':
          console.log('[CT] toggleDeepBacktest ->', request.enabled);
          await DeepBacktestManager.toggleDeepBacktest(request.enabled);
          sendResponse({ success: true });
          break;

        case 'syncDeepBacktest':
          console.log('[CT] syncDeepBacktest ->', request.enabled);
          await DeepBacktestManager.syncDeepBacktest(request.enabled);
          sendResponse({ success: true });
          break;

        case 'setDateRange':
          console.log('[CT] setDateRange ->', request.startDate, request.endDate);
          await DeepBacktestManager.setDateRange(request.startDate, request.endDate);
          sendResponse({ success: true });
          break;

        case 'waitForBacktestComplete':
          console.log('[CT] waitForBacktestComplete -> start');
          await StrategyManager.waitForBacktestComplete();
          console.log('[CT] waitForBacktestComplete -> done');
          sendResponse({ success: true });
          break;

        default:
          console.log('[CT] Unknown action:', request.action);
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Content script error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  console.log('TradingView Strategy Optimizer content script loaded');
})(); 