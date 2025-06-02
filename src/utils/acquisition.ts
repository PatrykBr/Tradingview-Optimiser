export function expectedImprovement(
  mean: number[],
  variance: number[],
  best: number,
  xi = 0.01
): number[] {
  return mean.map((mu, i) => {
    const sigma = Math.sqrt(variance[i]);
    if (sigma === 0) return 0;
    const diff = mu - best - xi;
    const Z = diff / sigma;
    const cdf = 0.5 * (1 + erf(Z / Math.sqrt(2)));
    const pdf = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * Z * Z);
    return diff * cdf + sigma * pdf;
  });
}

export function upperConfidenceBound(
  mean: number[],
  variance: number[],
  kappa = 2.576
): number[] {
  return mean.map((mu, i) => {
    const sigma = Math.sqrt(variance[i]);
    return mu + kappa * sigma;
  });
}

// Error function approximation
function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-absX * absX);
  return sign * y;
} 