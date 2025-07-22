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

export interface OptimisationParameter {
  label: string;
  currentValue: string;
  minValue: number;
  maxValue: number;
  enabled: boolean;
  tooltip?: string;
}

export interface OptimisationConfig {
  strategyName: string;
  parameters: OptimisationParameter[];
  timestamp: string;
}

export interface SavedOptimisationConfig {
  id: string;
  name: string;
  strategyName: string;
  parameters: OptimisationParameter[];
  timestamp: string;
  description?: string;
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
  optimisationConfig?: OptimisationConfig;
  savedOptimisationConfigs?: SavedOptimisationConfig[];
  filter?: 'all' | 'long' | 'short' | 'none';
  strategyIndex?: number;
}

export interface MessageResponse {
  success: boolean;
  data?: ExtractedItem[];
  strategies?: StrategySettings[];
  dateRangeSettings?: DateRangeSettings;
  optimisationConfig?: OptimisationConfig;
  savedOptimisationConfigs?: SavedOptimisationConfig[];
  message?: string;
  error?: string;
}
