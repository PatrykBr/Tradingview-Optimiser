#!/usr/bin/env python3
"""
TradingView Strategy Optimizer Server
Bayesian Optimization Backend for Browser Extension

This server provides Bayesian optimization capabilities for the TradingView Strategy Optimizer extension.
It uses the bayesian-optimization Python library to intelligently search for optimal parameter combinations.
"""

import json
import logging
import time
from typing import Dict, List, Any, Optional, Tuple
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from bayes_opt import BayesianOptimization, UtilityFunction
from scipy.stats import qmc
from dataclasses import dataclass, asdict
from threading import Lock
import uuid

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for browser extension

# Global state management
optimization_sessions = {}
session_lock = Lock()

# Configuration constants for optimization tuning
OPTIMIZATION_CONFIG = {
    # Acquisition function settings - IMPROVED based on results analysis
    'acquisition_type': 'ei',  # Changed from 'ucb' - EI is better for profit factor optimization
    'initial_kappa': 2.5,       # Reduced from 3.0 - your results show good convergence with less exploration
    'kappa_decay': 0.92,        # Faster decay from 0.95 - exploit good regions more aggressively  
    'kappa_min': 0.5,           # Lower minimum from 1.0 - allow more exploitation
    'kappa_max': 4.0,           # Reduced from 5.0 - prevent excessive exploration
    'xi': 0.05,                 # Increased from 0.02 - better for profit factor with EI
    
    # LHS sampling settings - ENHANCED for better initial coverage
    'lhs_ratio': 3.5,           # Use ~28% of iterations for initial sampling
    'lhs_max_samples': 100,     # Maximum initial samples regardless of iterations
    'lhs_min_samples': 20,      # Minimum initial samples for small runs
    'lhs_candidates': 10,       # Number of LHS designs to try for optimal coverage
    'use_sobol': True,          # Use Sobol sequence instead of LHS for better coverage
    
    # Convergence detection - SMARTER based on your results
    'convergence_window': 20,   # Increased for 200-iteration runs
    'improvement_threshold': 0.002,  # More sensitive for profit factor
    'early_stopping': True,     # Enable but only after sufficient iterations
    'early_stop_min_iterations': 50,  # Don't stop before this many iterations
    'plateau_detection': True,  # NEW: Detect when we're stuck in local optima
    'plateau_window': 10,       # Increased for profit factor optimization
    
    # Advanced settings - ENHANCED GP performance
    'random_seed': 42,          
    'gaussian_process_alpha': 1e-6,  # Optimized for profit factor's typical noise level
    'n_restarts_optimizer': 10, # Increased for better GP hyperparameter optimization
    'gp_kernel_bounds': (1e-3, 1e3),  # Better kernel parameter bounds
    
    # NEW: Multi-objective support (in case you want to optimize multiple metrics)
    'multi_objective': False,    # Disabled - focusing purely on profit factor
    'secondary_metrics': [],     # Not used for single-objective
    'metric_weights': {},        # Not used for single-objective
    
    # NEW: Adaptive parameter bounds (narrow search space as we learn)
    'adaptive_bounds': True,
    'bounds_shrink_factor': 0.8,  # How much to shrink bounds around good regions
    'bounds_update_threshold': 0.7,  # Only shrink if this fraction of top results are in narrower region
    
    # Metric-specific optimizations
    'metric_transforms': {
        'profitFactor': {
            'log_transform': True,
            'outlier_threshold': 100  # Very high - only for numerical stability
        },
        'sharpeRatio': {
            'log_transform': False,
            'outlier_threshold': 20   # Sharpe > 20 is likely a calculation error
        },
        'winRate': {
            'log_transform': False,
            'outlier_threshold': None  # No cap - already bounded 0-100
        },
        'netProfit': {
            'log_transform': False,
            'outlier_threshold': None  # No cap on net profit
        },
        'maxDrawdown': {
            'log_transform': False,
            'outlier_threshold': None,
            'negate': True  # Since we minimize drawdown by maximizing -drawdown
        },
        'percentProfitable': {
            'log_transform': False,
            'outlier_threshold': None  # Already bounded 0-100
        }
    }
}

@dataclass
class Parameter:
    """Represents a strategy parameter for optimization"""
    name: str
    type: str  # 'number', 'checkbox', 'select'
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    options: Optional[List[str]] = None
    is_integer: bool = False
    
    def to_bounds_dict(self) -> Dict[str, Tuple[float, float]]:
        """Convert parameter to bounds dictionary for BayesianOptimization"""
        if self.type == 'number':
            return {self.name: (self.min_val, self.max_val)}
        elif self.type == 'checkbox':
            return {self.name: (0, 1)}
        elif self.type == 'select' and self.options:
            return {self.name: (0, len(self.options) - 1)}
        return {}

@dataclass
class Filter:
    """Represents a filter constraint on metrics"""
    metric: str
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    
    def applies_to(self, metric_value: float) -> bool:
        """Check if the metric value passes this filter"""
        if self.min_val is not None and metric_value < self.min_val:
            return False
        if self.max_val is not None and metric_value > self.max_val:
            return False
        return True

class OptimizationSession:
    """Manages a single Bayesian optimization session"""
    
    def __init__(self, session_id: str, parameters: List[Parameter], target_metric: str, 
                 filters: List[Filter], max_iterations: int = 100, use_sobol: bool = True):
        self.session_id = session_id
        self.parameters = parameters
        self.target_metric = target_metric
        self.filters = filters
        self.max_iterations = max_iterations
        self.use_sobol = use_sobol  # Store sampling method preference
        
        # Build parameter bounds for Bayesian optimization
        self.pbounds = {}
        self.categorical_mappings = {}
        
        for param in parameters:
            bounds = param.to_bounds_dict()
            self.pbounds.update(bounds)
            
            # Store categorical mappings for later conversion
            if param.type == 'select' and param.options:
                self.categorical_mappings[param.name] = param.options
        
        # Initialize Bayesian optimizer with enhanced GP settings
        self.optimizer = BayesianOptimization(
            f=None,  # We don't provide the function directly
            pbounds=self.pbounds,
            verbose=0,
            random_state=OPTIMIZATION_CONFIG['random_seed'],
            allow_duplicate_points=True
        )
        
        # Enhanced GP configuration for better performance
        self._configure_gaussian_process()
        
        # Initialize utility function with configurable parameters
        self.utility = UtilityFunction(
            kind=OPTIMIZATION_CONFIG['acquisition_type'], 
            kappa=OPTIMIZATION_CONFIG['initial_kappa'], 
            xi=OPTIMIZATION_CONFIG['xi']
        )
        
        # Generate optimized LHS samples using configuration
        lhs_samples = max(
            OPTIMIZATION_CONFIG['lhs_min_samples'],
            min(
                OPTIMIZATION_CONFIG['lhs_max_samples'], 
                int(max_iterations / OPTIMIZATION_CONFIG['lhs_ratio'])
            )
        )
        self.initial_samples = self._generate_lhs_samples(n_samples=lhs_samples)
        self.initial_sample_index = 0
        
        # Enhanced tracking with configurable convergence detection
        self.iteration_count = 0
        self.best_result = None
        self.all_results = []
        self.filtered_results = []
        self.convergence_window = OPTIMIZATION_CONFIG['convergence_window']
        self.improvement_threshold = OPTIMIZATION_CONFIG['improvement_threshold']
        
        # NEW: Adaptive bounds tracking
        self.original_bounds = self.pbounds.copy()
        self.bounds_updated = False
        
        logger.info(f"Created optimization session {session_id} with {len(parameters)} parameters and {len(self.initial_samples)} {'Sobol' if self.use_sobol else 'LHS'} initial samples")
    
    def _configure_gaussian_process(self):
        """Configure the Gaussian Process with enhanced settings"""
        from sklearn.gaussian_process.kernels import Matern, ConstantKernel as C
        
        # Enhanced GP configuration for better performance
        if hasattr(self.optimizer, '_gp'):
            self.optimizer._gp.alpha = OPTIMIZATION_CONFIG['gaussian_process_alpha']
            self.optimizer._gp.n_restarts_optimizer = OPTIMIZATION_CONFIG['n_restarts_optimizer']
            
            # Set better kernel if possible
            try:
                # Matern kernel with nu=2.5 is good for optimization
                kernel = C(1.0, OPTIMIZATION_CONFIG['gp_kernel_bounds']) * Matern(
                    length_scale=1.0, 
                    length_scale_bounds=OPTIMIZATION_CONFIG['gp_kernel_bounds'],
                    nu=2.5
                )
                self.optimizer._gp.kernel = kernel
                logger.info("Enhanced GP kernel configuration applied")
            except Exception as e:
                logger.warning(f"Could not set enhanced kernel: {e}")
    
    def suggest_next_parameters(self) -> Dict[str, Any]:
        """Suggest the next set of parameters to test"""
        if self.iteration_count >= self.max_iterations:
            return None
        
        # Check for early convergence if enabled and we've done enough iterations
        if (OPTIMIZATION_CONFIG['early_stopping'] and 
            self.iteration_count >= OPTIMIZATION_CONFIG['early_stop_min_iterations'] and 
            self._check_convergence()):
            logger.info(f"Session {self.session_id}: Early convergence detected after {self.iteration_count} iterations")
            return None
        
        # Use LHS samples for initial exploration, then switch to Bayesian optimization
        if self.initial_sample_index < len(self.initial_samples):
            raw_suggestion = self.initial_samples[self.initial_sample_index]
            self.initial_sample_index += 1
            source = "LHS"
        else:
            # Update acquisition function adaptively
            self._update_acquisition_function()
            
            # Update adaptive bounds if enabled
            self._update_adaptive_bounds()
            
            # Get suggestion from Bayesian optimizer
            raw_suggestion = self.optimizer.suggest(self.utility)
            source = "Bayesian"
        
        # Convert raw suggestion to proper parameter values
        suggestion = self._convert_raw_params(raw_suggestion)
        
        logger.info(f"Session {self.session_id}: Suggested parameters for iteration {self.iteration_count + 1} (source: {source})")
        return suggestion
    
    def register_result(self, parameters: Dict[str, Any], metrics: Dict[str, float]) -> Dict[str, Any]:
        """Register the result of testing a parameter combination"""
        target_value = metrics.get(self.target_metric)
        if target_value is None:
            raise ValueError(f"Target metric '{self.target_metric}' not found in results")
        
        # Apply metric-specific transformations if configured
        optimization_target = target_value
        metric_config = OPTIMIZATION_CONFIG['metric_transforms'].get(self.target_metric, {})
        
        if metric_config:
            # Handle metrics that need to be minimized (e.g., drawdown)
            if metric_config.get('negate'):
                optimization_target = -target_value
            
            # Handle edge cases based on metric type
            if optimization_target <= 0 and metric_config.get('log_transform'):
                optimization_target = 0.01  # Small positive value for log transform
            elif 'outlier_threshold' in metric_config and metric_config['outlier_threshold'] is not None:
                if optimization_target > metric_config['outlier_threshold']:
                    # Cap extreme values to avoid GP issues
                    optimization_target = metric_config['outlier_threshold']
            elif metric_config.get('log_transform') and optimization_target > 0:
                # Log transform for better GP modeling
                optimization_target = np.log(optimization_target + 1)  # +1 to handle values near 0
        
        # Apply filters to determine if result is valid
        is_valid = self._apply_filters(metrics)
        
        # Convert parameters back to raw format for Bayesian optimizer
        raw_params = self._convert_to_raw_params(parameters)
        
        # Only register valid results with the Bayesian optimizer
        if is_valid:
            self.optimizer.register(params=raw_params, target=optimization_target)
            
            # Update best result if this is better
            if self.best_result is None or target_value > self.best_result.get('target_value', 0.0):
                self.best_result = {
                    'parameters': parameters.copy(),
                    'metrics': metrics.copy(),
                    'target_value': target_value,
                    'iteration': self.iteration_count + 1
                }
        else:
            self.filtered_results.append({
                'parameters': parameters.copy(),
                'metrics': metrics.copy(),
                'target_value': target_value,
                'iteration': self.iteration_count + 1,
                'filtered_reason': self._get_filter_failure_reason(metrics)
            })
        
        # Store all results for logging
        result_entry = {
            'parameters': parameters.copy(),
            'metrics': metrics.copy(),
            'target_value': target_value,
            'iteration': self.iteration_count + 1,
            'is_valid': is_valid,
            'timestamp': time.time()
        }
        self.all_results.append(result_entry)
        
        self.iteration_count += 1
        
        logger.info(f"Session {self.session_id}: Registered result for iteration {self.iteration_count} "
                   f"(valid: {is_valid}, target: {target_value:.4f})")
        
        return {
            'is_valid': is_valid,
            'is_best': is_valid and (self.best_result and 
                                   self.best_result['iteration'] == self.iteration_count),
            'iteration': self.iteration_count,
            'total_valid_results': len([r for r in self.all_results if r['is_valid']]),
            'total_filtered_results': len(self.filtered_results)
        }
    
    def _convert_raw_params(self, raw_params: Dict[str, float]) -> Dict[str, Any]:
        """Convert raw Bayesian optimizer parameters to actual parameter values"""
        result = {}
        
        for param in self.parameters:
            raw_value = raw_params[param.name]
            
            if param.type == 'number':
                if param.is_integer:
                    result[param.name] = int(round(raw_value))
                else:
                    result[param.name] = round(raw_value, 2)
            elif param.type == 'checkbox':
                result[param.name] = raw_value > 0.5
            elif param.type == 'select':
                index = int(round(raw_value))
                index = max(0, min(index, len(param.options) - 1))  # Clamp to valid range
                result[param.name] = param.options[index]
        
        return result
    
    def _convert_to_raw_params(self, params: Dict[str, Any]) -> Dict[str, float]:
        """Convert actual parameter values back to raw format for Bayesian optimizer"""
        result = {}
        
        for param in self.parameters:
            value = params[param.name]
            
            if param.type == 'number':
                result[param.name] = float(value)
            elif param.type == 'checkbox':
                result[param.name] = 1.0 if value else 0.0
            elif param.type == 'select':
                if value in param.options:
                    result[param.name] = float(param.options.index(value))
                else:
                    result[param.name] = 0.0  # Fallback
        
        return result
    
    def _apply_filters(self, metrics: Dict[str, float]) -> bool:
        """Apply all filters to determine if result is valid"""
        for filter_obj in self.filters:
            metric_value = metrics.get(filter_obj.metric)
            if metric_value is not None and not filter_obj.applies_to(metric_value):
                return False
        return True
    
    def _get_filter_failure_reason(self, metrics: Dict[str, float]) -> str:
        """Get human-readable reason why filters failed"""
        failed_filters = []
        for filter_obj in self.filters:
            metric_value = metrics.get(filter_obj.metric)
            if metric_value is not None and not filter_obj.applies_to(metric_value):
                reason = f"{filter_obj.metric}={metric_value:.4f}"
                if filter_obj.min_val is not None:
                    reason += f" < {filter_obj.min_val}"
                if filter_obj.max_val is not None:
                    reason += f" > {filter_obj.max_val}"
                failed_filters.append(reason)
        return "; ".join(failed_filters)
    
    def _generate_lhs_samples(self, n_samples: int) -> List[Dict[str, float]]:
        """Generate optimized Latin Hypercube Samples or Sobol sequence for initial exploration"""
        if not self.pbounds or n_samples <= 0:
            return []
        
        # Get parameter names and bounds
        param_names = list(self.pbounds.keys())
        n_params = len(param_names)
        
        if n_params == 0:
            return []
        
        # Use Sobol sequence if enabled for better coverage
        if self.use_sobol:
            return self._generate_sobol_samples(n_samples, param_names)
        
        # Generate multiple LHS candidates and select the best one based on space-filling criteria
        best_samples = None
        best_score = -float('inf')
        
        for attempt in range(OPTIMIZATION_CONFIG['lhs_candidates']):  # Try multiple LHS designs
            # Generate LHS samples using scipy with enhanced optimization
            sampler = qmc.LatinHypercube(d=n_params, scramble=True, optimization="random-cd", seed=OPTIMIZATION_CONFIG['random_seed'] + attempt)
            lhs_samples = sampler.random(n=n_samples)
            
            # Calculate space-filling quality (minimum distance between points)
            min_distances = []
            for i in range(len(lhs_samples)):
                distances = []
                for j in range(len(lhs_samples)):
                    if i != j:
                        dist = np.linalg.norm(lhs_samples[i] - lhs_samples[j])
                        distances.append(dist)
                min_distances.append(min(distances))
            
            # Score is the minimum of all minimum distances (maximin criterion)
            score = min(min_distances) if min_distances else 0
            
            if score > best_score:
                best_score = score
                best_samples = lhs_samples
        
        # Scale samples to parameter bounds
        scaled_samples = []
        for sample in best_samples:
            scaled_sample = {}
            for i, param_name in enumerate(param_names):
                min_val, max_val = self.pbounds[param_name]
                scaled_value = min_val + sample[i] * (max_val - min_val)
                scaled_sample[param_name] = scaled_value
            scaled_samples.append(scaled_sample)
        
        logger.info(f"Generated {len(scaled_samples)} optimized LHS samples (score: {best_score:.4f}) for initial exploration")
        return scaled_samples
    
    def _generate_sobol_samples(self, n_samples: int, param_names: List[str]) -> List[Dict[str, float]]:
        """Generate Sobol sequence samples for better space coverage than LHS"""
        n_params = len(param_names)
        
        # Generate Sobol sequence
        sampler = qmc.Sobol(d=n_params, scramble=True, seed=OPTIMIZATION_CONFIG['random_seed'])
        sobol_samples = sampler.random(n=n_samples)
        
        # Scale samples to parameter bounds
        scaled_samples = []
        for sample in sobol_samples:
            scaled_sample = {}
            for i, param_name in enumerate(param_names):
                min_val, max_val = self.pbounds[param_name]
                scaled_value = min_val + sample[i] * (max_val - min_val)
                scaled_sample[param_name] = scaled_value
            scaled_samples.append(scaled_sample)
        
        logger.info(f"Generated {len(scaled_samples)} Sobol sequence samples for superior initial exploration")
        return scaled_samples
    
    def get_status(self) -> Dict[str, Any]:
        """Get current optimization status"""
        return {
            'session_id': self.session_id,
            'iteration_count': self.iteration_count,
            'max_iterations': self.max_iterations,
            'total_results': len(self.all_results),
            'valid_results': len([r for r in self.all_results if r['is_valid']]),
            'filtered_results': len(self.filtered_results),
            'best_result': self.best_result,
            'is_complete': self.iteration_count >= self.max_iterations,
            'parameters_count': len(self.parameters),
            'filters_count': len(self.filters),
            'lhs_samples_used': self.initial_sample_index,
            'lhs_samples_total': len(self.initial_samples),
            'optimization_phase': 'LHS' if self.initial_sample_index < len(self.initial_samples) else 'Bayesian'
        }

    def _update_acquisition_function(self):
        """Adaptively adjust acquisition function parameters based on progress"""
        if len(self.all_results) < 5:
            return  # Not enough data yet
        
        # Calculate recent improvement rate
        valid_results = [r for r in self.all_results if r['is_valid']]
        if len(valid_results) < 3:
            return
        
        recent_results = valid_results[-self.convergence_window:]
        if len(recent_results) >= 3:
            recent_values = [r['target_value'] for r in recent_results]
            improvement_rate = (max(recent_values) - min(recent_values)) / len(recent_values)
            
            # Adjust kappa based on improvement rate using configuration
            if improvement_rate < self.improvement_threshold:
                # Increase exploration if we're not improving much
                new_kappa = min(OPTIMIZATION_CONFIG['kappa_max'], self.utility.kappa * 1.1)
            else:
                # Increase exploitation if we're finding good areas
                new_kappa = max(OPTIMIZATION_CONFIG['kappa_min'], self.utility.kappa * OPTIMIZATION_CONFIG['kappa_decay'])
            
            self.utility = UtilityFunction(
                kind=OPTIMIZATION_CONFIG['acquisition_type'], 
                kappa=new_kappa, 
                xi=OPTIMIZATION_CONFIG['xi']
            )
            logger.info(f"Adapted acquisition function: kappa={new_kappa:.2f}, improvement_rate={improvement_rate:.4f}")

    def _update_adaptive_bounds(self):
        """Adaptively shrink parameter bounds around high-performing regions"""
        if not OPTIMIZATION_CONFIG['adaptive_bounds'] or self.bounds_updated:
            return
        
        valid_results = [r for r in self.all_results if r['is_valid']]
        if len(valid_results) < 20:  # Need sufficient data
            return
        
        # Get top performing results
        top_results = sorted(valid_results, key=lambda x: x['target_value'], reverse=True)
        top_fraction = int(len(top_results) * OPTIMIZATION_CONFIG['bounds_update_threshold'])
        top_performers = top_results[:max(5, top_fraction)]
        
        new_bounds = {}
        bounds_changed = False
        
        for param_name, (orig_min, orig_max) in self.original_bounds.items():
            # Get parameter values from top performers
            param_values = []
            for result in top_performers:
                raw_params = self._convert_to_raw_params(result['parameters'])
                if param_name in raw_params:
                    param_values.append(raw_params[param_name])
            
            if len(param_values) >= 3:  # Need sufficient samples
                param_min, param_max = min(param_values), max(param_values)
                param_range = param_max - param_min
                
                # Expand slightly around the observed range
                buffer = param_range * (1 - OPTIMIZATION_CONFIG['bounds_shrink_factor']) / 2
                new_min = max(orig_min, param_min - buffer)
                new_max = min(orig_max, param_max + buffer)
                
                # Only update if bounds are meaningfully narrower
                if (new_max - new_min) < 0.8 * (orig_max - orig_min):
                    new_bounds[param_name] = (new_min, new_max)
                    bounds_changed = True
                else:
                    new_bounds[param_name] = (orig_min, orig_max)
            else:
                new_bounds[param_name] = (orig_min, orig_max)
        
        if bounds_changed:
            self.pbounds = new_bounds
            self.bounds_updated = True
            logger.info(f"Updated parameter bounds based on top performers: {new_bounds}")

    def _check_convergence(self) -> bool:
        """Enhanced convergence detection with plateau detection"""
        valid_results = [r for r in self.all_results if r['is_valid']]
        if len(valid_results) < self.convergence_window:
            return False
        
        recent_values = [r['target_value'] for r in valid_results[-self.convergence_window:]]
        improvement = max(recent_values) - min(recent_values)
        
        # Traditional convergence check
        if improvement < self.improvement_threshold:
            return True
        
        # NEW: Plateau detection - check if we're stuck in local optimum
        if OPTIMIZATION_CONFIG['plateau_detection'] and len(valid_results) >= OPTIMIZATION_CONFIG['plateau_window']:
            plateau_values = [r['target_value'] for r in valid_results[-OPTIMIZATION_CONFIG['plateau_window']:]]
            plateau_improvement = max(plateau_values) - min(plateau_values)
            
            # If we're on a plateau, increase exploration
            if plateau_improvement < self.improvement_threshold * 0.5:
                logger.info(f"Plateau detected, increasing exploration")
                self.utility.kappa = min(OPTIMIZATION_CONFIG['kappa_max'], self.utility.kappa * 1.2)
                return False  # Don't converge yet, let increased exploration work
        
        return False

# API Endpoints

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'message': 'Bayesian Optimization Server is running'})

@app.route('/start_optimization', methods=['POST'])
def start_optimization():
    """Start a new Bayesian optimization session"""
    try:
        data = request.json
        
        # Parse parameters
        parameters = []
        for param_data in data.get('parameters', []):
            param = Parameter(
                name=param_data['name'],
                type=param_data['type'],
                min_val=param_data.get('min_val'),
                max_val=param_data.get('max_val'),
                options=param_data.get('options'),
                is_integer=param_data.get('is_integer', False)
            )
            parameters.append(param)
        
        # Parse filters
        filters = []
        for filter_data in data.get('filters', []):
            filter_obj = Filter(
                metric=filter_data['metric'],
                min_val=filter_data.get('min_val'),
                max_val=filter_data.get('max_val')
            )
            filters.append(filter_obj)
        
        # Create new session
        session_id = str(uuid.uuid4())
        target_metric = data.get('target_metric', 'netProfit')
        max_iterations = data.get('max_iterations', 100)
        use_sobol = data.get('use_sobol', True)  # Get use_sobol from request
        
        session = OptimizationSession(
            session_id=session_id,
            parameters=parameters,
            target_metric=target_metric,
            filters=filters,
            max_iterations=max_iterations,
            use_sobol=use_sobol
        )
        
        with session_lock:
            optimization_sessions[session_id] = session
        
        logger.info(f"Started optimization session {session_id} with {len(parameters)} parameters using {'Sobol' if use_sobol else 'LHS'} sampling")
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'message': f'Optimization session started with {len(parameters)} parameters using {"Sobol" if use_sobol else "LHS"} sampling'
        })
        
    except Exception as e:
        logger.error(f"Error starting optimization: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/suggest_parameters', methods=['POST'])
def suggest_parameters():
    """Get next parameter suggestion from Bayesian optimizer"""
    try:
        data = request.json
        session_id = data.get('session_id')
        
        if not session_id or session_id not in optimization_sessions:
            return jsonify({'success': False, 'error': 'Invalid session ID'}), 400
        
        session = optimization_sessions[session_id]
        suggestion = session.suggest_next_parameters()
        
        if suggestion is None:
            return jsonify({
                'success': True,
                'parameters': None,
                'message': 'Optimization complete - maximum iterations reached'
            })
        
        return jsonify({
            'success': True,
            'parameters': suggestion,
            'iteration': session.iteration_count + 1,
            'max_iterations': session.max_iterations
        })
        
    except Exception as e:
        logger.error(f"Error suggesting parameters: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/register_result', methods=['POST'])
def register_result():
    """Register the result of testing a parameter combination"""
    try:
        data = request.json
        session_id = data.get('session_id')
        parameters = data.get('parameters')
        metrics = data.get('metrics')
        
        if not session_id or session_id not in optimization_sessions:
            return jsonify({'success': False, 'error': 'Invalid session ID'}), 400
        
        if not parameters or not metrics:
            return jsonify({'success': False, 'error': 'Parameters and metrics are required'}), 400
        
        session = optimization_sessions[session_id]
        result_info = session.register_result(parameters, metrics)
        
        return jsonify({
            'success': True,
            'result_info': result_info,
            'session_status': session.get_status()
        })
        
    except Exception as e:
        logger.error(f"Error registering result: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/get_session_status', methods=['POST'])
def get_session_status():
    """Get current status of an optimization session"""
    try:
        data = request.json
        session_id = data.get('session_id')
        
        if not session_id or session_id not in optimization_sessions:
            return jsonify({'success': False, 'error': 'Invalid session ID'}), 400
        
        session = optimization_sessions[session_id]
        status = session.get_status()
        
        return jsonify({
            'success': True,
            'status': status
        })
        
    except Exception as e:
        logger.error(f"Error getting session status: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/stop_optimization', methods=['POST'])
def stop_optimization():
    """Stop and clean up an optimization session"""
    try:
        data = request.json
        session_id = data.get('session_id')
        
        if not session_id:
            return jsonify({'success': False, 'error': 'Session ID is required'}), 400
        
        with session_lock:
            if session_id in optimization_sessions:
                session = optimization_sessions[session_id]
                final_status = session.get_status()
                del optimization_sessions[session_id]
                
                logger.info(f"Stopped optimization session {session_id}")
                
                return jsonify({
                    'success': True,
                    'message': 'Optimization session stopped',
                    'final_status': final_status
                })
            else:
                return jsonify({'success': False, 'error': 'Session not found'}), 404
        
    except Exception as e:
        logger.error(f"Error stopping optimization: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 400

@app.route('/list_sessions', methods=['GET'])
def list_sessions():
    """List all active optimization sessions"""
    try:
        with session_lock:
            sessions_info = {}
            for session_id, session in optimization_sessions.items():
                sessions_info[session_id] = session.get_status()
        
        return jsonify({
            'success': True,
            'sessions': sessions_info,
            'total_sessions': len(sessions_info)
        })
        
    except Exception as e:
        logger.error(f"Error listing sessions: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 400

if __name__ == '__main__':
    logger.info("Starting TradingView Strategy Optimizer - Bayesian Optimization Server")
    logger.info("Make sure to install dependencies: pip install flask flask-cors bayesian-optimization numpy")
    
    # Run the server
    app.run(
        host='127.0.0.1',
        port=5000,
        debug=False,
        threaded=True
    ) 