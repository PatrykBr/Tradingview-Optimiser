import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useOptimizationStore } from '../store';
import type { NumericParameter, CheckboxParameter, DropdownParameter, StrategyParameter } from '../../shared/types';
import { useShallow } from 'zustand/react/shallow';
import { parseNumberOr } from '../utils/number';

const ALL_SECTIONS_KEY = '__all_sections';
const SEARCH_INPUT_CLASS = 'ui-input';
const NUMERIC_INPUT_CLASS = 'ui-input min-h-8 py-1.5 text-[12px]';

function formatSectionName(section: string): string {
  return section || 'General';
}

function sectionKey(section: string): string {
  return section || '__general';
}

function matchesParameterSearch(param: StrategyParameter, query: string): boolean {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  return (
    param.label.toLowerCase().includes(normalizedQuery) ||
    param.id.toLowerCase().includes(normalizedQuery) ||
    param.type.toLowerCase().includes(normalizedQuery)
  );
}

function formatCount(current: number, total: number): string {
  return total > 0 ? `${current}/${total}` : `${current}`;
}

interface SectionModel {
  section: string;
  params: StrategyParameter[];
  enabledCount: number;
  visibleParams: StrategyParameter[];
  sectionMatchesQuery: boolean;
}

type SearchFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
};

type NumericFieldProps = {
  label: string;
  value: number;
  step?: string;
  onChange: (value: number) => void;
};

type SectionChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

type ParameterUpdater<T extends StrategyParameter> = (id: string, updates: Partial<T>) => void;
type ParameterRowProps = { param: StrategyParameter; onUpdate: ParameterUpdater<StrategyParameter> };
type EmptyNoticeProps = { text: string };
type NumericConfigProps = { param: NumericParameter; onUpdate: ParameterUpdater<NumericParameter> };
type CheckboxConfigProps = { param: CheckboxParameter; onUpdate: ParameterUpdater<CheckboxParameter> };
type DropdownConfigProps = { param: DropdownParameter; onUpdate: ParameterUpdater<DropdownParameter> };

function EmptyNotice({ text }: EmptyNoticeProps): ReactElement {
  return <div className="ui-empty-state text-[11px] text-text-muted">{text}</div>;
}

function SearchField({ label, value, placeholder, onChange }: SearchFieldProps): ReactElement {
  return (
    <div className="grid gap-2">
      <label className="ui-field-label">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={SEARCH_INPUT_CLASS}
      />
    </div>
  );
}

function NumericField({ label, value, step, onChange }: NumericFieldProps): ReactElement {
  return (
    <div className="min-w-0">
      <label className="ui-field-label mb-1 block">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseNumberOr(e.target.value, value))}
        className={NUMERIC_INPUT_CLASS}
        step={step}
      />
    </div>
  );
}

function SectionChip({ label, active, onClick }: SectionChipProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 min-w-20 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 py-1 text-left transition-colors ${
        active
          ? 'border-accent/45 bg-accent-soft/85 text-accent'
          : 'border-border/45 bg-transparent text-text-secondary hover:border-border/75 hover:bg-bg-hover/45'
      }`}
    >
      <span className={`px-1 text-[11px] ${active ? 'font-semibold text-accent' : 'text-text-secondary'}`}>{label}</span>
    </button>
  );
}

export default function ParameterConfig() {
  const { parameters, updateParameter } = useOptimizationStore(
    useShallow((s) => ({
      parameters: s.parameters,
      updateParameter: s.updateParameter,
    })),
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string>('');
  const [showEnabledOnly, setShowEnabledOnly] = useState(false);

  const sections = useMemo(() => {
    const grouped = new Map<string, StrategyParameter[]>();
    for (const param of parameters) {
      const group = grouped.get(param.section) ?? [];
      group.push(param);
      grouped.set(param.section, group);
    }

    // Preserve first-appearance order from the parameter list so sections
    // match the order shown in the source settings modal.
    return Array.from(grouped.entries());
  }, [parameters]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasQuery = normalizedQuery.length > 0;

  const sectionModels = useMemo((): SectionModel[] => {
    return sections.map(([section, sectionParams]) => {
      const sectionLabel = formatSectionName(section).toLowerCase();
      const sectionMatchesQuery = hasQuery ? sectionLabel.includes(normalizedQuery) : true;
      const enabledCount = sectionParams.filter((param) => param.enabled).length;

      const visibleParams = sectionParams.filter((param) => {
        if (showEnabledOnly && !param.enabled) return false;
        if (!hasQuery) return true;
        return sectionMatchesQuery || matchesParameterSearch(param, normalizedQuery);
      });

      return {
        section,
        params: sectionParams,
        enabledCount,
        visibleParams,
        sectionMatchesQuery,
      };
    });
  }, [hasQuery, normalizedQuery, sections, showEnabledOnly]);

  const selectableSections = useMemo(() => {
    return sectionModels.filter((section) => {
      if (hasQuery) {
        return section.sectionMatchesQuery || section.visibleParams.length > 0;
      }
      if (showEnabledOnly) {
        return section.visibleParams.length > 0;
      }
      return true;
    });
  }, [hasQuery, sectionModels, showEnabledOnly]);

  useEffect(() => {
    if (selectableSections.length === 0) {
      if (activeSection !== ALL_SECTIONS_KEY) {
        setActiveSection(ALL_SECTIONS_KEY);
      }
      return;
    }

    if (!activeSection) {
      setActiveSection(selectableSections[0].section);
      return;
    }

    if (activeSection === ALL_SECTIONS_KEY) {
      return;
    }

    const sectionStillAvailable = selectableSections.some((section) => section.section === activeSection);
    if (!sectionStillAvailable) {
      setActiveSection(selectableSections[0].section);
    }
  }, [activeSection, selectableSections]);

  const selectedSectionModel = useMemo(
    () => selectableSections.find((section) => section.section === activeSection) ?? null,
    [activeSection, selectableSections],
  );

  const displayedSections = useMemo(() => {
    if (activeSection === ALL_SECTIONS_KEY) {
      return selectableSections.filter((section) => section.visibleParams.length > 0);
    }

    if (!selectedSectionModel || selectedSectionModel.visibleParams.length === 0) {
      return [];
    }

    return [selectedSectionModel];
  }, [activeSection, selectableSections, selectedSectionModel]);

  const enabledTotal = useMemo(() => parameters.filter((param) => param.enabled).length, [parameters]);
  const visibleTotal = useMemo(
    () => selectableSections.reduce((count, section) => count + section.visibleParams.length, 0),
    [selectableSections],
  );
  const displayedTotal = useMemo(
    () => displayedSections.reduce((count, section) => count + section.visibleParams.length, 0),
    [displayedSections],
  );
  const visibleScopeTotal = showEnabledOnly ? enabledTotal : parameters.length;

  if (parameters.length === 0) return null;

  return (
    <div className="panel-card overflow-hidden">
      <div className="panel-card-header">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="panel-card-icon flex h-5 w-5 shrink-0 items-center justify-center">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
                />
              </svg>
            </span>
            <h2 className="panel-card-title">Parameters</h2>
          </div>
          <span className="text-[11px] text-text-muted font-medium">{enabledTotal}/{parameters.length} enabled</span>
        </div>
      </div>

      <div className="panel-card-body panel-stack">
        <div className="panel-stack-tight">
          <SearchField
            label="Search"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Section or parameter..."
          />
          <div className="flex items-center justify-between gap-3">
            <div className="inline-grid h-9 w-[184px] grid-cols-2 rounded-lg border border-border/60 bg-bg-tertiary/45 p-0.5">
              <button
                type="button"
                onClick={() => setShowEnabledOnly(false)}
                className={`h-full rounded-md px-3.5 text-[11px] font-semibold text-center transition-colors ${
                  !showEnabledOnly
                    ? 'bg-accent text-[#06251d] shadow-[0_2px_7px_rgba(46,201,168,0.28)]'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setShowEnabledOnly(true)}
                className={`h-full rounded-md px-3.5 text-[11px] font-semibold text-center transition-colors ${
                  showEnabledOnly
                    ? 'bg-accent text-[#06251d] shadow-[0_2px_7px_rgba(46,201,168,0.28)]'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Enabled
              </button>
            </div>
            <span className="text-[11px] font-mono text-text-muted">{visibleTotal}/{visibleScopeTotal}</span>
          </div>
        </div>

        <div className="panel-divider panel-stack-tight">
          <div className="flex items-center justify-between">
            <span className="ui-field-label">Sections</span>
            {sections.length > 0 && <span className="text-[11px] text-text-muted">{sections.length} total</span>}
          </div>
          {selectableSections.length === 0 ? (
            <EmptyNotice text="No sections match the current filters." />
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 pl-1 pr-2">
              <SectionChip
                label="All"
                active={activeSection === ALL_SECTIONS_KEY}
                onClick={() => setActiveSection(ALL_SECTIONS_KEY)}
              />
              {selectableSections.map((section) => (
                <SectionChip
                  key={sectionKey(section.section)}
                  label={formatSectionName(section.section)}
                  active={activeSection === section.section}
                  onClick={() => setActiveSection(section.section)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="panel-divider panel-stack-tight">
          <div className="flex items-center justify-between">
            <h3 className="panel-card-title">
              {activeSection === ALL_SECTIONS_KEY ? 'Matching Parameters' : formatSectionName(selectedSectionModel?.section ?? '')}
            </h3>
            <span className="text-[11px] font-mono text-text-muted">{displayedTotal} shown</span>
          </div>

          {displayedSections.length === 0 ? (
            <EmptyNotice text="No parameters match the current filters." />
          ) : (
            <div className="max-h-136 overflow-y-auto overflow-x-hidden pr-1">
              <div className="panel-stack-tight">
                {displayedSections.map((section) => (
                  <div key={sectionKey(section.section)} className="panel-stack-tight">
                    {activeSection === ALL_SECTIONS_KEY && (
                      <div className="flex items-center justify-between px-1 py-0.5">
                        <span className="text-[11px] font-medium text-text-secondary">{formatSectionName(section.section)}</span>
                        <span className="text-[11px] font-mono text-text-muted">
                          {formatCount(section.visibleParams.length, showEnabledOnly ? section.enabledCount : section.params.length)}
                        </span>
                      </div>
                    )}
                    {section.visibleParams.map((param) => (
                      <ParameterRow
                        key={`${sectionKey(section.section)}__${param.id}`}
                        param={param}
                        onUpdate={updateParameter}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderParameterConfig(
  param: StrategyParameter,
  onUpdate: ParameterUpdater<StrategyParameter>,
): ReactElement | null {
  if (!param.enabled) {
    return null;
  }

  switch (param.type) {
    case 'numeric':
      return <NumericConfig param={param} onUpdate={onUpdate} />;
    case 'checkbox':
      return <CheckboxConfig param={param} onUpdate={onUpdate} />;
    case 'dropdown':
      return <DropdownConfig param={param} onUpdate={onUpdate} />;
  }
}

const ParameterRow = memo(function ParameterRow({ param, onUpdate }: ParameterRowProps) {
  const renderedConfig = renderParameterConfig(param, onUpdate);

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        param.enabled ? 'border-border/70 bg-bg-tertiary/65' : 'border-border/40 bg-bg-primary/30 opacity-55'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 cursor-pointer pr-1">
          <input
            type="checkbox"
            checked={param.enabled}
            onChange={(e) => onUpdate(param.id, { enabled: e.target.checked })}
            className="ui-checkbox"
          />
          <span className="truncate text-[12px] font-medium text-text-primary">{param.label}</span>
        </label>
        <span className="shrink-0 max-w-[84px] truncate rounded-md border border-border/45 bg-bg-primary/45 px-2 py-0.5 text-[11px] capitalize text-text-muted">
          {param.type}
        </span>
      </div>
      {renderedConfig}
    </div>
  );
});

function sanitizeNumericValue(value: number, fallback: number, enforcePositive = false): number {
  if (isNaN(value)) return fallback;
  if (enforcePositive && value <= 0) return fallback;
  return value;
}

function NumericConfig({ param, onUpdate }: NumericConfigProps): ReactElement {
  return (
    <div className="mt-2 panel-stack-tight">
      <div className="grid grid-cols-3 gap-2">
        <NumericField
          label="Min"
          value={param.min}
          onChange={(value) => onUpdate(param.id, { min: sanitizeNumericValue(value, 0) })}
        />
        <NumericField
          label="Max"
          value={param.max}
          onChange={(value) => onUpdate(param.id, { max: sanitizeNumericValue(value, 0) })}
        />
        <NumericField
          label="Step"
          value={param.step}
          step="0.1"
          onChange={(value) => onUpdate(param.id, { step: sanitizeNumericValue(value, 0.1, true) })}
        />
      </div>
      <div className="text-[11px] text-text-muted">
        Current: <span className="font-mono text-text-secondary">{param.currentValue}</span>
      </div>
    </div>
  );
}

function CheckboxConfig({ param, onUpdate }: CheckboxConfigProps): ReactElement {
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={param.optimize}
          onChange={(e) => onUpdate(param.id, { optimize: e.target.checked })}
          className="ui-checkbox"
        />
        Try both values
      </label>
      <span className="text-[11px] text-text-muted">
        Current: <span className="font-mono text-text-secondary">{param.currentValue ? 'On' : 'Off'}</span>
      </span>
    </div>
  );
}

function DropdownConfig({ param, onUpdate }: DropdownConfigProps): ReactElement {
  return (
    <div className="mt-2 panel-stack-tight">
      <div className="text-[11px] text-text-muted">
        Current: <span className="font-mono text-text-secondary">{param.currentValue}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {param.options.map((option) => {
          const isSelected = param.selectedOptions.includes(option);
          return (
            <button
              key={`${param.id}__${option}`}
              type="button"
              onClick={() => {
                const next = isSelected
                  ? param.selectedOptions.filter((o) => o !== option)
                  : [...param.selectedOptions, option];
                onUpdate(param.id, { selectedOptions: next });
              }}
              className={`ui-chip px-2.5 py-1 text-[11px] transition-colors ${
                isSelected ? 'ui-chip-active font-medium' : 'bg-bg-primary/40 text-text-muted hover:text-text-secondary'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
