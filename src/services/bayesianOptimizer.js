// Bayesian Optimization Service
// Uses Gaussian Process for surrogate modeling and Expected Improvement for acquisition

import gaussian from 'gaussian';
import { create, all } from 'mathjs';

const math = create(all);

export default class BayesianOptimizer {
  constructor(parameters, options = {}) {
    this.parameters = parameters;
    this.options = {
      kernelType: 'rbf', // Radial Basis Function kernel
      acquisitionFunction: 'ei', // Expected Improvement
      explorationWeight: 0.1,
      ...options
    };
    
    // hyperparameters for true GP surrogate
    this.lengthScale = this.options.lengthScale || 1;
    this.signalVariance = this.options.signalVariance || 1;
    this.noiseVariance = this.options.noiseVariance || 1e-6;
    this.observations = [];
    this.bestObservation = null;
    this.iteration = 0;
  }

  // Initialize with random samples
  async getInitialSamples(count = 5) {
    const samples = [];
    for (let i = 0; i < count; i++) {
      samples.push(this.getRandomSample());
    }
    return samples;
  }

  // Get random sample within parameter bounds
  getRandomSample() {
    const sample = {};
    
    for (const param of this.parameters) {
      if (param.type === 'number') {
        const isFloat = param.min % 1 !== 0 || param.max % 1 !== 0;
        const precision = isFloat ? 0.01 : 1;
        const range = param.max - param.min;
        const steps = Math.floor(range / precision) + 1;
        const randomStep = Math.floor(Math.random() * steps);
        const value = param.min + (randomStep * precision);
        sample[param.name] = isFloat ? Math.round(value * 100) / 100 : Math.round(value);
      } else if (param.type === 'checkbox') {
        sample[param.name] = Math.random() > 0.5;
      } else if (param.type === 'select' && param.options) {
        const randomIndex = Math.floor(Math.random() * param.options.length);
        sample[param.name] = param.options[randomIndex];
      }
    }
    
    return sample;
  }

  // Add observation to the model
  addObservation(sample, value, isValid = true) {
    const observation = {
      sample,
      value,
      isValid,
      iteration: this.iteration++
    };
    
    this.observations.push(observation);
    
    // Update best observation if valid and better
    if (isValid && (!this.bestObservation || value > this.bestObservation.value)) {
      this.bestObservation = observation;
    }
  }

  // Get next sample using Gaussian Process surrogate and Expected Improvement
  async getNextSample() {
    if (this.observations.length < 5) {
      return this.getRandomSample();
    }
    const validObs = this.observations.filter(o => o.isValid);
    if (validObs.length < 2) {
      return this.getRandomSample();
    }
    const X = validObs.map(o => this.sampleToVector(o.sample));
    const y = validObs.map(o => o.value);
    const n = X.length;

    // Build kernel matrix with noise on diagonal
    const K = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        const k = this.rbfKernel(X[i], X[j]);
        return i === j ? k + this.noiseVariance : k;
      })
    );

    // Invert kernel matrix
    const K_inv = math.inv(K);

    // Precompute alpha = K_inv * y
    const alpha = math.multiply(K_inv, y);

    // Generate candidate samples
    const candidates = Array.from({ length: 100 }, () => this.getRandomSample());

    let bestSample = null;
    let bestEI = -Infinity;

    for (const sample of candidates) {
      const xVec = this.sampleToVector(sample);
      // Compute k_star
      const kStar = X.map(xi => this.rbfKernel(xi, xVec));
      // Predictive mean
      const mu = kStar.reduce((s, ki, idx) => s + ki * alpha[idx], 0);
      // Predictive variance
      const v = math.multiply(K_inv, kStar);
      let varStar = this.rbfKernel(xVec, xVec) - kStar.reduce((s, ki, idx) => s + ki * v[idx], 0);
      varStar = Math.max(varStar, 0);
      const std = Math.sqrt(varStar + this.noiseVariance);

      const currentBest = this.bestObservation?.value || 0;
      const imp = mu - currentBest - this.options.explorationWeight;
      const ei = std === 0
        ? imp
        : imp * this.normalCDF(imp / std) + std * this.normalPDF(imp / std);

      if (ei > bestEI) {
        bestEI = ei;
        bestSample = sample;
      }
    }

    return bestSample || this.getRandomSample();
  }

  // Convert sample to feature vector (with one-hot encoding for categorical)
  sampleToVector(sample) {
    const vector = [];
    
    for (const param of this.parameters) {
      if (param.type === 'number') {
        // Normalize numeric values to [0, 1]
        const normalized = (sample[param.name] - param.min) / (param.max - param.min);
        vector.push(normalized);
      } else if (param.type === 'checkbox') {
        vector.push(sample[param.name] ? 1 : 0);
      } else if (param.type === 'select' && param.options) {
        // One-hot encoding for categorical
        for (const option of param.options) {
          vector.push(sample[param.name] === option ? 1 : 0);
        }
      }
    }
    
    return vector;
  }

  // RBF kernel function for Gaussian Process
  rbfKernel(x, y) {
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
      const d = x[i] - y[i];
      sum += d * d;
    }
    return this.signalVariance * Math.exp(-0.5 * sum / (this.lengthScale * this.lengthScale));
  }

  // Euclidean distance between vectors
  euclideanDistance(a, b) {
    return Math.sqrt(a.reduce((sum, ai, i) => sum + Math.pow(ai - b[i], 2), 0));
  }

  // Normal cumulative distribution function
  normalCDF(x) {
    const distribution = gaussian(0, 1);
    return distribution.cdf(x);
  }

  // Normal probability density function
  normalPDF(x) {
    const distribution = gaussian(0, 1);
    return distribution.pdf(x);
  }

  // Get optimization progress summary
  getProgress() {
    return {
      iteration: this.iteration,
      totalObservations: this.observations.length,
      validObservations: this.observations.filter(o => o.isValid).length,
      bestValue: this.bestObservation?.value,
      bestSample: this.bestObservation?.sample
    };
  }

  // Check if we should stop optimization
  shouldStop(maxIterations) {
    if (this.iteration >= maxIterations) return true;
    
    // Check for convergence (last 10 iterations didn't improve)
    if (this.observations.length > 10) {
      const recentBest = Math.max(...this.observations.slice(-10).map(o => o.isValid ? o.value : -Infinity));
      if (this.bestObservation && recentBest <= this.bestObservation.value) {
        return true;
      }
    }
    
    return false;
  }
} 