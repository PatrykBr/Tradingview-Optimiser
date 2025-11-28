import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import browser from "webextension-polyfill";
import type {
  BackgroundRequest,
  BackgroundResponse,
  ExtensionEvent,
  FilterComparator,
  OptimisationConfig,
  OptimisationFilter,
  OptimisationSessionSnapshot,
  RunStatus,
  StrategyMetric,
  StrategyParameter,
  StrategySummary,
  TrialResult,
} from "@shared/ipc";
import { broadcastToTrial } from "@shared/trials";
import { deleteStrategyPreset, loadStrategyPresets, persistStrategyPreset, type StrategyPreset } from "./presetStorage";
import { loadFavouriteMetrics, persistFavouriteMetrics } from "./metricPreferences";
import { loadSessionDraft, persistSessionDraft } from "./sessionDraft";

export type TabId = "parameters" | "settings" | "results";

type ParameterField = "min" | "max";

interface ParameterState {
  definition: StrategyParameter;
  enabled: boolean;
  min: string;
  max: string;
}

type FilterDraft = Omit<OptimisationFilter, "value"> & { value: string };

interface OptimiserState {
  tab: TabId;
  strategies: StrategySummary[];
  selectedStrategyId?: string;
  parameterOrder: string[];
  parameters: Record<string, ParameterState>;
  presets: StrategyPreset[];
  activePresetId?: string;
  isLoadingStrategies: boolean;
  isLoadingParams: boolean;
  isLoadingPresets: boolean;
  error?: string;
  metric: StrategyMetric;
  trials: number;
  customRangeEnabled: boolean;
  startDate?: string;
  endDate?: string;
  filters: FilterDraft[];
  favouriteMetrics: StrategyMetric[];
  status: RunStatus;
  totalTrials: number;
  completedTrials: TrialResult[];
  bestTrial?: TrialResult;
  statusMessage?: string;
}

const defaultFilterMetric: StrategyMetric = "net-profit";

const initialState: OptimiserState = {
  tab: "parameters",
  strategies: [],
  parameterOrder: [],
  parameters: {},
  presets: [],
  isLoadingStrategies: false,
  isLoadingParams: false,
  isLoadingPresets: false,
  metric: "net-profit",
  trials: 250,
  customRangeEnabled: false,
  filters: [],
  favouriteMetrics: [],
  status: "idle",
  totalTrials: 0,
  completedTrials: [],
  statusMessage: undefined,
};

const PERSIST_VERSION = 1;

type PersistedOptimiserState = {
  version: number;
} & Pick<
  OptimiserState,
  | "tab"
  | "selectedStrategyId"
  | "parameterOrder"
  | "parameters"
  | "metric"
  | "trials"
  | "customRangeEnabled"
  | "startDate"
  | "endDate"
  | "filters"
  | "activePresetId"
>;

type Action =
  | { type: "hydrate"; payload: Partial<OptimiserState> }
  | { type: "set-tab"; payload: TabId }
  | { type: "set-strategies"; payload: StrategySummary[] }
  | { type: "set-selected-strategy"; payload?: string }
  | { type: "set-parameters"; payload: StrategyParameter[] }
  | { type: "toggle-parameter"; payload: { id: string; enabled: boolean } }
  | { type: "set-presets"; payload: StrategyPreset[] }
  | { type: "apply-preset"; payload: StrategyPreset }
  | {
      type: "update-parameter-range";
      payload: { id: string; field: ParameterField; value: string };
    }
  | { type: "set-loading"; payload: { strategies?: boolean; params?: boolean; presets?: boolean } }
  | { type: "set-error"; payload?: string }
  | { type: "set-metric"; payload: StrategyMetric }
  | { type: "set-trials"; payload: number }
  | { type: "toggle-custom-range"; payload: boolean }
  | { type: "set-date"; payload: { field: "start" | "end"; value?: string } }
  | { type: "add-filter" }
  | {
      type: "update-filter";
      payload: {
        id: string;
        field: keyof FilterDraft;
        value: string | FilterComparator;
      };
    }
  | { type: "remove-filter"; payload: string }
  | { type: "set-status"; payload: RunStatus }
  | {
      type: "set-progress";
      payload: {
        totalTrials?: number;
        completedTrials?: TrialResult[];
        bestTrial?: TrialResult;
      };
    }
  | { type: "append-trial"; payload: TrialResult }
  | { type: "reset-trials"; payload: { totalTrials?: number } }
  | { type: "set-status-message"; payload?: string }
  | { type: "set-favourite-metrics"; payload: StrategyMetric[] };

function reducer(state: OptimiserState, action: Action): OptimiserState {
  switch (action.type) {
    case "hydrate":
      return { ...state, ...action.payload };
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
        presets: [],
        activePresetId: undefined,
        isLoadingPresets: false,
      };
    case "set-parameters": {
      const parameters: Record<string, ParameterState> = {};
      for (const param of action.payload) {
        const val = Number.isFinite(Number(param.value)) ? String(Number(param.value)) : "0";
        parameters[param.id] = { definition: param, enabled: false, min: val, max: val };
      }
      return { ...state, parameters, parameterOrder: action.payload.map((p) => p.id) };
    }
    case "set-presets":
      return {
        ...state,
        presets: action.payload,
        activePresetId: action.payload.some((p) => p.id === state.activePresetId) ? state.activePresetId : undefined,
      };
    case "apply-preset": {
      const preset = action.payload;
      const parameters = Object.fromEntries(
        state.parameterOrder.map((id) => {
          const existing = state.parameters[id];
          const presetParam = preset.parameters[id];
          if (!existing || !presetParam) return [id, existing];
          return [
            id,
            {
              ...existing,
              enabled: Boolean(presetParam.enabled),
              min: presetParam.min ?? existing.min,
              max: presetParam.max ?? existing.max,
            },
          ];
        }),
      );
      return { ...state, parameters, activePresetId: preset.id };
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
        isLoadingPresets: action.payload.presets ?? state.isLoadingPresets,
      };
    case "set-error":
      return { ...state, error: action.payload };
    case "set-metric":
      return { ...state, metric: action.payload };
    case "set-trials":
      return { ...state, trials: Math.max(10, action.payload) || 10 };
    case "toggle-custom-range":
      return {
        ...state,
        customRangeEnabled: action.payload,
        startDate: action.payload ? state.startDate : undefined,
        endDate: action.payload ? state.endDate : undefined,
      };
    case "set-date":
      return action.payload.field === "start"
        ? { ...state, startDate: action.payload.value }
        : { ...state, endDate: action.payload.value };
    case "add-filter":
      return {
        ...state,
        filters: [
          ...state.filters,
          {
            id: crypto.randomUUID(),
            metric: state.favouriteMetrics[0] ?? defaultFilterMetric,
            comparator: ">=",
            value: "",
          },
        ],
      };
    case "update-filter":
      return {
        ...state,
        filters: state.filters.map((filter) =>
          filter.id === action.payload.id ? { ...filter, [action.payload.field]: action.payload.value } : filter,
        ),
      };
    case "remove-filter":
      return {
        ...state,
        filters: state.filters.filter((filter) => filter.id !== action.payload),
      };
    case "set-status":
      return { ...state, status: action.payload };
    case "set-progress":
      return {
        ...state,
        totalTrials: action.payload.totalTrials ?? state.totalTrials,
        completedTrials: action.payload.completedTrials ?? state.completedTrials,
        bestTrial: action.payload.bestTrial ?? state.bestTrial,
      };
    case "append-trial":
      return {
        ...state,
        completedTrials: [action.payload, ...state.completedTrials].slice(0, 200),
      };
    case "reset-trials":
      return {
        ...state,
        completedTrials: [],
        bestTrial: undefined,
        totalTrials: action.payload.totalTrials ?? state.totalTrials,
      };
    case "set-status-message":
      return { ...state, statusMessage: action.payload };
    case "set-favourite-metrics":
      return { ...state, favouriteMetrics: action.payload };
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
    updateParameterRange(id: string, field: ParameterField, value: string): void;
    setMetric(metric: StrategyMetric): void;
    setTrials(trials: number): void;
    toggleCustomRange(enabled: boolean): void;
    setDate(field: "start" | "end", value?: string): void;
    addFilter(): void;
    updateFilter(id: string, field: keyof FilterDraft, value: string): void;
    removeFilter(id: string): void;
    toggleFavouriteMetric(metric: StrategyMetric): Promise<void>;
    savePreset(name: string): Promise<void>;
    applyPreset(presetId: string): void;
    deletePreset(presetId: string): Promise<void>;
    loadStrategies(): Promise<void>;
    loadParameters(strategyId: string): Promise<void>;
    startOptimisation(): Promise<void>;
    stopOptimisation(): Promise<void>;
    applyBestToChart(): Promise<void>;
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
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let mounted = true;
    loadFavouriteMetrics().then((favourites) => {
      if (mounted) dispatch({ type: "set-favourite-metrics", payload: favourites });
    });
    return () => {
      mounted = false;
    };
  }, []);

  const buildOptimisationConfig = useCallback((): OptimisationConfig | null => {
    const {
      selectedStrategyId,
      parameterOrder,
      parameters,
      filters,
      metric,
      trials,
      customRangeEnabled,
      startDate,
      endDate,
    } = stateRef.current;
    if (!selectedStrategyId) return null;

    const enabledParams = parameterOrder
      .map((id) => parameters[id])
      .filter((p): p is ParameterState => Boolean(p?.enabled));

    if (!enabledParams.length) return null;

    return {
      strategyId: selectedStrategyId,
      params: enabledParams.map((p) => ({
        paramId: p.definition.id,
        label: p.definition.label,
        type: p.definition.type,
        enabled: true,
        range: { min: Number(p.min), max: Number(p.max) },
      })),
      settings: {
        metric,
        trials,
        useCustomRange: customRangeEnabled,
        startDate: customRangeEnabled ? startDate : undefined,
        endDate: customRangeEnabled ? endDate : undefined,
        filters: filters
          .filter((f) => f.value !== "")
          .map((f) => ({ id: f.id, metric: f.metric, comparator: f.comparator, value: Number(f.value) }))
          .filter((f) => Number.isFinite(f.value)),
      },
    };
  }, []);

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

  const loadPresets = useCallback(async (strategyId?: string) => {
    if (!strategyId) {
      dispatch({ type: "set-presets", payload: [] });
      return;
    }

    dispatch({ type: "set-loading", payload: { presets: true } });
    dispatch({ type: "set-error", payload: undefined });
    try {
      const presets = await loadStrategyPresets(strategyId);
      dispatch({ type: "set-presets", payload: presets });
    } catch (error) {
      console.warn("Preset load failed", error);
      dispatch({
        type: "set-error",
        payload: "Unable to load saved presets. Storage permission denied.",
      });
    } finally {
      dispatch({ type: "set-loading", payload: { presets: false } });
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      const draft = await loadSessionDraft<PersistedOptimiserState>();
      if (isMounted && draft?.version === PERSIST_VERSION) {
        const { version: _, ...rest } = draft;
        dispatch({ type: "hydrate", payload: rest });
        if (rest.selectedStrategyId) {
          void loadPresets(rest.selectedStrategyId);
        }
      }

      const response = await sendBackgroundMessage({ type: "get-session" });
      if (isMounted && response?.type === "session") {
        dispatch({ type: "hydrate", payload: sessionSnapshotToState(response.snapshot) });
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [loadPresets]);

  const startOptimisation = useCallback(async () => {
    dispatch({ type: "set-error", payload: undefined });
    const config = buildOptimisationConfig();
    if (!config) {
      dispatch({ type: "set-error", payload: "Select a strategy and parameters first." });
      return;
    }

    const response = await sendBackgroundMessage({ type: "start-optimisation", payload: config });
    if (response?.type === "error") {
      dispatch({ type: "set-error", payload: response.message });
      return;
    }

    dispatch({ type: "set-status", payload: "running" });
    dispatch({ type: "reset-trials", payload: { totalTrials: config.settings.trials } });
    dispatch({ type: "set-status-message", payload: "Optimisation session started" });
    dispatch({ type: "set-tab", payload: "results" });
  }, [buildOptimisationConfig]);

  const stopOptimisation = useCallback(async () => {
    const response = await sendBackgroundMessage({ type: "stop-optimisation" });
    if (response?.type === "error") {
      dispatch({ type: "set-error", payload: response.message });
    }
    dispatch({ type: "set-status", payload: "stopped" });
    dispatch({ type: "set-status-message", payload: "Optimisation stopped by user" });
  }, []);

  const applyBestToChart = useCallback(async () => {
    dispatch({ type: "set-error", payload: undefined });
    const response = await sendBackgroundMessage({ type: "apply-best-params" });

    if (!response) {
      dispatch({ type: "set-error", payload: "Background worker is unavailable. Reload the extension." });
    } else if (response.type === "error") {
      dispatch({ type: "set-error", payload: response.message });
    } else {
      dispatch({ type: "set-status-message", payload: "Best parameters applied to your chart" });
    }
  }, []);

  const savePreset = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      dispatch({ type: "set-error", payload: "Please provide a name for this preset." });
      return;
    }

    const { selectedStrategyId, parameterOrder, parameters } = stateRef.current;
    if (!selectedStrategyId) {
      dispatch({ type: "set-error", payload: "Select a strategy before saving presets." });
      return;
    }

    if (!parameterOrder.some((id) => parameters[id]?.enabled)) {
      dispatch({ type: "set-error", payload: "Enable at least one parameter before saving a preset." });
      return;
    }

    const preset: StrategyPreset = {
      id: crypto.randomUUID(),
      strategyId: selectedStrategyId,
      name: trimmed,
      createdAt: new Date().toISOString(),
      parameters: Object.fromEntries(
        parameterOrder
          .filter((id) => parameters[id])
          .map((id) => [id, { enabled: parameters[id].enabled, min: parameters[id].min, max: parameters[id].max }]),
      ),
    };

    dispatch({ type: "set-loading", payload: { presets: true } });
    dispatch({ type: "set-error", payload: undefined });
    try {
      const updated = await persistStrategyPreset(preset);
      dispatch({ type: "set-presets", payload: updated });
      dispatch({ type: "apply-preset", payload: preset });
    } catch (error) {
      console.warn("Preset save failed", error);
      dispatch({ type: "set-error", payload: "Unable to save the preset. Check extension storage access." });
    } finally {
      dispatch({ type: "set-loading", payload: { presets: false } });
    }
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = stateRef.current.presets.find((p) => p.id === presetId);
    if (preset) dispatch({ type: "apply-preset", payload: preset });
  }, []);

  const deletePresetById = useCallback(async (presetId: string) => {
    const strategyId = stateRef.current.selectedStrategyId;
    if (!strategyId) {
      return;
    }

    dispatch({ type: "set-loading", payload: { presets: true } });
    dispatch({ type: "set-error", payload: undefined });
    try {
      const updated = await deleteStrategyPreset(strategyId, presetId);
      dispatch({ type: "set-presets", payload: updated });
    } catch (error) {
      console.warn("Preset delete failed", error);
      dispatch({
        type: "set-error",
        payload: "Unable to delete the preset. Check extension storage access.",
      });
    } finally {
      dispatch({ type: "set-loading", payload: { presets: false } });
    }
  }, []);

  const toggleFavouriteMetric = useCallback(async (metric: StrategyMetric) => {
    const current = stateRef.current.favouriteMetrics;
    const exists = current.includes(metric);
    const next = exists ? current.filter((item) => item !== metric) : [metric, ...current];
    dispatch({ type: "set-favourite-metrics", payload: next });
    try {
      await persistFavouriteMetrics(next);
    } catch (error) {
      console.warn("Favourite metrics update failed", error);
      dispatch({
        type: "set-error",
        payload: "Unable to update favourite metrics. Storage permission denied.",
      });
    }
  }, []);

  useEffect(() => {
    const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message: unknown) => {
      if (!message || typeof message !== "object" || !("type" in message)) {
        return undefined;
      }

      const typed = message as ExtensionEvent;
      switch (typed.type) {
        case "status":
          dispatch({ type: "set-status", payload: typed.status });
          dispatch({ type: "set-status-message", payload: typed.message });
          break;
        case "trial":
          dispatch({
            type: "append-trial",
            payload: broadcastToTrial(typed.payload),
          });
          dispatch({
            type: "set-progress",
            payload: {
              totalTrials: typed.payload.progress.total,
              bestTrial: typed.payload.best ?? stateRef.current.bestTrial,
            },
          });
          break;
        case "complete": {
          const status: RunStatus = typed.reason === "finished" ? "completed" : "stopped";
          dispatch({ type: "set-status", payload: status });
          dispatch({
            type: "set-status-message",
            payload: typed.reason === "finished" ? "Optimisation completed" : "Optimisation stopped",
          });
          if (typed.best) {
            dispatch({
              type: "set-progress",
              payload: { bestTrial: typed.best },
            });
          }
          break;
        }
        default:
          break;
      }

      return undefined;
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    loadStrategies();
  }, [loadStrategies]);

  const persistableState = useMemo(
    (): PersistedOptimiserState => ({
      version: PERSIST_VERSION,
      tab: state.tab,
      selectedStrategyId: state.selectedStrategyId,
      parameterOrder: state.parameterOrder,
      parameters: state.parameters,
      metric: state.metric,
      trials: state.trials,
      customRangeEnabled: state.customRangeEnabled,
      startDate: state.startDate,
      endDate: state.endDate,
      filters: state.filters,
      activePresetId: state.activePresetId,
    }),
    [
      state.tab,
      state.selectedStrategyId,
      state.parameterOrder,
      state.parameters,
      state.metric,
      state.trials,
      state.customRangeEnabled,
      state.startDate,
      state.endDate,
      state.filters,
      state.activePresetId,
    ],
  );

  useEffect(() => {
    void persistSessionDraft(persistableState);
  }, [persistableState]);

  const contextValue = useMemo<OptimiserContextValue>(
    () => ({
      state,
      actions: {
        setTab: (tab) => dispatch({ type: "set-tab", payload: tab }),
        selectStrategy: (id) => {
          dispatch({ type: "set-selected-strategy", payload: id });
          if (id) {
            void loadParameters(id);
            void loadPresets(id);
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
        toggleCustomRange: (enabled) => dispatch({ type: "toggle-custom-range", payload: enabled }),
        setDate: (field, value) => dispatch({ type: "set-date", payload: { field, value } }),
        addFilter: () => dispatch({ type: "add-filter" }),
        updateFilter: (id, field, value) =>
          dispatch({
            type: "update-filter",
            payload: { id, field: field as keyof FilterDraft, value },
          }),
        removeFilter: (id) => dispatch({ type: "remove-filter", payload: id }),
        savePreset,
        applyPreset,
        deletePreset: deletePresetById,
        loadStrategies,
        loadParameters,
        startOptimisation,
        stopOptimisation,
        applyBestToChart,
        toggleFavouriteMetric,
      },
    }),
    [
      state,
      loadStrategies,
      loadParameters,
      startOptimisation,
      stopOptimisation,
      applyBestToChart,
      savePreset,
      applyPreset,
      deletePresetById,
      toggleFavouriteMetric,
    ],
  );

  return <OptimiserContext.Provider value={contextValue}>{children}</OptimiserContext.Provider>;
}

function sessionSnapshotToState(snapshot: OptimisationSessionSnapshot): Partial<OptimiserState> {
  return {
    status: snapshot.status,
    statusMessage: snapshot.statusMessage,
    totalTrials: snapshot.totalTrials || snapshot.config?.settings?.trials || 0,
    completedTrials: snapshot.completedTrials ?? [],
    bestTrial: snapshot.bestTrial ?? undefined,
  };
}

export function useOptimiser() {
  const ctx = useContext(OptimiserContext);
  if (!ctx) {
    throw new Error("useOptimiser must be used within OptimiserProvider");
  }
  return ctx;
}
