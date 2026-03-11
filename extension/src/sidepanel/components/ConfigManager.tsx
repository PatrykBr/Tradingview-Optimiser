import { useState } from 'react';
import { useOptimizationStore } from '../store';
import type { SavedConfig } from '../../shared/types';
import { getSavedConfigs, saveConfig, deleteConfig } from '../../utils/storage';
import { sanitizeOptimizationConfigInput, sanitizeSavedConfigImport } from '../../shared/config-schema';
import { useShallow } from 'zustand/react/shallow';
import CollapsiblePanelCard from './CollapsiblePanelCard';

export default function ConfigManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [saveName, setSaveName] = useState('');
  const [showSave, setShowSave] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

  const {
    strategyName,
    selectedStrategyIndex,
    parameters,
    targetMetric,
    targetMetricDirection,
    targetMetricColumn,
    runMode,
    selectedHistoryRunIds,
    sampler,
    totalTrials,
    filters,
    antiDetection,
    setParameters,
    setTargetMetric,
    setTargetMetricColumn,
    setRunMode,
    setSelectedHistoryRunIds,
    setSampler,
    setTotalTrials,
    setFilters,
    setAntiDetection,
  } = useOptimizationStore(
    useShallow((s) => ({
      strategyName: s.strategyName,
      selectedStrategyIndex: s.selectedStrategyIndex,
      parameters: s.parameters,
      targetMetric: s.targetMetric,
      targetMetricDirection: s.targetMetricDirection,
      targetMetricColumn: s.targetMetricColumn,
      runMode: s.runMode,
      selectedHistoryRunIds: s.selectedHistoryRunIds,
      sampler: s.sampler,
      totalTrials: s.totalTrials,
      filters: s.filters,
      antiDetection: s.antiDetection,
      setParameters: s.setParameters,
      setTargetMetric: s.setTargetMetric,
      setTargetMetricColumn: s.setTargetMetricColumn,
      setRunMode: s.setRunMode,
      setSelectedHistoryRunIds: s.setSelectedHistoryRunIds,
      setSampler: s.setSampler,
      setTotalTrials: s.setTotalTrials,
      setFilters: s.setFilters,
      setAntiDetection: s.setAntiDetection,
    })),
  );

  const reportUiError = (action: string, message: string, err: unknown) => {
    console.error(`[ConfigManager] Failed to ${action}:`, err);
    setUiError(message);
  };

  const loadConfigs = async () => {
    try {
      const loaded = await getSavedConfigs();
      setConfigs(loaded);
      setUiError(null);
    } catch (err) {
      reportUiError('load configs', 'Failed to load saved configurations.', err);
    }
  };

  const handleToggle = async () => {
    if (!isOpen) await loadConfigs();
    setIsOpen(!isOpen);
  };

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) {
      setUiError('Enter a config name before saving.');
      return;
    }

    try {
      const now = Date.now();
      const config: SavedConfig = {
        id: `config_${now}`,
        name,
        strategyName,
        config: {
          name,
          strategyName,
          strategyIndex: selectedStrategyIndex ?? 0,
          runMode,
          selectedHistoryRunIds,
          sampler,
          targetMetric,
          targetMetricDirection,
          targetMetricColumn,
          totalTrials,
          parameters,
          filters,
          antiDetection,
        },
        createdAt: now,
        updatedAt: now,
      };

      await saveConfig(config);
      setSaveName('');
      setShowSave(false);
      setUiError(null);
      await loadConfigs();
    } catch (err) {
      reportUiError('save config', 'Failed to save configuration.', err);
    }
  };

  const handleLoad = (config: SavedConfig) => {
    try {
      const safeConfig = sanitizeOptimizationConfigInput(config.config, {
        strategyName: config.strategyName,
        name: config.name,
      });
      const selectedName = strategyName.trim().toLowerCase();
      const configName = config.strategyName.trim().toLowerCase();
      const sameStrategySelected =
        (selectedStrategyIndex !== null && selectedStrategyIndex === safeConfig.strategyIndex) ||
        (selectedName.length > 0 && selectedName === configName);
      if (!sameStrategySelected) {
        setUiError(
          `Select strategy "${config.strategyName}" before loading this configuration.`,
        );
        return;
      }
      setParameters(safeConfig.parameters);
      setTargetMetric(safeConfig.targetMetric, safeConfig.targetMetricDirection);
      setTargetMetricColumn(safeConfig.targetMetricColumn);
      setRunMode(safeConfig.runMode ?? 'fresh');
      setSelectedHistoryRunIds(safeConfig.selectedHistoryRunIds ?? []);
      setSampler(safeConfig.sampler ?? 'auto');
      setTotalTrials(safeConfig.totalTrials);
      setFilters(safeConfig.filters);
      setAntiDetection(safeConfig.antiDetection);
      setIsOpen(false);
      setUiError(null);
    } catch (err) {
      reportUiError('load config', 'Failed to load the selected configuration.', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConfig(id);
      setUiError(null);
      await loadConfigs();
    } catch (err) {
      reportUiError('delete config', 'Failed to delete configuration.', err);
    }
  };

  const handleExport = (config: SavedConfig) => {
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const imported: SavedConfig = sanitizeSavedConfigImport(parsed, file.name.replace(/\.json$/i, ''));
        await saveConfig(imported);
        setUiError(null);
        await loadConfigs();
      } catch (err) {
        reportUiError('import config', 'Failed to import configuration file.', err);
      }
    };
    input.click();
  };

  return (
    <CollapsiblePanelCard
      open={isOpen}
      onToggle={handleToggle}
      title="Saved Configs"
      icon={
        <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
      }
    >
      {uiError && (
        <div className="mx-4 mt-3 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-[12px] text-danger">
          {uiError}
        </div>
      )}

      {/* Save current / Import */}
      <div className="panel-card-body border-b border-border/40">
        {showSave ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Config name..."
              className="ui-input flex-1"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
            <button onClick={handleSave} className="ui-btn ui-btn-primary px-3">
              Save
            </button>
            <button onClick={() => setShowSave(false)} className="ui-btn ui-btn-ghost px-3">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setShowSave(true)}
              disabled={parameters.length === 0}
              className="ui-btn ui-btn-secondary flex-1 disabled:opacity-40"
            >
              Save Current Config
            </button>
            <button
              onClick={handleImport}
              className="ui-btn ui-btn-ghost ui-icon-btn"
              title="Import config from JSON file"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Saved configs list */}
      {configs.length === 0 ? (
        <div className="panel-card-body py-7">
          <div className="ui-empty-state">
            <p className="text-[12px] text-text-muted">No saved configurations</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/40 max-h-52 overflow-y-auto">
          {configs.map((config) => (
            <div
              key={config.id}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-bg-hover/45"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => handleLoad(config)}
              >
                <div className="text-[12px] font-medium text-text-primary truncate">{config.name}</div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {config.strategyName} &middot; {new Date(config.updatedAt).toLocaleDateString()}
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0 ml-2">
                <button
                  onClick={() => handleExport(config)}
                  className="ui-btn ui-btn-ghost h-7 min-h-7 px-2 py-1 text-text-muted hover:text-accent"
                  title="Export as JSON"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(config.id)}
                  className="ui-btn ui-btn-ghost h-7 min-h-7 px-2 py-1 text-text-muted hover:text-danger"
                  title="Delete config"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </CollapsiblePanelCard>
  );
}
