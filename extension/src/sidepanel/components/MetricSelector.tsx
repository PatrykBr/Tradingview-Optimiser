import { useState, useMemo, useRef, useEffect } from 'react';
import { useOptimizationStore } from '../store';
import { AVAILABLE_METRICS } from '../../shared/constants';
import { useShallow } from 'zustand/react/shallow';
import PanelCardHeader from './PanelCardHeader';

export default function MetricSelector() {
  const {
    targetMetric,
    targetMetricDirection,
    targetMetricColumn,
    favoriteMetrics,
    setTargetMetric,
    setTargetMetricColumn,
    toggleFavoriteMetric,
  } = useOptimizationStore(
    useShallow((s) => ({
      targetMetric: s.targetMetric,
      targetMetricDirection: s.targetMetricDirection,
      targetMetricColumn: s.targetMetricColumn,
      favoriteMetrics: s.favoriteMetrics,
      setTargetMetric: s.setTargetMetric,
      setTargetMetricColumn: s.setTargetMetricColumn,
      toggleFavoriteMetric: s.toggleFavoriteMetric,
    })),
  );

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const sortedMetrics = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase();
    const favoriteMetricSet = new Set(favoriteMetrics);
    const filtered = AVAILABLE_METRICS.filter((m) => m.name.toLowerCase().includes(normalizedQuery));

    const favorites = filtered.filter((m) => favoriteMetricSet.has(m.name));
    const rest = filtered.filter((m) => !favoriteMetricSet.has(m.name));

    return { favorites, rest };
  }, [favoriteMetrics, search]);

  const selectMetric = (name: string, direction: 'maximize' | 'minimize') => {
    setTargetMetric(name, direction);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="panel-card relative">
      <PanelCardHeader
        title="Optimization Target"
        icon={
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5"
            />
          </svg>
        }
      />

      <div className="panel-card-body panel-stack">
        {/* Metric Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="ui-btn ui-btn-secondary w-full justify-between px-4 py-3 text-left"
          >
            <span className="truncate text-[14px] font-medium text-text-primary">{targetMetric}</span>
            <svg
              className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isOpen && (
            <div
              className="absolute left-0 right-0 z-80 mt-1.5 max-h-96 overflow-hidden rounded-lg border border-border/80 bg-bg-secondary shadow-[0_14px_28px_rgba(0,0,0,0.45)]"
            >
              <div className="p-3 border-b border-border/60">
                <input
                  type="text"
                  placeholder="Search metrics..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="ui-input"
                  autoFocus
                />
              </div>
              <div className="overflow-y-auto max-h-80">
                {sortedMetrics.favorites.length > 0 && (
                  <>
                    <div className="px-3.5 py-1.5 text-[11px] font-semibold text-text-muted tracking-wide">
                      Favorites
                    </div>
                    {sortedMetrics.favorites.map((m) => (
                      <MetricOption
                        key={m.name}
                        name={m.name}
                        section={m.section}
                        isFavorite={true}
                        isSelected={m.name === targetMetric}
                        onSelect={() => selectMetric(m.name, m.defaultDirection)}
                        onToggleFavorite={() => toggleFavoriteMetric(m.name)}
                      />
                    ))}
                    <div className="border-t border-border/40 mx-3" />
                  </>
                )}
                {sortedMetrics.rest.map((m) => (
                  <MetricOption
                    key={m.name}
                    name={m.name}
                    section={m.section}
                    isFavorite={false}
                    isSelected={m.name === targetMetric}
                    onSelect={() => selectMetric(m.name, m.defaultDirection)}
                    onToggleFavorite={() => toggleFavoriteMetric(m.name)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Direction + Column as segmented controls */}
        <div className="grid grid-cols-2 gap-3 panel-divider">
          <div className="flex-1 panel-field">
            <label className="ui-field-label block">Direction</label>
            <div className="ui-segmented">
              <button
                onClick={() => setTargetMetric(targetMetric, 'maximize')}
                className={`ui-segmented-option ${targetMetricDirection === 'maximize' ? 'is-active' : ''}`}
              >
                Maximize
              </button>
              <button
                onClick={() => setTargetMetric(targetMetric, 'minimize')}
                className={`ui-segmented-option ${targetMetricDirection === 'minimize' ? 'is-active' : ''}`}
              >
                Minimize
              </button>
            </div>
          </div>
          <div className="flex-1 panel-field">
            <label className="ui-field-label block">Column</label>
            <div className="ui-segmented">
              {(['all', 'long', 'short'] as const).map((col) => (
                <button
                  key={col}
                  onClick={() => setTargetMetricColumn(col)}
                  className={`ui-segmented-option capitalize ${targetMetricColumn === col ? 'is-active' : ''}`}
                >
                  {col}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricOption({
  name,
  section,
  isFavorite,
  isSelected,
  onSelect,
  onToggleFavorite,
}: {
  name: string;
  section: string;
  isFavorite: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      className={`flex cursor-pointer items-center justify-between px-3.5 py-2.5 transition-colors ${
        isSelected ? 'bg-accent-soft/90' : 'hover:bg-bg-hover/70'
      }`}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-text-primary truncate">{name}</div>
        <div className="text-[11px] text-text-muted">{section}</div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="ml-2 shrink-0 rounded-md border border-transparent p-1 transition-colors hover:border-border/60 hover:bg-bg-active/70"
      >
        <svg
          className={`w-3.5 h-3.5 ${isFavorite ? 'text-warning fill-warning' : 'text-text-muted'}`}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          fill={isFavorite ? 'currentColor' : 'none'}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
          />
        </svg>
      </button>
    </div>
  );
}
