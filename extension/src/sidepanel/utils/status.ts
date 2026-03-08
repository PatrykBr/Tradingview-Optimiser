import type { OptimizationStatus } from '../../shared/types';

export function isActiveRunStatus(status: OptimizationStatus): status is 'running' | 'paused' {
  return status === 'running' || status === 'paused';
}

export function getStatusBadgeClassName(status: OptimizationStatus): string {
  if (status === 'running') {
    return 'border-accent/45 bg-accent-soft text-accent';
  }
  if (status === 'paused') {
    return 'border-warning/45 bg-warning-soft text-warning';
  }
  return 'border-border/55 bg-bg-tertiary text-text-muted';
}
