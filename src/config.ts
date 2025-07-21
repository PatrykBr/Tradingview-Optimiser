export const SELECTORS = {
  overview: {
    container: '.reportContainer-NyzFj5yn',
    cells: '.containerCell-hwB8aI49', 
    title: '.title-_aP8GmAC',
    value: '.value-LVMgafTl, .highlightedValue-LVMgafTl',
    currency: '.currency-LVMgafTl',
    change: '.change-LVMgafTl'
  },
  table: {
    container: '.wrapper-UQYV_qXv',
    table: '.ka-table',
    rows: '.ka-tbody .ka-tr',
    metricCell: '.ka-cell:first-child .title-NcOKy65p',
    valueCell: '.tableCell-SLJfw5le .value-SLJfw5le',
    currencyCell: '.tableCell-SLJfw5le .currency-SLJfw5le',
    percentCell: '.tableCell-SLJfw5le .percentValue-SLJfw5le'
  },
  strategies: {
    container: '.sourcesWrapper-l31H9iuA',
    items: '.item-l31H9iuA.study-l31H9iuA',
    title: '.titleWrapper-l31H9iuA.mainTitle-l31H9iuA .title-l31H9iuA',
    settingsButton: 'button[data-name="legend-settings-action"]',
    inputTitles: '.titleWrapper-l31H9iuA.inputTitle-l31H9iuA .title-l31H9iuA',
    inputTooltips: '.titleWrapper-l31H9iuA.inputTitle-l31H9iuA'
  },
  settingsDialog: {
    container: '[data-dialog-name]',
    title: '.title-BZKENkhT .ellipsis-BZKENkhT',
    inputLabels: '.cell-tBgV1m0B.first-tBgV1m0B .inner-tBgV1m0B',
    inputValues: '.cell-tBgV1m0B:not(.first-tBgV1m0B) .inner-tBgV1m0B input',
    closeButton: 'button[data-name="close"]',
    cancelButton: 'button[name="cancel"]'
  },
  dateRange: {
    // Main date range button that opens the menu
    mainButton: '.dateRangeMenuWrapper-ucbE4pMM button[aria-expanded]',
    
    // Menu options
    menu: '[role="menu"]',
    rangeFromChart: '[aria-label="Range from chart"]',
    customDateRange: '[aria-label="Custom date range…"]',
    
    // Custom date range dialog
    dialog: '[data-dialog-name="Backtesting dates"]',
    startDateInput: '.startDatePicker-XcWDAol2 input',
    endDateInput: '.dateInput-OagbhAs2:not(.startDatePicker-XcWDAol2) input',
    selectButton: 'button[name="submit"]',
    cancelButton: 'button[name="cancel"]',
    closeButton: 'button[data-name="close"]'
  }
} as const;

export const STORAGE_KEYS = {
  extractedData: 'extractedData',
  strategies: 'strategies',
  dateRangeSettings: 'dateRangeSettings'
} as const;

export const MESSAGES = {
  extractData: 'extractData',
  saveData: 'saveData',
  saveStrategies: 'saveStrategies',
  extractStrategies: 'extractStrategies',
  openStrategySettings: 'openStrategySettings',
  changeDateRange: 'changeDateRange',
  saveDateRangeSettings: 'saveDateRangeSettings'
} as const;
