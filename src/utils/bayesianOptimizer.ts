import { GaussianProcess, KernelOptions } from './gaussianProcess';
import { expectedImprovement, upperConfidenceBound } from './acquisition';

export interface BayesOptimizerOptions {
  f: (params: Record<string, number>) => number | Promise<number>;
  pbounds: Record<string, [number, number]>;
  kernelOptions: KernelOptions;
  noise?: number;
  acquisition?: 'ei' | 'ucb';
  kappa?: number;
  xi?: number;
  nCandidates?: number;
}

export interface BayesIteration {
  target: number;
  params: Record<string, number>;
}

export class BayesianOptimizer {
  private f: (params: Record<string, number>) => Promise<number>;
  private pbounds: Record<string, [number, number]>;
  private gp: GaussianProcess;
  private noise: number;
  private acquisition: 'ei' | 'ucb';
  private kappa: number;
  private xi: number;
  private nCandidates: number;
  public res: BayesIteration[] = [];
  public max?: BayesIteration;

  constructor(options: BayesOptimizerOptions) {
    this.f = async (p) => options.f(p);
    this.pbounds = options.pbounds;
    this.noise = options.noise ?? 1e-6;
    this.acquisition = options.acquisition ?? 'ei';
    this.kappa = options.kappa ?? 2.576;
    this.xi = options.xi ?? 0.01;
    this.nCandidates = options.nCandidates ?? 100;
    this.gp = new GaussianProcess(options.kernelOptions, this.noise);
  }

  public async maximize(initPoints = 5, nIter = 25): Promise<BayesIteration[]> {
    // Initial random sampling
    for (let i = 0; i < initPoints; i++) {
      const { params, xArr } = this.randomSample();
      const y = await this.f(params);
      this.res.push({ target: y, params });
      if (!this.max || y > this.max.target) {
        this.max = { target: y, params };
      }
      this.gp.fit(
        this.res.map(r => this.paramsToArray(r.params)),
        this.res.map(r => r.target)
      );
    }

    // Bayesian optimization loop
    for (let iter = 0; iter < nIter; iter++) {
      this.gp.fit(
        this.res.map(r => this.paramsToArray(r.params)),
        this.res.map(r => r.target)
      );
      const xArr = this.nextPoint();
      const params = this.arrayToParams(xArr);
      const y = await this.f(params);
      this.res.push({ target: y, params });
      if (y > (this.max?.target ?? -Infinity)) {
        this.max = { target: y, params };
      }
    }

    return this.res;
  }

  private randomSample(): { params: Record<string, number>; xArr: number[] } {
    const params: Record<string, number> = {};
    const xArr: number[] = [];
    for (const key in this.pbounds) {
      const [low, high] = this.pbounds[key];
      const val = low + Math.random() * (high - low);
      params[key] = val;
      xArr.push(val);
    }
    return { params, xArr };
  }

  private nextPoint(): number[] {
    let bestX: number[] = [];
    let bestAcq = -Infinity;
    for (let i = 0; i < this.nCandidates; i++) {
      const { xArr } = this.randomSample();
      const { mean, variance } = this.gp.predict([xArr]);
      let acqVal: number;
      if (this.acquisition === 'ei') {
        acqVal = expectedImprovement(
          mean,
          variance,
          this.max?.target ?? 0,
          this.xi
        )[0];
      } else {
        acqVal = upperConfidenceBound(mean, variance, this.kappa)[0];
      }
      if (acqVal > bestAcq) {
        bestAcq = acqVal;
        bestX = xArr;
      }
    }
    return bestX;
  }

  private paramsToArray(params: Record<string, number>): number[] {
    return Object.keys(this.pbounds).map(key => params[key]);
  }

  private arrayToParams(xArr: number[]): Record<string, number> {
    const params: Record<string, number> = {};
    const keys = Object.keys(this.pbounds);
    keys.forEach((key, idx) => {
      params[key] = xArr[idx];
    });
    return params;
  }
} 