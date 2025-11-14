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
        inputLabels: '.cell-RLntasnw.first-RLntasnw .inner-RLntasnw',
        inputValues: '.cell-RLntasnw:not(.first-RLntasnw) .inner-RLntasnw input',
        closeButton: 'button[data-name="close"]',
        cancelButton: 'button[name="cancel"]',
        okButton: 'button[name="submit"]'
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
    dateRangeSettings: 'dateRangeSettings',
    optimisationConfig: 'optimisationConfig',
    savedOptimisationConfigs: 'savedOptimisationConfigs'
} as const;

export const MESSAGES = {
    extractData: 'extractData',
    saveData: 'saveData',
    saveStrategies: 'saveStrategies',
    extractStrategies: 'extractStrategies',
    openStrategySettings: 'openStrategySettings',
    changeDateRange: 'changeDateRange',
    saveDateRangeSettings: 'saveDateRangeSettings',
    saveOptimisationConfig: 'saveOptimisationConfig',
    saveSavedOptimisationConfigs: 'saveSavedOptimisationConfigs'
} as const;

export const AVAILABLE_METRICS = [
    { value: 'netProfit', label: 'Net Profit' },
    { value: 'totalTrades', label: 'Total Trades' },
    { value: 'profitFactor', label: 'Profit Factor' },
    { value: 'maxDrawdown', label: 'Max Drawdown' },
    { value: 'sharpeRatio', label: 'Sharpe Ratio' },
    { value: 'winRate', label: 'Win Rate' }
] as const;

// Timing constants for DOM interactions (TradingView UI delays)
export const TIMING = {
    // Wait time for elements to appear in DOM
    ELEMENT_WAIT_TIMEOUT: 5000,
    ELEMENT_RETRY_INTERVAL: 100,

    // Delays for UI interactions
    MENU_OPEN_DELAY: 500,
    DIALOG_OPEN_DELAY: 300,
    INPUT_CHANGE_DELAY: 100,
    DIALOG_CLOSE_DELAY: 300
} as const;

// UI text constants
export const UI_TEXT = {
    errors: {
        noActiveTab: 'No active tab found',
        noStrategies: 'No strategies found in storage - please extract strategies first',
        strategyContainerNotFound: 'Strategy container not found - ensure you are on a TradingView chart page',
        invalidStrategyIndex: (index: number, total: number) =>
            `Invalid strategy index: ${index}. Found ${total} strategies`,
        settingsButtonNotFound: (index: number) => `Settings button not found for strategy at index ${index}`,
        dialogNotAppear: 'Settings dialog did not appear - try again or check TradingView page status',
        dialogNoTitle: 'Strategy dialog has no title - DOM structure may have changed',
        dateRangeButtonNotFound: 'Could not find date range button',
        rangeFromChartNotFound: 'Could not find "Range from chart" option',
        customDateRangeNotFound: 'Could not find "Custom date range" option',
        dateRangeDialogNotFound: 'Could not find date range dialog',
        startDateInputNotFound: 'Could not find start date input',
        endDateInputNotFound: 'Could not find end date input',
        selectButtonNotFound: 'Could not find Select button'
    },
    success: {
        strategiesExtracted: (count: number) => `Found ${count} strategies`,
        settingsExtracted: (name: string, count: number) => `Extracted settings for: ${name} (${count} parameters)`,
        dateRangeSet: (start: string, end: string) => `Date range set to ${start} - ${end}`,
        dateRangeSetToChart: 'Date range set to chart range',
        dateRangeAlreadySet: (start: string, end: string) => `Date range was already set to ${start} - ${end}`,
        dateRangeAlreadyChart: 'Date range was already set to chart range'
    }
} as const;
