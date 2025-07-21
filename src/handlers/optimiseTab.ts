import { setStatus, tabs, getActiveTab } from '../utils';

export class OptimiseTabHandler {
  private activeFilters: Array<{ metric: string; min?: number; max?: number }> = [];

  constructor() {
    this.attachEventListeners();
    this.populateMetricDropdowns();
    this.initializeDateInputs();
  }

  private attachEventListeners(): void {
    const listeners = {
      dateRangeEnabled: { event: 'onchange', handler: () => this.toggleDateRange() },
      addFilterBtn: { event: 'onclick', handler: () => this.addFilter() },
      startOptimisationBtn: { event: 'onclick', handler: () => this.startOptimisation() },
      metricDropdown: { event: 'onchange', handler: () => this.validateForm() },
      iterationsInput: { event: 'oninput', handler: () => this.validateForm() },
      startDate: { event: 'onblur', handler: () => this.handleDateChange() },
      endDate: { event: 'onblur', handler: () => this.handleDateChange() }
    };

    Object.entries(listeners).forEach(([id, config]) => {
      const element = document.getElementById(id) as any;
      if (element) element[config.event] = config.handler;
    });
  }

  private handleDateChange(): void {
    const toggle = document.getElementById('dateRangeEnabled') as HTMLInputElement;
    if (toggle?.checked) {
      this.applyDateRangeToTradingView();
    }
  }

  private toggleDateRange(): void {
    const toggle = document.getElementById('dateRangeEnabled') as HTMLInputElement;
    const inputs = document.getElementById('dateInputs');
    if (!toggle || !inputs) return;
    
    inputs.classList.toggle('hidden', !toggle.checked);
    
    if (toggle.checked) {
      this.applyDateRangeToTradingView();
    }
  }

  private initializeDateInputs(): void {
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    const startDate = document.getElementById('startDate') as HTMLInputElement;
    const endDate = document.getElementById('endDate') as HTMLInputElement;
    
    if (startDate) startDate.value = this.formatDate(oneYearAgo);
    if (endDate) endDate.value = this.formatDate(today);
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private async applyDateRangeToTradingView(): Promise<void> {
    const startDate = document.getElementById('startDate') as HTMLInputElement;
    const endDate = document.getElementById('endDate') as HTMLInputElement;
    
    if (!startDate?.value || !endDate?.value) {
      setStatus('Please select both start and end dates');
      return;
    }

    try {
      const tab = await getActiveTab();
      const response = await tabs.sendMessage(tab.id, {
        action: 'changeDateRange',
        dateRangeSettings: {
          enabled: true,
          startDate: startDate.value,
          endDate: endDate.value
        }
      });

      if (response.success) {
        if (response.alreadySet) {
          setStatus('Date range already set to these values');
        } else {
          setStatus(`Date range updated: ${startDate.value} to ${endDate.value}`);
        }
      } else {
        setStatus('Failed to update date range - make sure you\'re on a TradingView strategy tester page');
      }
    } catch (error) {
      setStatus('Error communicating with TradingView');
    }
  }

  private populateMetricDropdowns(): void {
    const metrics = [
      'Net Profit', 'Net Profit %', 'Total Closed Trades', 'Percent Profitable',
      'Profit Factor', 'Max Drawdown', 'Max Drawdown %', 'Avg Trade', 'Avg Trade %',
      'Avg Win', 'Avg Loss', 'Ratio Avg Win / Avg Loss', 'Largest Winning Trade',
      'Largest Losing Trade', 'Avg # Bars In Trades', 'Sharpe Ratio', 'Sortino Ratio'
    ];

    ['metricDropdown', 'filterMetricDropdown'].forEach(id => {
      const dropdown = document.getElementById(id) as HTMLSelectElement;
      if (dropdown) {
        dropdown.innerHTML = metrics.map(metric => 
          `<option value="${metric}">${metric}</option>`
        ).join('');
      }
    });
  }

  private addFilter(): void {
    const metricDropdown = document.getElementById('filterMetricDropdown') as HTMLSelectElement;
    const minValueInput = document.getElementById('filterMinValue') as HTMLInputElement;
    const maxValueInput = document.getElementById('filterMaxValue') as HTMLInputElement;

    if (!metricDropdown.value) return setStatus('Please select a metric to filter');
    if (!minValueInput.value && !maxValueInput.value) return setStatus('Please enter at least one filter value (min or max)');

    const filter = {
      metric: metricDropdown.value,
      min: minValueInput.value ? parseFloat(minValueInput.value) : undefined,
      max: maxValueInput.value ? parseFloat(maxValueInput.value) : undefined
    };

    this.activeFilters.push(filter);
    this.renderActiveFilters();
    this.clearFilterInputs();
    setStatus(`Added filter for ${filter.metric}`);
  }

  private renderActiveFilters(): void {
    const container = document.getElementById('activeFilters');
    if (!container) return;

    container.innerHTML = this.activeFilters.length === 0 
      ? '<div class="no-filters">No filters applied</div>'
      : this.activeFilters.map((filter, index) => {
          const ranges = [
            filter.min !== undefined ? `Min: ${filter.min}` : '',
            filter.max !== undefined ? `Max: ${filter.max}` : ''
          ].filter(Boolean).join(', ');

          return `
            <div class="filter-item">
              <span><strong>${filter.metric}</strong> (${ranges})</span>
              <button class="filter-remove-btn" data-filter-index="${index}">✕</button>
            </div>
          `;
        }).join('');

    // Add event listeners to remove buttons
    const removeButtons = container.querySelectorAll('.filter-remove-btn');
    removeButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const index = parseInt((e.target as HTMLElement).dataset.filterIndex || '0');
        this.removeFilter(index);
      });
    });
  }

  private removeFilter(index: number): void {
    this.activeFilters.splice(index, 1);
    this.renderActiveFilters();
    setStatus('Filter removed');
  }

  private clearFilterInputs(): void {
    ['filterMetricDropdown', 'filterMinValue', 'filterMaxValue'].forEach(id => {
      const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
      if (element) element.value = '';
    });
  }

  private validateForm(): void {
    const startBtn = document.getElementById('startOptimisationBtn') as HTMLButtonElement;
    const metricDropdown = document.getElementById('metricDropdown') as HTMLSelectElement;
    const iterationsInput = document.getElementById('iterationsInput') as HTMLInputElement;
    
    if (startBtn && metricDropdown && iterationsInput) {
      startBtn.disabled = !(
        metricDropdown.value && 
        iterationsInput.value && 
        parseInt(iterationsInput.value) > 0
      );
    }
  }

  private startOptimisation(): void {
    const getValue = (id: string, defaultValue = '') => 
      (document.getElementById(id) as HTMLInputElement)?.value || defaultValue;

    const getChecked = (id: string) => 
      (document.getElementById(id) as HTMLInputElement)?.checked;

    const config: any = {
      metric: getValue('metricDropdown'),
      iterations: parseInt(getValue('iterationsInput', '0')),
      useCustomDateRange: getChecked('dateRangeEnabled'),
      filters: this.activeFilters,
      delays: {
        min: parseInt(getValue('minDelay', '100')),
        max: parseInt(getValue('maxDelay', '500'))
      }
    };

    if (config.useCustomDateRange) {
      config.dateRange = {
        start: getValue('startDate'),
        end: getValue('endDate')
      };
    }

    setStatus('Optimisation configuration ready - Python backend integration needed');
    console.log('Optimisation Config:', config);
  }
}
