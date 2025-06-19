/**
 * Latin Hypercube Sampling (LHS) Implementation for JavaScript
 * Provides better space-filling properties compared to pure random sampling
 */

/**
 * Generate Latin Hypercube Samples
 * @param {number} nSamples - Number of samples to generate
 * @param {Array} parameters - Array of parameter definitions with min/max bounds
 * @param {boolean} center - Whether to center samples in intervals (default: false)
 * @returns {Array} Array of parameter combinations
 */
export function generateLHSSamples(nSamples, parameters, center = false) {
  if (nSamples <= 0 || !parameters || parameters.length === 0) {
    return [];
  }

  const nDimensions = parameters.length;
  const samples = [];

  // Generate base LHS matrix
  const lhsMatrix = generateLHSMatrix(nSamples, nDimensions, center);

  // Convert to parameter space
  for (let i = 0; i < nSamples; i++) {
    const sample = {};
    
    for (let j = 0; j < nDimensions; j++) {
      const param = parameters[j];
      const unitValue = lhsMatrix[i][j];
      
      if (param.type === 'number') {
        if (param.isInteger) {
          sample[param.name] = Math.floor(param.min + unitValue * (param.max - param.min + 1));
        } else {
          sample[param.name] = parseFloat((param.min + unitValue * (param.max - param.min)).toFixed(2));
        }
      } else if (param.type === 'checkbox') {
        sample[param.name] = unitValue > 0.5;
      } else if (param.type === 'select' && param.options) {
        const index = Math.floor(unitValue * param.options.length);
        sample[param.name] = param.options[Math.min(index, param.options.length - 1)];
      }
    }
    
    samples.push(sample);
  }

  return samples;
}

/**
 * Generate basic LHS matrix in [0,1]^d
 * @param {number} nSamples - Number of samples
 * @param {number} nDimensions - Number of dimensions
 * @param {boolean} center - Whether to center samples in intervals
 * @returns {Array} 2D array of LHS samples
 */
function generateLHSMatrix(nSamples, nDimensions, center = false) {
  const matrix = [];
  
  // Generate stratified samples for each dimension
  for (let i = 0; i < nSamples; i++) {
    const sample = [];
    
    for (let j = 0; j < nDimensions; j++) {
      let value;
      
      if (center) {
        // Center samples within intervals
        value = (i + 0.5) / nSamples;
      } else {
        // Random position within interval
        value = (i + Math.random()) / nSamples;
      }
      
      sample.push(value);
    }
    
    matrix.push(sample);
  }
  
  // Randomly permute each dimension to create Latin Hypercube
  for (let j = 0; j < nDimensions; j++) {
    const column = matrix.map(row => row[j]);
    const shuffled = shuffleArray([...column]);
    
    for (let i = 0; i < nSamples; i++) {
      matrix[i][j] = shuffled[i];
    }
  }
  
  return matrix;
}

/**
 * Enhanced LHS with optimization for better space-filling properties
 * @param {number} nSamples - Number of samples to generate
 * @param {Array} parameters - Array of parameter definitions
 * @param {Object} options - Options for optimization
 * @returns {Array} Optimized LHS samples
 */
export function generateOptimizedLHS(nSamples, parameters, options = {}) {
  const {
    iterations = 100,
    criterion = 'maximin',
    center = false
  } = options;

  let bestSamples = generateLHSSamples(nSamples, parameters, center);
  let bestScore = evaluateLHSQuality(bestSamples, parameters, criterion);

  // Optimize through iterative improvement
  for (let iter = 0; iter < iterations; iter++) {
    const candidateSamples = generateLHSSamples(nSamples, parameters, center);
    const score = evaluateLHSQuality(candidateSamples, parameters, criterion);
    
    if (score > bestScore) {
      bestSamples = candidateSamples;
      bestScore = score;
    }
  }

  return bestSamples;
}

/**
 * Evaluate the quality of LHS samples
 * @param {Array} samples - Array of parameter combinations
 * @param {Array} parameters - Parameter definitions
 * @param {string} criterion - Quality criterion ('maximin', 'correlation')
 * @returns {number} Quality score (higher is better)
 */
function evaluateLHSQuality(samples, parameters, criterion = 'maximin') {
  if (samples.length < 2) return 0;

  if (criterion === 'maximin') {
    return calculateMaximinScore(samples, parameters);
  } else if (criterion === 'correlation') {
    return -calculateMaxCorrelation(samples, parameters); // Negative because we want to minimize
  }
  
  return 0;
}

/**
 * Calculate maximin score (minimum distance between any two points)
 * @param {Array} samples - LHS samples
 * @param {Array} parameters - Parameter definitions
 * @returns {number} Maximin score
 */
function calculateMaximinScore(samples, parameters) {
  let minDistance = Infinity;
  
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const distance = calculateNormalizedDistance(samples[i], samples[j], parameters);
      minDistance = Math.min(minDistance, distance);
    }
  }
  
  return minDistance;
}

/**
 * Calculate maximum correlation between dimensions
 * @param {Array} samples - LHS samples
 * @param {Array} parameters - Parameter definitions
 * @returns {number} Maximum correlation coefficient
 */
function calculateMaxCorrelation(samples, parameters) {
  const numericParams = parameters.filter(p => p.type === 'number');
  if (numericParams.length < 2) return 0;

  let maxCorr = 0;
  
  for (let i = 0; i < numericParams.length; i++) {
    for (let j = i + 1; j < numericParams.length; j++) {
      const param1 = numericParams[i].name;
      const param2 = numericParams[j].name;
      
      const values1 = samples.map(s => s[param1]);
      const values2 = samples.map(s => s[param2]);
      
      const correlation = Math.abs(calculateCorrelation(values1, values2));
      maxCorr = Math.max(maxCorr, correlation);
    }
  }
  
  return maxCorr;
}

/**
 * Calculate normalized Euclidean distance between two samples
 * @param {Object} sample1 - First sample
 * @param {Object} sample2 - Second sample
 * @param {Array} parameters - Parameter definitions for normalization
 * @returns {number} Normalized distance
 */
function calculateNormalizedDistance(sample1, sample2, parameters) {
  let sumSquares = 0;
  let numDimensions = 0;
  
  for (const param of parameters) {
    if (param.type === 'number') {
      const val1 = sample1[param.name];
      const val2 = sample2[param.name];
      const range = param.max - param.min;
      
      if (range > 0) {
        const normalizedDiff = (val1 - val2) / range;
        sumSquares += normalizedDiff * normalizedDiff;
        numDimensions++;
      }
    }
  }
  
  return numDimensions > 0 ? Math.sqrt(sumSquares / numDimensions) : 0;
}

/**
 * Calculate Pearson correlation coefficient
 * @param {Array} x - First variable values
 * @param {Array} y - Second variable values
 * @returns {number} Correlation coefficient
 */
function calculateCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return 0;
  
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const deltaX = x[i] - meanX;
    const deltaY = y[i] - meanY;
    
    numerator += deltaX * deltaY;
    denomX += deltaX * deltaX;
    denomY += deltaY * deltaY;
  }
  
  const denominator = Math.sqrt(denomX * denomY);
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Fisher-Yates shuffle algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Generate comparison between LHS and random sampling
 * @param {number} nSamples - Number of samples
 * @param {Array} parameters - Parameter definitions
 * @returns {Object} Comparison results
 */
export function compareSamplingMethods(nSamples, parameters) {
  // Generate random samples
  const randomSamples = [];
  for (let i = 0; i < nSamples; i++) {
    const sample = {};
    for (const param of parameters) {
      if (param.type === 'number') {
        if (param.isInteger) {
          sample[param.name] = Math.floor(param.min + Math.random() * (param.max - param.min + 1));
        } else {
          sample[param.name] = parseFloat((param.min + Math.random() * (param.max - param.min)).toFixed(2));
        }
      } else if (param.type === 'checkbox') {
        sample[param.name] = Math.random() > 0.5;
      } else if (param.type === 'select' && param.options) {
        sample[param.name] = param.options[Math.floor(Math.random() * param.options.length)];
      }
    }
    randomSamples.push(sample);
  }
  
  // Generate LHS samples
  const lhsSamples = generateLHSSamples(nSamples, parameters);
  
  // Generate optimized LHS samples
  const optimizedLHS = generateOptimizedLHS(nSamples, parameters, { iterations: 50 });
  
  // Evaluate quality
  return {
    random: {
      samples: randomSamples,
      maximin: calculateMaximinScore(randomSamples, parameters),
      correlation: calculateMaxCorrelation(randomSamples, parameters)
    },
    lhs: {
      samples: lhsSamples,
      maximin: calculateMaximinScore(lhsSamples, parameters),
      correlation: calculateMaxCorrelation(lhsSamples, parameters)
    },
    optimizedLHS: {
      samples: optimizedLHS,
      maximin: calculateMaximinScore(optimizedLHS, parameters),
      correlation: calculateMaxCorrelation(optimizedLHS, parameters)
    }
  };
} 