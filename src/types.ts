export interface ExtractedItem {
  title: string;
  value: string;
  currency?: string;
  change?: string;
  timestamp: string;
  tabType?: 'overview' | 'performance' | 'trades' | 'ratios' | 'strategies';
}

export interface StrategySettings {
  name: string;
  settings: Array<{
    label: string;
    value: string;
    tooltip?: string;
  }>;
  timestamp: string;
}

export interface DateRangeSettings {
  enabled: boolean;
  startDate: string;
  endDate: string;
  timestamp: string;
}

export interface MessageRequest {
  action: string;
  data?: ExtractedItem[];
  strategies?: StrategySettings[];
  dateRangeSettings?: DateRangeSettings;
  filter?: 'all' | 'long' | 'short' | 'none';
  strategyIndex?: number;
}

export interface MessageResponse {
  success: boolean;
  data?: ExtractedItem[];
  strategies?: StrategySettings[];
  dateRangeSettings?: DateRangeSettings;
  message?: string;
  error?: string;
}
