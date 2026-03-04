import { memo } from 'react';
import { useOptimizationStore } from '../store';
import { AVAILABLE_METRICS, FILTER_OPERATORS } from '../../shared/constants';
import type { Filter, FilterOperator } from '../../shared/types';
import { useShallow } from 'zustand/react/shallow';
import PanelCardHeader from './PanelCardHeader';
import { parseNumberOr } from '../utils/number';

function createNextFilterId(filters: Filter[]): string {
  const existingIds = new Set(filters.map((filter) => filter.id));
  let next = filters.length + 1;
  while (existingIds.has(`filter_${next}`)) {
    next += 1;
  }
  return `filter_${next}`;
}

export default function FilterConfig() {
  const { filters, addFilter, removeFilter, updateFilter } = useOptimizationStore(
    useShallow((s) => ({
      filters: s.filters,
      addFilter: s.addFilter,
      removeFilter: s.removeFilter,
      updateFilter: s.updateFilter,
    })),
  );

  const handleAddFilter = () => {
    addFilter({
      id: createNextFilterId(filters),
      metricName: 'Total trades',
      operator: '>=',
      value: 200,
      enabled: true,
    });
  };

  return (
    <div className="panel-card overflow-hidden">
      <PanelCardHeader
        title="Filters"
        icon={
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z"
            />
          </svg>
        }
        right={
          <button
            onClick={handleAddFilter}
            className="ui-btn ui-btn-ghost px-3 py-1 text-[11px]"
          >
            + Add Filter
          </button>
        }
      />

      {filters.length === 0 ? (
        <div className="panel-card-body">
          <div className="ui-empty-state">
            <p className="text-[12px] text-text-muted">No filters configured</p>
            <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
              Filters reject trials that don't meet your criteria.
            </p>
          </div>
        </div>
      ) : (
        <div className="panel-card-body panel-stack-tight">
          {filters.map((filter) => (
            <FilterRow key={filter.id} filter={filter} onUpdate={updateFilter} onRemove={removeFilter} />
          ))}
        </div>
      )}
    </div>
  );
}

const FilterRow = memo(function FilterRow({
  filter,
  onUpdate,
  onRemove,
}: {
  filter: Filter;
  onUpdate: (id: string, updates: Partial<Filter>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        filter.enabled ? 'border-border/70 bg-bg-tertiary/65' : 'border-border/35 bg-bg-primary/30 opacity-45'
      }`}
    >
      {/* Row 1: Enable + Metric + Delete */}
      <div className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={filter.enabled}
          onChange={(e) => onUpdate(filter.id, { enabled: e.target.checked })}
          className="ui-checkbox shrink-0"
        />
        <select
          value={filter.metricName}
          onChange={(e) => onUpdate(filter.id, { metricName: e.target.value })}
          className="ui-select min-h-8 flex-1 py-1.5 pl-2.5 pr-8 text-[12px]"
        >
          {AVAILABLE_METRICS.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => onRemove(filter.id)}
          className="ui-btn ui-btn-ghost h-7 min-h-7 shrink-0 px-2 py-1 text-text-muted hover:text-danger"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Row 2: Operator + Value */}
      <div className="flex items-center gap-2.5 pl-6 panel-divider">
        <select
          value={filter.operator}
          onChange={(e) => onUpdate(filter.id, { operator: e.target.value as FilterOperator })}
          className="ui-select min-h-8 w-16 py-1.5 pl-2 pr-7 text-center text-[12px]"
        >
          {FILTER_OPERATORS.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={filter.value}
          onChange={(e) => onUpdate(filter.id, { value: parseNumberOr(e.target.value, 0) })}
          className="ui-input min-h-8 flex-1 py-1.5 text-right text-[12px]"
        />
      </div>
    </div>
  );
});
