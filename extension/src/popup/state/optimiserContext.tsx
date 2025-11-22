import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from "react";
import browser from "webextension-polyfill";
import type {
  BackgroundRequest,
  BackgroundResponse,
  StrategyParameter,
  StrategySummary,
} from "@shared/ipc";

export type TabId = "parameters" | "settings" | "results";

interface ParameterState {
  definition: StrategyParameter;
  enabled: boolean;
  min: string;
  max: string;
}

interface OptimiserState {
  tab: TabId;
  strategies: StrategySummary[];
  selectedStrategyId?: string;
  parameterOrder: string[];
  parameters: Record<string, ParameterState>;
  isLoadingStrategies: boolean;
  isLoadingParams: boolean;
  error?: string;
  metric: string;
  trials: number;
}

type Action =
  | { type: "set-tab"; payload: TabId }
  | { type: "set-strategies"; payload: StrategySummary[] }
  | { type: "set-selected-strategy"; payload?: string }
  | { type: "set-parameters"; payload: StrategyParameter[] }
  | { type: "toggle-parameter"; payload: { id: string; enabled: boolean } }
  | { type: "update-parameter-range"; payload: { id: string; field: "min" | "max"; value: string } }
  | { type: "set-loading"; payload: { strategies?: boolean; params?: boolean } }
  | { type: "set-error"; payload?: string }
  | { type: "set-metric"; payload: string }
  | { type: "set-trials"; payload: number };

const initialState: OptimiserState = {
  tab: "parameters",
  strategies: [],
  parameterOrder: [],
  parameters: {},
  isLoadingStrategies: false,
  isLoadingParams: false,
  metric: "net-profit",
  trials: 250,
};

function reducer(state: OptimiserState, action: Action): OptimiserState {
  switch (action.type) {
    case "set-tab":
      return { ...state, tab: action.payload };
    case "set-strategies":
      return { ...state, strategies: action.payload };
    case "set-selected-strategy":
      return {
        ...state,
        selectedStrategyId: action.payload,
        parameters: {},
        parameterOrder: [],
      };
    case "set-parameters": {
      const parameters: Record<string, ParameterState> = {};
      for (const param of action.payload) {
        const val = Number.isFinite(Number(param.value)) ? String(Number(param.value)) : "0";
        parameters[param.id] = { definition: param, enabled: false, min: val, max: val };
      }
      return { ...state, parameters, parameterOrder: action.payload.map((p) => p.id) };
    }
    case "toggle-parameter": {
      const param = state.parameters[action.payload.id];
      if (!param) return state;
      return {
        ...state,
        parameters: { ...state.parameters, [action.payload.id]: { ...param, enabled: action.payload.enabled } },
      };
    }
    case "update-parameter-range": {
      const param = state.parameters[action.payload.id];
      if (!param) return state;
      return {
        ...state,
        parameters: {
          ...state.parameters,
          [action.payload.id]: { ...param, [action.payload.field]: action.payload.value },
        },
      };
    }
    case "set-loading":
      return {
        ...state,
        isLoadingStrategies: action.payload.strategies ?? state.isLoadingStrategies,
        isLoadingParams: action.payload.params ?? state.isLoadingParams,
      };
    case "set-error":
      return { ...state, error: action.payload };
    case "set-metric":
      return { ...state, metric: action.payload };
    case "set-trials":
      return { ...state, trials: Math.max(10, action.payload) || 10 };
    default:
      return state;
  }
}

interface OptimiserContextValue {
  state: OptimiserState;
  actions: {
    setTab(tab: TabId): void;
    selectStrategy(id?: string): void;
    toggleParameter(id: string, enabled: boolean): void;
    updateParameterRange(id: string, field: "min" | "max", value: string): void;
    setMetric(metric: string): void;
    setTrials(trials: number): void;
    loadStrategies(): Promise<void>;
    loadParameters(strategyId: string): Promise<void>;
  };
}

const OptimiserContext = createContext<OptimiserContextValue | undefined>(undefined);

async function sendBackgroundMessage(request: BackgroundRequest): Promise<BackgroundResponse | null> {
  if (!browser?.runtime?.id) {
    return null;
  }
  try {
    return (await browser.runtime.sendMessage(request)) as BackgroundResponse;
  } catch (error) {
    console.warn("Background message failed", error);
    return null;
  }
}

export function OptimiserProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadStrategies = useCallback(async () => {
    dispatch({ type: "set-loading", payload: { strategies: true } });
    dispatch({ type: "set-error", payload: undefined });

    const response = await sendBackgroundMessage({ type: "list-strategies" });
    dispatch({ type: "set-loading", payload: { strategies: false } });

    if (!response) {
      dispatch({ type: "set-error", payload: "Background worker is unavailable. Reload the extension." });
    } else if (response.type === "strategies") {
      dispatch({ type: "set-strategies", payload: response.strategies });
    } else if (response.type === "error") {
      dispatch({ type: "set-error", payload: response.message });
    }
  }, []);

  const loadParameters = useCallback(async (strategyId: string) => {
    dispatch({ type: "set-loading", payload: { params: true } });
    dispatch({ type: "set-error", payload: undefined });

    const response = await sendBackgroundMessage({ type: "get-params", strategyId });
    dispatch({ type: "set-loading", payload: { params: false } });

    if (!response) {
      dispatch({ type: "set-error", payload: "Background worker is unavailable. Reload the extension." });
    } else if (response.type === "params") {
      dispatch({ type: "set-parameters", payload: response.params });
    } else if (response.type === "error") {
      dispatch({ type: "set-error", payload: response.message });
    }
  }, []);

  useEffect(() => {
    loadStrategies();
  }, [loadStrategies]);

  const contextValue: OptimiserContextValue = {
    state,
    actions: {
      setTab: (tab) => dispatch({ type: "set-tab", payload: tab }),
      selectStrategy: (id) => {
        dispatch({ type: "set-selected-strategy", payload: id });
        if (id) {
          void loadParameters(id);
        }
      },
      toggleParameter: (id, enabled) => dispatch({ type: "toggle-parameter", payload: { id, enabled } }),
      updateParameterRange: (id, field, value) =>
        dispatch({
          type: "update-parameter-range",
          payload: { id, field, value },
        }),
      setMetric: (metric) => dispatch({ type: "set-metric", payload: metric }),
      setTrials: (trials) => dispatch({ type: "set-trials", payload: trials }),
      loadStrategies,
      loadParameters,
    },
  };

  return <OptimiserContext.Provider value={contextValue}>{children}</OptimiserContext.Provider>;
}

export function useOptimiser() {
  const ctx = useContext(OptimiserContext);
  if (!ctx) {
    throw new Error("useOptimiser must be used within OptimiserProvider");
  }
  return ctx;
}

