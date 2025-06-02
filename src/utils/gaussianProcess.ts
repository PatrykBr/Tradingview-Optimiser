import { Matrix, inverse } from 'ml-matrix';

export interface KernelOptions {
  lengthScale: number;
  variance: number;
}

export class GaussianProcess {
  private X: number[][];
  private y: number[];
  private kernelOptions: KernelOptions;
  private noise: number;
  private K_inv!: Matrix;

  constructor(kernelOptions: KernelOptions, noise = 1e-6) {
    this.kernelOptions = kernelOptions;
    this.noise = noise;
  }

  private kernel(x1: number[], x2: number[]): number {
    const { lengthScale, variance } = this.kernelOptions;
    let sum = 0;
    for (let i = 0; i < x1.length; i++) {
      const d = (x1[i] - x2[i]) / lengthScale;
      sum += d * d;
    }
    return variance * Math.exp(-0.5 * sum);
  }

  public fit(X: number[][], y: number[]): void {
    this.X = X;
    this.y = y;
    const n = X.length;
    const K = Matrix.zeros(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        K.set(i, j, this.kernel(X[i], X[j]));
      }
      K.set(i, i, K.get(i, i) + this.noise);
    }
    this.K_inv = inverse(K);
  }

  public predict(X_pred: number[][]): { mean: number[]; variance: number[] } {
    const n = this.X.length;
    const m = X_pred.length;
    const K_star = Matrix.zeros(n, m);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        K_star.set(i, j, this.kernel(this.X[i], X_pred[j]));
      }
    }
    const yVec = Matrix.columnVector(this.y);
    const tmp = this.K_inv.mmul(yVec);
    const mean: number[] = [];
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += K_star.get(i, j) * tmp.get(i, 0);
      }
      mean.push(sum);
    }
    const variance: number[] = [];
    for (let j = 0; j < m; j++) {
      const k_ss = this.kernel(X_pred[j], X_pred[j]) + this.noise;
      const k_star_col = K_star.getColumn(j);
      const v = this.K_inv.mmul(Matrix.columnVector(k_star_col));
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += K_star.get(i, j) * v.get(i, 0);
      }
      variance.push(Math.max(k_ss - sum, 0));
    }
    return { mean, variance };
  }
} 