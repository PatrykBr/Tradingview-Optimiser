const TRADINGVIEW_HOST_RE = /^(.+\.)?tradingview\.com$/i;
const TRADINGVIEW_CHART_PATH_RE = /^\/(chart|super-chart|supercharts)(\/|$)/i;

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isTradingViewHost(hostname: string): boolean {
  return TRADINGVIEW_HOST_RE.test(hostname);
}

export function isTradingViewChartPath(pathname: string): boolean {
  return TRADINGVIEW_CHART_PATH_RE.test(pathname);
}

export function isTradingViewUrl(url: string | undefined): boolean {
  if (!url) return false;
  const parsed = tryParseUrl(url);
  return parsed ? isTradingViewHost(parsed.hostname) : false;
}

export function isTradingViewChartUrl(url: string | undefined): boolean {
  if (!url) return false;
  const parsed = tryParseUrl(url);
  return parsed ? isTradingViewHost(parsed.hostname) && isTradingViewChartPath(parsed.pathname) : false;
}
