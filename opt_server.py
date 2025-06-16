from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Tuple, Any, Optional, List, Union
from bayes_opt import BayesianOptimization, acquisition
from bayes_opt import SequentialDomainReductionTransformer  # New import for SDR
from sklearn.gaussian_process.kernels import Matern, RBF, WhiteKernel
import numpy as np
import logging
import random
import json
from datetime import datetime
import pickle
import hashlib

# Configure logging with state tracking (v3.0.0 feature)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# In-memory storage for optimizer instances
optimizer: Optional[BayesianOptimization] = None
sdr_transformer: Optional[SequentialDomainReductionTransformer] = None  # New SDR transformer
acquisition_function: Optional[object] = None
init_points_global: int = 0
n_iter_global: int = 0
suggestion_count: int = 0
pbounds_global: Dict[str, Tuple[float, float]] = {}
pbounds_original: Dict[str, Tuple[float, float]] = {}  # Store original bounds for SDR
optimization_history: List[Dict] = []
parameter_types_global: Dict[str, str] = {}  # Store parameter types
categorical_mappings_global: Dict[str, List[str]] = {}  # Store categorical mappings
# New multi-objective storage
multi_objective_targets: List[str] = []  # Multiple target metrics
pareto_front: List[Dict] = []  # Pareto optimal solutions
optimization_session_id: str = ""  # For warm start capabilities

# Global variables for multi-objective and session management (will be initialized after class definitions)
multi_objective_optimizer = None
session_start_time: Optional[datetime] = None

class InitRequest(BaseModel):
    pbounds: Dict[str, Tuple[float, float]]
    init_points: int
    n_iter: int
    acquisition_type: Optional[str] = "ucb"  # ucb, ei, poi, mixed
    kappa: Optional[float] = 2.576  # UCB exploration parameter
    xi: Optional[float] = 0.01  # EI exploration parameter
    alpha: Optional[float] = 1e-6  # GP noise parameter
    n_restarts_optimizer: Optional[int] = 5  # GP optimization restarts
    kernel_type: Optional[str] = "matern"  # matern, rbf
    random_state: Optional[int] = 42  # For reproducibility
    # New SDR parameters
    use_sdr: Optional[bool] = True  # Enable Sequential Domain Reduction
    gamma_osc: Optional[float] = 0.7  # SDR oscillation parameter
    gamma_pan: Optional[float] = 1.0  # SDR panning parameter
    eta: Optional[float] = 0.9  # SDR reduction factor
    # New parameter type handling
    parameter_types: Optional[Dict[str, str]] = {}  # 'continuous', 'integer', 'categorical', 'ordinal'
    categorical_mappings: Optional[Dict[str, List[str]]] = {}  # For categorical parameters
    # Multi-objective optimization for TradingView
    target_metrics: Optional[List[str]] = ["net_profit"]  # Multiple metrics to optimize
    metric_weights: Optional[Dict[str, float]] = {}  # Weights for multi-objective scalarization
    # Warm start capabilities
    session_id: Optional[str] = None  # Resume previous optimization session
    save_session: Optional[bool] = True  # Save session for later resumption
    # TradingView-specific enhancements
    strategy_type: Optional[str] = "general"  # "scalping", "swing", "day_trading", etc.
    risk_tolerance: Optional[str] = "medium"  # "low", "medium", "high" - affects exploration
    optimization_focus: Optional[str] = "balanced"  # "profit", "risk", "consistency", "balanced"

class ObserveRequest(BaseModel):
    params: Dict[str, float]
    target: float  # Primary target metric
    additional_metrics: Optional[Dict[str, float]] = {}  # Additional metrics for multi-objective
    backtest_duration: Optional[float] = None  # Time taken for backtest (for cost-aware optimization)
    market_conditions: Optional[str] = None  # "bull", "bear", "sideways" - for context-aware optimization

class SuggestResponse(BaseModel):
    params: Dict[str, float]
    done: bool
    acquisition_value: Optional[float] = None
    confidence_interval: Optional[Tuple[float, float]] = None
    quality_metrics: Optional[Dict[str, float]] = None
    current_bounds: Optional[Dict[str, Tuple[float, float]]] = None
    acquisition_strategy: Optional[str] = None
    # Multi-objective enhancements
    pareto_rank: Optional[int] = None  # Rank in current Pareto front
    diversity_score: Optional[float] = None  # How different this suggestion is from previous ones

class BestResponse(BaseModel):
    params: Dict[str, float]
    target: float
    confidence_interval: Optional[Tuple[float, float]] = None
    # Multi-objective best solutions
    pareto_solutions: Optional[List[Dict]] = None  # All Pareto optimal solutions
    recommended_solution: Optional[Dict] = None  # Best solution based on user preferences

class OptimizationStatus(BaseModel):
    iteration: int
    total_iterations: int
    best_target: float
    current_exploration_ratio: float
    gp_score: Optional[float] = None
    # Enhanced status for TradingView
    pareto_front_size: Optional[int] = None
    strategy_performance_trend: Optional[str] = None  # "improving", "stable", "declining"
    estimated_completion_time: Optional[str] = None
    session_id: Optional[str] = None

class WarmStartData(BaseModel):
    """Data structure for saving/loading optimization sessions"""
    session_id: str
    pbounds: Dict[str, Tuple[float, float]]
    parameter_types: Dict[str, str]
    categorical_mappings: Dict[str, List[str]]
    optimization_history: List[Dict]
    target_metrics: List[str]
    created_at: str
    strategy_type: str
    last_updated: str

class TradingViewAcquisitionFunction:
    """Cost-aware acquisition function optimized for TradingView strategy backtesting"""
    
    def __init__(self, base_acquisition, strategy_type: str = "general", risk_tolerance: str = "medium"):
        self.base_acquisition = base_acquisition
        self.strategy_type = strategy_type
        self.risk_tolerance = risk_tolerance
        self.backtest_times = []  # Track backtest durations for cost modeling
        
    def cost_model(self, X):
        """Estimate backtest cost (time) based on parameter combinations"""
        # Higher complexity parameters typically take longer to backtest
        base_cost = 1.0
        
        # Strategy type affects computational cost
        strategy_multipliers = {
            "scalping": 1.5,  # More trades, longer backtests
            "day_trading": 1.2,
            "swing": 0.8,
            "position": 0.6
        }
        
        cost_multiplier = strategy_multipliers.get(self.strategy_type, 1.0)
        
        # Estimate cost based on historical backtest times
        if len(self.backtest_times) > 0:
            avg_backtest_time = np.mean(self.backtest_times[-10:])  # Last 10 backtests
            base_cost = max(0.1, avg_backtest_time / 60.0)  # Normalize to minutes
        
        return np.full(X.shape[0], base_cost * cost_multiplier)
    
    def __call__(self, X, gp, y_max=None, **kwargs):
        """Cost-aware acquisition that considers backtest time"""
        # Get base acquisition value
        base_acq = self.base_acquisition(X, gp, y_max=y_max, **kwargs)
        
        # Apply cost-awareness if we have backtest time data
        if len(self.backtest_times) > 3:
            cost = self.cost_model(X)
            # Divide acquisition by cost (Expected Improvement per Unit Cost)
            cost_aware_acq = base_acq / (cost + 1e-6)
            return cost_aware_acq
        
        return base_acq
    
    def update_cost_model(self, backtest_duration: float):
        """Update the cost model with new backtest duration"""
        self.backtest_times.append(backtest_duration)
        # Keep only recent data points
        if len(self.backtest_times) > 50:
            self.backtest_times = self.backtest_times[-50:]

class MultiObjectiveOptimizer:
    """Multi-objective optimization for TradingView strategies"""
    
    def __init__(self, target_metrics: List[str], metric_weights: Dict[str, float]):
        self.target_metrics = target_metrics
        self.metric_weights = metric_weights or {metric: 1.0 for metric in target_metrics}
        self.pareto_front = []
        
    def scalarize_objectives(self, metrics: Dict[str, float]) -> float:
        """Convert multiple objectives to single scalar using weighted sum"""
        weighted_sum = 0.0
        total_weight = 0.0
        
        for metric in self.target_metrics:
            if metric in metrics and metric in self.metric_weights:
                weight = self.metric_weights[metric]
                weighted_sum += weight * metrics[metric]
                total_weight += weight
        
        return weighted_sum / (total_weight + 1e-6)
    
    def update_pareto_front(self, params: Dict, metrics: Dict[str, float]):
        """Update Pareto front with new solution"""
        solution = {
            "params": params,
            "metrics": metrics,
            "scalarized_value": self.scalarize_objectives(metrics)
        }
        
        # Check if this solution dominates any existing solutions
        dominated_indices = []
        is_dominated = False
        
        for i, existing in enumerate(self.pareto_front):
            if self._dominates(metrics, existing["metrics"]):
                dominated_indices.append(i)
            elif self._dominates(existing["metrics"], metrics):
                is_dominated = True
                break
        
        # Add solution if not dominated
        if not is_dominated:
            # Remove dominated solutions
            for i in reversed(dominated_indices):
                self.pareto_front.pop(i)
            
            # Add new solution
            self.pareto_front.append(solution)
            
            # Keep pareto front size manageable
            if len(self.pareto_front) > 20:
                # Keep best solutions based on scalarized value
                self.pareto_front.sort(key=lambda x: x["scalarized_value"], reverse=True)
                self.pareto_front = self.pareto_front[:20]
    
    def _dominates(self, metrics1: Dict[str, float], metrics2: Dict[str, float]) -> bool:
        """Check if metrics1 dominates metrics2 (assuming maximization)"""
        better_in_all = True
        better_in_at_least_one = False
        
        for metric in self.target_metrics:
            if metric in metrics1 and metric in metrics2:
                if metrics1[metric] < metrics2[metric]:
                    better_in_all = False
                elif metrics1[metric] > metrics2[metric]:
                    better_in_at_least_one = True
        
        return better_in_all and better_in_at_least_one
    
    def get_recommended_solution(self, optimization_focus: str = "balanced") -> Optional[Dict]:
        """Get recommended solution based on optimization focus"""
        if not self.pareto_front:
            return None
        
        if optimization_focus == "profit":
            # Focus on profit-related metrics
            profit_metrics = ["net_profit", "total_return", "profit_factor"]
            return max(self.pareto_front, 
                      key=lambda x: sum(x["metrics"].get(m, 0) for m in profit_metrics))
        
        elif optimization_focus == "risk":
            # Focus on risk-adjusted metrics
            risk_metrics = ["sharpe_ratio", "max_drawdown", "profit_factor"]
            return max(self.pareto_front,
                      key=lambda x: sum(x["metrics"].get(m, 0) for m in risk_metrics))
        
        elif optimization_focus == "consistency":
            # Focus on consistency metrics
            consistency_metrics = ["win_rate", "profit_factor", "recovery_factor"]
            return max(self.pareto_front,
                      key=lambda x: sum(x["metrics"].get(m, 0) for m in consistency_metrics))
        
        else:  # balanced
            return max(self.pareto_front, key=lambda x: x["scalarized_value"])

def create_acquisition_function(acq_type: str, kappa: float = 2.576, xi: float = 0.01):
    """Create the appropriate acquisition function (v3.0.0 compatible)"""
    if acq_type.lower() == "ucb":
        return acquisition.UpperConfidenceBound(kappa=kappa)
    elif acq_type.lower() == "ei":
        return acquisition.ExpectedImprovement(xi=xi)
    elif acq_type.lower() == "poi":
        return acquisition.ProbabilityOfImprovement(xi=xi)
    elif acq_type.lower() == "mixed":
        # Create a mixed acquisition strategy that adapts over time
        return MixedAcquisitionFunction(kappa=kappa, xi=xi)
    else:
        logger.warning(f"Unknown acquisition type {acq_type}, defaulting to UCB")
        return acquisition.UpperConfidenceBound(kappa=kappa)

class MixedAcquisitionFunction:
    """Adaptive acquisition function that switches between UCB and EI based on optimization progress"""
    
    def __init__(self, kappa: float = 2.576, xi: float = 0.01):
        self.ucb = acquisition.UpperConfidenceBound(kappa=kappa)
        self.ei = acquisition.ExpectedImprovement(xi=xi)
        self.kappa = kappa
        self.xi = xi
        
    def __call__(self, X, gp, y_max=None, **kwargs):
        """Adaptive acquisition function that balances exploration and exploitation"""
        # Get the number of observations
        n_observations = len(gp.X_train_) if hasattr(gp, 'X_train_') else 0
        
        # Calculate exploration ratio based on observations
        # Early: more exploration (UCB), Later: more exploitation (EI)
        exploration_weight = max(0.1, 1.0 - (n_observations / 30))
        
        # Calculate both acquisition values
        ucb_values = self.ucb(X, gp, y_max=y_max, **kwargs)
        ei_values = self.ei(X, gp, y_max=y_max, **kwargs)
        
        # Weighted combination
        mixed_values = exploration_weight * ucb_values + (1 - exploration_weight) * ei_values
        
        return mixed_values

def create_kernel(kernel_type: str, n_dims: int):
    """Create the appropriate kernel for the GP"""
    if kernel_type.lower() == "rbf":
        return RBF(length_scale=1.0, length_scale_bounds=(1e-2, 1e2))
    elif kernel_type.lower() == "matern":
        return Matern(length_scale=1.0, length_scale_bounds=(1e-2, 1e2), nu=2.5)
    else:
        logger.warning(f"Unknown kernel type {kernel_type}, defaulting to Matern")
        return Matern(length_scale=1.0, length_scale_bounds=(1e-2, 1e2), nu=2.5)

def setup_sdr_transformer(pbounds: Dict[str, Tuple[float, float]], 
                         gamma_osc: float = 0.7, 
                         gamma_pan: float = 1.0, 
                         eta: float = 0.9):
    """Setup Sequential Domain Reduction transformer for dynamic bounds optimization"""
    try:
        transformer = SequentialDomainReductionTransformer(
            gamma_osc=gamma_osc,
            gamma_pan=gamma_pan,
            eta=eta
        )
        
        # Initialize transformer with original bounds
        bounds_array = np.array([[bounds[0], bounds[1]] for bounds in pbounds.values()])
        transformer.initialize_bounds(bounds_array)
        
        logger.info(f"SDR transformer initialized with gamma_osc={gamma_osc}, gamma_pan={gamma_pan}, eta={eta}")
        return transformer
    except Exception as e:
        logger.warning(f"Could not initialize SDR transformer: {e}")
        return None

def apply_parameter_constraints(params: Dict[str, float]) -> Dict[str, float]:
    """Apply TV-specific parameter constraints and relationships"""
    constrained_params = params.copy()
    
    # Example constraints for TV optimization:
    # Ensure brightness doesn't exceed contrast in certain modes
    if 'brightness' in params and 'contrast' in params:
        if params['brightness'] > params['contrast'] * 1.2:
            constrained_params['brightness'] = min(params['brightness'], params['contrast'] * 1.2)
    
    # Ensure color settings are balanced
    if all(key in params for key in ['red_gain', 'green_gain', 'blue_gain']):
        total_gain = params['red_gain'] + params['green_gain'] + params['blue_gain']
        if total_gain > 300:  # Assuming max total gain
            scale_factor = 300 / total_gain
            constrained_params['red_gain'] *= scale_factor
            constrained_params['green_gain'] *= scale_factor
            constrained_params['blue_gain'] *= scale_factor
    
    # Ensure sharpness doesn't conflict with noise reduction
    if 'sharpness' in params and 'noise_reduction' in params:
        if params['sharpness'] > 50 and params['noise_reduction'] < 20:
            constrained_params['noise_reduction'] = max(params['noise_reduction'], 20)
    
    return constrained_params

def update_sdr_bounds():
    """Update bounds using Sequential Domain Reduction based on current observations"""
    global optimizer, sdr_transformer, pbounds_global
    
    if sdr_transformer is None or len(optimizer.res) < 3:
        return pbounds_global
    
    try:
        # Get current observations
        X = np.array([[res['params'][key] for key in sorted(pbounds_global.keys())] 
                     for res in optimizer.res])
        y = np.array([res['target'] for res in optimizer.res])
        
        # Update SDR bounds
        new_bounds = sdr_transformer.transform(X, y)
        
        # Convert back to dictionary format
        new_pbounds = {}
        for i, key in enumerate(sorted(pbounds_global.keys())):
            new_pbounds[key] = (float(new_bounds[i, 0]), float(new_bounds[i, 1]))
        
        # Log the bounds reduction
        for key in pbounds_global:
            old_range = pbounds_global[key][1] - pbounds_global[key][0]
            new_range = new_pbounds[key][1] - new_pbounds[key][0]
            reduction = (1 - new_range/old_range) * 100
            if reduction > 1:  # Only log significant reductions
                logger.info(f"SDR reduced {key} bounds by {reduction:.1f}%: "
                           f"{pbounds_global[key]} -> {new_pbounds[key]}")
        
        pbounds_global = new_pbounds
        return new_pbounds
        
    except Exception as e:
        logger.warning(f"SDR bounds update failed: {e}")
        return pbounds_global

def coerce_params(raw_params):
    """Coerce parameters to int when bounds are integer-valued"""
    coerced = {}
    for k, v in raw_params.items():
        lo, hi = pbounds_global[k]
        # if both bounds are whole numbers, treat this parameter as integer
        if float(lo).is_integer() and float(hi).is_integer():
            coerced[k] = int(round(np.clip(v, lo, hi)))
        else:
            coerced[k] = float(np.clip(v, lo, hi))
    return coerced

def handle_parameter_types(raw_params: Dict[str, float], 
                         parameter_types: Dict[str, str], 
                         categorical_mappings: Dict[str, List[str]]) -> Dict[str, Union[float, int, str]]:
    """Enhanced parameter handling for different parameter types"""
    processed_params = {}
    
    for param_name, value in raw_params.items():
        param_type = parameter_types.get(param_name, 'continuous')
        
        if param_type == 'integer':
            # Integer parameters
            lo, hi = pbounds_global[param_name]
            processed_params[param_name] = int(round(np.clip(value, lo, hi)))
            
        elif param_type == 'categorical':
            # Categorical parameters - map continuous value to discrete category
            if param_name in categorical_mappings:
                categories = categorical_mappings[param_name]
                # Map [0, 1] range to category index
                lo, hi = pbounds_global[param_name]
                normalized_value = (value - lo) / (hi - lo)
                category_index = int(np.clip(normalized_value * len(categories), 0, len(categories) - 1))
                processed_params[param_name] = categories[category_index]
            else:
                processed_params[param_name] = value
                
        elif param_type == 'ordinal':
            # Ordinal parameters - discrete but with meaningful order
            if param_name in categorical_mappings:
                categories = categorical_mappings[param_name]
                lo, hi = pbounds_global[param_name]
                normalized_value = (value - lo) / (hi - lo)
                category_index = int(np.clip(normalized_value * len(categories), 0, len(categories) - 1))
                processed_params[param_name] = categories[category_index]
            else:
                # Treat as integer if no mapping provided
                lo, hi = pbounds_global[param_name]
                processed_params[param_name] = int(round(np.clip(value, lo, hi)))
                
        else:  # 'continuous'
            # Continuous parameters
            lo, hi = pbounds_global[param_name]
            processed_params[param_name] = float(np.clip(value, lo, hi))
    
    return processed_params

def reverse_parameter_encoding(processed_params: Dict[str, Union[float, int, str]], 
                             parameter_types: Dict[str, str], 
                             categorical_mappings: Dict[str, List[str]]) -> Dict[str, float]:
    """Convert processed parameters back to continuous values for optimization"""
    continuous_params = {}
    
    for param_name, value in processed_params.items():
        param_type = parameter_types.get(param_name, 'continuous')
        
        if param_type in ['categorical', 'ordinal']:
            if param_name in categorical_mappings and isinstance(value, str):
                categories = categorical_mappings[param_name]
                try:
                    category_index = categories.index(value)
                    lo, hi = pbounds_global[param_name]
                    # Map category index back to continuous range
                    normalized_value = category_index / (len(categories) - 1) if len(categories) > 1 else 0.5
                    continuous_params[param_name] = lo + normalized_value * (hi - lo)
                except ValueError:
                    # If value not found in categories, use middle of range
                    lo, hi = pbounds_global[param_name]
                    continuous_params[param_name] = (lo + hi) / 2
            else:
                continuous_params[param_name] = float(value)
        else:
            continuous_params[param_name] = float(value)
    
    return continuous_params

def validate_parameter_constraints(params: Dict[str, Union[float, int, str]], 
                                 parameter_types: Dict[str, str], 
                                 categorical_mappings: Dict[str, List[str]]) -> bool:
    """Validate that parameters meet type and constraint requirements"""
    for param_name, value in params.items():
        param_type = parameter_types.get(param_name, 'continuous')
        
        # Check bounds
        if param_name in pbounds_global:
            lo, hi = pbounds_global[param_name]
            if param_type in ['continuous', 'integer']:
                if not (lo <= float(value) <= hi):
                    logger.warning(f"Parameter {param_name}={value} outside bounds [{lo}, {hi}]")
                    return False
            elif param_type in ['categorical', 'ordinal']:
                if param_name in categorical_mappings:
                    if value not in categorical_mappings[param_name]:
                        logger.warning(f"Parameter {param_name}={value} not in valid categories {categorical_mappings[param_name]}")
                        return False
        
        # Check type constraints
        if param_type == 'integer' and not isinstance(value, int):
            try:
                int(value)
            except (ValueError, TypeError):
                logger.warning(f"Parameter {param_name}={value} cannot be converted to integer")
                return False
        elif param_type in ['categorical', 'ordinal'] and not isinstance(value, str):
            logger.warning(f"Parameter {param_name}={value} should be string for type {param_type}")
            return False
    
    return True

def random_sample():
    """Generate a random sample within bounds using Latin Hypercube for better coverage"""
    from scipy.stats import qmc
    
    if len(pbounds_global) == 1:
        # Single dimension case
        k, (lo, hi) = list(pbounds_global.items())[0]
        return {k: random.uniform(lo, hi)}
    
    # Multi-dimensional Latin Hypercube sampling for better space coverage
    sampler = qmc.LatinHypercube(d=len(pbounds_global), seed=random.randint(0, 1000))
    sample = sampler.random(n=1)[0]
    
    result = {}
    for i, (k, (lo, hi)) in enumerate(pbounds_global.items()):
        result[k] = lo + sample[i] * (hi - lo)
    
    return result

def get_confidence_interval(params_dict: Dict[str, float], confidence: float = 0.95):
    """Get confidence interval for given parameters using GP prediction"""
    if optimizer is None or len(optimizer.res) == 0:
        return None
    
    try:
        # Convert params to array format expected by GP
        X = np.array([[params_dict[key] for key in sorted(params_dict.keys())]])
        
        # Get prediction with uncertainty
        mean, std = optimizer._gp.predict(X, return_std=True)
        
        # Calculate confidence interval (assuming normal distribution)
        z_score = 1.96 if confidence == 0.95 else 2.576  # 95% or 99%
        margin = z_score * std[0]
        
        return (float(mean[0] - margin), float(mean[0] + margin))
    except Exception as e:
        logger.warning(f"Could not calculate confidence interval: {e}")
        return None

def create_constraint_function(constraint_type: str = "tv_constraints"):
    """Create constraint functions for TV parameter optimization"""
    
    def tv_constraint_function(params_dict: Dict[str, float]) -> float:
        """
        Constraint function for TV parameters.
        Returns negative value if constraints are violated, positive if satisfied.
        """
        violations = 0.0
        
        # Brightness-Contrast relationship constraint
        if 'brightness' in params_dict and 'contrast' in params_dict:
            brightness_contrast_ratio = params_dict['brightness'] / (params_dict['contrast'] + 1e-6)
            if brightness_contrast_ratio > 1.5:  # Too high brightness relative to contrast
                violations += (brightness_contrast_ratio - 1.5) * 10
        
        # Color balance constraint
        if all(key in params_dict for key in ['red_gain', 'green_gain', 'blue_gain']):
            color_gains = [params_dict['red_gain'], params_dict['green_gain'], params_dict['blue_gain']]
            color_imbalance = np.std(color_gains) / (np.mean(color_gains) + 1e-6)
            if color_imbalance > 0.3:  # Too much color imbalance
                violations += (color_imbalance - 0.3) * 5
        
        # Sharpness-Noise reduction relationship
        if 'sharpness' in params_dict and 'noise_reduction' in params_dict:
            if params_dict['sharpness'] > 70 and params_dict['noise_reduction'] < 30:
                violations += 5  # High sharpness with low noise reduction can cause artifacts
        
        # Return constraint satisfaction (positive = satisfied, negative = violated)
        return -violations
    
    if constraint_type == "tv_constraints":
        return tv_constraint_function
    else:
        return None

def evaluate_parameter_quality(params: Dict[str, float]) -> Dict[str, float]:
    """Evaluate parameter quality and provide diagnostic information"""
    quality_metrics = {}
    
    # Range utilization - how well we're using the parameter space
    range_utilization = 0.0
    if pbounds_original:
        for key, value in params.items():
            if key in pbounds_original:
                min_val, max_val = pbounds_original[key]
                normalized_val = (value - min_val) / (max_val - min_val)
                # Distance from center (0.5) indicates exploration
                range_utilization += abs(normalized_val - 0.5)
        range_utilization /= len(params)
    
    quality_metrics['range_utilization'] = range_utilization
    
    # Parameter stability (how different from recent suggestions)
    stability_score = 1.0
    if len(optimization_history) > 0:
        recent_params = optimization_history[-1]['params']
        differences = []
        for key in params.keys():
            if key in recent_params and key in pbounds_original:
                min_val, max_val = pbounds_original[key]
                param_range = max_val - min_val
                diff = abs(params[key] - recent_params[key]) / param_range
                differences.append(diff)
        if differences:
            stability_score = 1.0 - np.mean(differences)
    
    quality_metrics['stability_score'] = stability_score
    
    # Constraint satisfaction score
    constraint_func = create_constraint_function("tv_constraints")
    if constraint_func:
        constraint_score = max(0.0, constraint_func(params))  # Normalize to positive
        quality_metrics['constraint_satisfaction'] = constraint_score
    
    return quality_metrics

@app.post("/init", response_model=SuggestResponse)
def init(req: InitRequest):
    global optimizer, acquisition_function, init_points_global, n_iter_global, suggestion_count, pbounds_global, pbounds_original, optimization_history, sdr_transformer, parameter_types_global, categorical_mappings_global, multi_objective_optimizer, optimization_session_id, session_start_time, multi_objective_targets, pareto_front
    
    logger.info(f"Initializing TradingView optimizer: {req.acquisition_type}, strategy: {req.strategy_type}, focus: {req.optimization_focus}")
    logger.info(f"Multi-objective targets: {req.target_metrics}, SDR: {req.use_sdr}")
    
    # Handle warm start if session_id provided
    if req.session_id:
        loaded_session = load_optimization_session(req.session_id)
        if loaded_session:
            logger.info(f"Resuming session {req.session_id}")
            pbounds_global = loaded_session["pbounds"]
            pbounds_original = pbounds_global.copy()
            parameter_types_global = loaded_session["parameter_types"]
            categorical_mappings_global = loaded_session["categorical_mappings"]
            optimization_history = loaded_session["optimization_history"]
            multi_objective_targets = loaded_session["target_metrics"]
            optimization_session_id = req.session_id
            suggestion_count = len(optimization_history) + 1
        else:
            logger.warning(f"Could not load session {req.session_id}, starting fresh")
    
    # Generate new session ID if not resuming
    if not optimization_session_id:
        optimization_session_id = req.session_id or generate_session_id(req.pbounds, req.strategy_type)
    
    # Initialize session tracking
    session_start_time = datetime.now()
    
    # Reset/initialize global state
    if not req.session_id or not loaded_session:  # Fresh start
        optimizer = None
        sdr_transformer = None
        pbounds_global = req.pbounds
        pbounds_original = req.pbounds.copy()
        parameter_types_global = req.parameter_types or {}
        categorical_mappings_global = req.categorical_mappings or {}
        init_points_global = req.init_points
        n_iter_global = req.n_iter
        suggestion_count = 1
        optimization_history = []
        multi_objective_targets = req.target_metrics or ["net_profit"]
        pareto_front = []
    
    # Setup multi-objective optimizer
    multi_objective_optimizer = MultiObjectiveOptimizer(
        target_metrics=multi_objective_targets,
        metric_weights=req.metric_weights or {}
    )
    
    # Setup Sequential Domain Reduction if enabled
    if req.use_sdr:
        sdr_transformer = setup_sdr_transformer(
            pbounds_original, req.gamma_osc, req.gamma_pan, req.eta
        )
    
    # Create TradingView-optimized acquisition function
    acquisition_function = create_tradingview_acquisition_function(
        req.acquisition_type, req.strategy_type, req.risk_tolerance, req.kappa, req.xi
    )
    
    # Initialize optimizer with v3.0.0 features
    optimizer = BayesianOptimization(
        f=None,  # We'll use suggest-evaluate-register paradigm
        pbounds=pbounds_global,
        acquisition_function=acquisition_function,
        verbose=2,
        random_state=req.random_state,  # Fixed for reproducibility
        allow_duplicate_points=True,
    )
    
    # Configure GP parameters for better performance
    optimizer.set_gp_params(
        alpha=req.alpha,
        n_restarts_optimizer=req.n_restarts_optimizer,
    )
    
    # Generate first suggestion using improved sampling
    raw = random_sample()
    
    # Handle different parameter types
    if parameter_types_global or categorical_mappings_global:
        params = handle_parameter_types(raw, parameter_types_global, categorical_mappings_global)
    else:
        params = coerce_params(raw)
    
    # Validate parameters
    if not validate_parameter_constraints(params, parameter_types_global, categorical_mappings_global):
        logger.warning("Generated parameters failed validation, using fallback")
        params = coerce_params(raw)
    
    logger.info(f"First suggestion: {params}")
    
    return SuggestResponse(
        params=params, 
        done=False,
        acquisition_value=0.0,  # Random sample has no acquisition value
        confidence_interval=None,
        quality_metrics=None,
        current_bounds=pbounds_global,
        acquisition_strategy="random_initialization"
    )

@app.post("/observe", response_model=SuggestResponse)
def observe(req: ObserveRequest):
    global optimizer, suggestion_count, optimization_history, multi_objective_optimizer, acquisition_function
    
    if optimizer is None:
        raise HTTPException(status_code=400, detail="Optimizer not initialized")
    
    logger.info(f"Observing: params={req.params}, target={req.target}, additional_metrics={req.additional_metrics}")
    
    # Apply parameter constraints before registering
    constrained_params = apply_parameter_constraints(req.params)
    
    # Handle multi-objective optimization
    all_metrics = {"primary": req.target}
    all_metrics.update(req.additional_metrics or {})
    
    # Update multi-objective optimizer and Pareto front
    if multi_objective_optimizer:
        multi_objective_optimizer.update_pareto_front(constrained_params, all_metrics)
        scalarized_target = multi_objective_optimizer.scalarize_objectives(all_metrics)
    else:
        scalarized_target = req.target
    
    # Register the observed point using scalarized target for single-objective BO
    optimizer.register(params=constrained_params, target=scalarized_target)
    
    # Update cost model if using TradingView acquisition function
    if hasattr(acquisition_function, 'update_cost_model') and req.backtest_duration:
        acquisition_function.update_cost_model(req.backtest_duration)
    
    # Update SDR bounds if we have enough observations
    if sdr_transformer and len(optimizer.res) >= 3 and (len(optimizer.res) % 3 == 0):
        old_bounds = pbounds_global.copy()
        update_sdr_bounds()
        # If bounds changed, log the update
        if old_bounds != pbounds_global:
            logger.info(f"SDR updated bounds: {pbounds_global}")
    
    # Enhanced optimization history with multi-objective data
    history_entry = {
        "iteration": suggestion_count,
        "params": constrained_params,
        "target": req.target,
        "scalarized_target": scalarized_target,
        "additional_metrics": req.additional_metrics or {},
        "is_best": req.target >= max([h["target"] for h in optimization_history] + [req.target]),
        "bounds_reduced": sdr_transformer is not None and len(optimizer.res) >= 3,
        "backtest_duration": req.backtest_duration,
        "market_conditions": req.market_conditions,
        "timestamp": datetime.now().isoformat()
    }
    
    # Check if this is a Pareto optimal solution
    if multi_objective_optimizer and multi_objective_optimizer.pareto_front:
        pareto_params = [sol["params"] for sol in multi_objective_optimizer.pareto_front]
        history_entry["is_pareto_optimal"] = constrained_params in pareto_params
    
    optimization_history.append(history_entry)
    
    # Save session if enabled
    if optimization_session_id:
        session_data = WarmStartData(
            session_id=optimization_session_id,
            pbounds=pbounds_original,
            parameter_types=parameter_types_global,
            categorical_mappings=categorical_mappings_global,
            optimization_history=optimization_history,
            target_metrics=multi_objective_targets,
            created_at=session_start_time.isoformat() if session_start_time else datetime.now().isoformat(),
            strategy_type="general",  # This should come from init request
            last_updated=datetime.now().isoformat()
        )
        save_optimization_session(optimization_session_id, session_data)
    
    suggestion_count += 1
    
    # Check if we're done
    if suggestion_count > init_points_global + n_iter_global:
        logger.info("Optimization completed")
        return SuggestResponse(params={}, done=True)
    
    # Determine next suggestion strategy
    if suggestion_count <= init_points_global:
        # Still in random exploration phase
        logger.info(f"Random exploration phase: {suggestion_count}/{init_points_global}")
        raw = random_sample()
        acquisition_val = 0.0
    else:
        # Bayesian optimization phase
        logger.info(f"Bayesian phase: {suggestion_count - init_points_global}/{n_iter_global}")
        
        try:
            # Use the suggest method for next point
            raw = optimizer.suggest()
            
            # Calculate acquisition value for the suggested point (v3.0.0 compatible)
            if len(optimizer.res) > 0:
                X = np.array([[raw[key] for key in sorted(raw.keys())]])
                # Get the current maximum target value
                current_y_max = optimizer.max["target"] if hasattr(optimizer, 'max') and optimizer.max else 0.0
                acquisition_val = float(acquisition_function(X, optimizer._gp, y_max=current_y_max))
            else:
                acquisition_val = 0.0
                
        except Exception as e:
            logger.warning(f"Suggestion failed, falling back to random: {e}")
            raw = random_sample()
            acquisition_val = 0.0
    
    # Handle different parameter types
    if parameter_types_global or categorical_mappings_global:
        params = handle_parameter_types(raw, parameter_types_global, categorical_mappings_global)
        # Validate parameters
        if not validate_parameter_constraints(params, parameter_types_global, categorical_mappings_global):
            logger.warning("Generated parameters failed validation, using fallback")
            params = coerce_params(raw)
    else:
        params = coerce_params(raw)
    
    confidence_interval = get_confidence_interval(params)
    
    # Evaluate parameter quality
    quality_metrics = evaluate_parameter_quality(params)
    
    # Calculate diversity score and Pareto rank
    diversity_score = calculate_diversity_score(params)
    pareto_rank = None
    if multi_objective_optimizer and multi_objective_optimizer.pareto_front:
        # Simple ranking based on scalarized value
        pareto_values = [sol["scalarized_value"] for sol in multi_objective_optimizer.pareto_front]
        if pareto_values:
            current_scalarized = multi_objective_optimizer.scalarize_objectives({"primary": 0})  # Placeholder
            pareto_rank = sum(1 for val in pareto_values if val > current_scalarized) + 1
    
    # Determine acquisition strategy
    acquisition_strategy = "random" if suggestion_count <= init_points_global else "bayesian"
    if hasattr(acquisition_function, '__class__'):
        if "TradingView" in acquisition_function.__class__.__name__:
            base_strategy = acquisition_function.base_acquisition.__class__.__name__
            acquisition_strategy = f"tradingview_{base_strategy.lower()}"
        elif "Mixed" in acquisition_function.__class__.__name__:
            n_obs = len(optimizer.res) if optimizer else 0
            exploration_weight = max(0.1, 1.0 - (n_obs / 30))
            acquisition_strategy = f"mixed (UCB:{exploration_weight:.2f}, EI:{1-exploration_weight:.2f})"
        else:
            acquisition_strategy = acquisition_function.__class__.__name__.replace("Acquisition", "").replace("Function", "")
    
    logger.info(f"Next suggestion: {params}, acquisition_value: {acquisition_val:.4f}, "
               f"diversity: {diversity_score:.3f}, strategy: {acquisition_strategy}")
    
    return SuggestResponse(
        params=params, 
        done=False,
        acquisition_value=acquisition_val,
        confidence_interval=confidence_interval,
        quality_metrics=quality_metrics,
        current_bounds=pbounds_global,
        acquisition_strategy=acquisition_strategy,
        pareto_rank=pareto_rank,
        diversity_score=diversity_score
    )

@app.get("/best", response_model=BestResponse)
def best():
    global optimizer, multi_objective_optimizer
    if optimizer is None:
        raise HTTPException(status_code=400, detail="Optimizer not initialized")
    
    if len(optimizer.res) == 0:
        raise HTTPException(status_code=400, detail="No observations recorded yet")
    
    # Get single-objective best
    best_result = optimizer.max
    params = coerce_params(best_result['params'])
    confidence_interval = get_confidence_interval(params)
    
    # Get multi-objective solutions
    pareto_solutions = None
    recommended_solution = None
    if multi_objective_optimizer and multi_objective_optimizer.pareto_front:
        pareto_solutions = [
            {
                "params": sol["params"],
                "metrics": sol["metrics"],
                "scalarized_value": sol["scalarized_value"]
            }
            for sol in multi_objective_optimizer.pareto_front
        ]
        
        # Get recommended solution based on optimization focus (default: balanced)
        recommended_solution = multi_objective_optimizer.get_recommended_solution("balanced")
    
    logger.info(f"Best result: {params}, target: {best_result['target']}, Pareto solutions: {len(pareto_solutions) if pareto_solutions else 0}")
    
    return BestResponse(
        params=params, 
        target=best_result['target'],
        confidence_interval=confidence_interval,
        pareto_solutions=pareto_solutions,
        recommended_solution=recommended_solution
    )

@app.get("/status", response_model=OptimizationStatus)
def status():
    """Get current optimization status and diagnostics"""
    global optimizer, optimization_history, multi_objective_optimizer, optimization_session_id
    
    if optimizer is None:
        raise HTTPException(status_code=400, detail="Optimizer not initialized")
    
    current_iteration = suggestion_count - 1
    total_iterations = init_points_global + n_iter_global
    
    # Calculate exploration ratio (how much we're exploring vs exploiting)
    exploration_ratio = 0.0
    if current_iteration > init_points_global:
        recent_history = optimization_history[-min(5, len(optimization_history)):]
        if recent_history:
            targets = [h["target"] for h in recent_history]
            exploration_ratio = float(np.std(targets) / (np.mean(targets) + 1e-8))
    
    # Get GP score if available
    gp_score = None
    if len(optimizer.res) > 2:
        try:
            X = np.array([[h["params"][key] for key in sorted(h["params"].keys())] 
                         for h in optimization_history])
            y = np.array([h["target"] for h in optimization_history])
            gp_score = float(optimizer._gp.score(X, y))
        except Exception as e:
            logger.warning(f"Could not calculate GP score: {e}")
    
    best_target = max([h["target"] for h in optimization_history]) if optimization_history else 0.0
    
    # TradingView-specific enhancements
    pareto_front_size = len(multi_objective_optimizer.pareto_front) if multi_objective_optimizer else 0
    strategy_performance_trend = analyze_strategy_performance_trend()
    estimated_completion_time = estimate_completion_time(current_iteration, total_iterations)
    
    return OptimizationStatus(
        iteration=current_iteration,
        total_iterations=total_iterations,
        best_target=best_target,
        current_exploration_ratio=exploration_ratio,
        gp_score=gp_score,
        pareto_front_size=pareto_front_size,
        strategy_performance_trend=strategy_performance_trend,
        estimated_completion_time=estimated_completion_time,
        session_id=optimization_session_id
    )

@app.get("/history")
def get_history():
    """Get optimization history for analysis"""
    return {
        "history": optimization_history,
        "total_observations": len(optimization_history),
        "best_iteration": max(optimization_history, key=lambda x: x["target"])["iteration"] if optimization_history else None
    }

# Health check endpoint
@app.get("/health")
def health_check():
    return {"status": "healthy", "optimizer_initialized": optimizer is not None, "version": "3.0.0"}

# Advanced analytics endpoint (new feature)
@app.get("/analytics")
def get_optimization_analytics():
    """Get advanced optimization analytics and insights"""
    if optimizer is None:
        raise HTTPException(status_code=400, detail="Optimizer not initialized")
    
    analytics = {
        "optimization_progress": {
            "total_evaluations": len(optimization_history),
            "best_target": max([h["target"] for h in optimization_history]) if optimization_history else 0.0,
            "improvement_rate": 0.0,
            "convergence_estimate": 0.0
        },
        "parameter_space_coverage": {},
        "acquisition_performance": {},
        "bounds_evolution": {},
        "constraint_violations": 0
    }
    
    if len(optimization_history) > 1:
        # Calculate improvement rate
        targets = [h["target"] for h in optimization_history]
        recent_targets = targets[-min(5, len(targets)):]
        early_targets = targets[:min(5, len(targets))]
        if len(recent_targets) > 0 and len(early_targets) > 0:
            analytics["optimization_progress"]["improvement_rate"] = (
                np.mean(recent_targets) - np.mean(early_targets)
            ) / len(optimization_history)
        
        # Convergence estimate (variance of recent targets)
        if len(recent_targets) > 1:
            analytics["optimization_progress"]["convergence_estimate"] = float(np.var(recent_targets))
        
        # Parameter space coverage analysis
        if pbounds_original:
            for param_name in pbounds_original.keys():
                param_values = [h["params"].get(param_name, 0) for h in optimization_history if param_name in h["params"]]
                if param_values:
                    min_bound, max_bound = pbounds_original[param_name]
                    range_coverage = (max(param_values) - min(param_values)) / (max_bound - min_bound)
                    analytics["parameter_space_coverage"][param_name] = {
                        "range_coverage": float(range_coverage),
                        "mean_value": float(np.mean(param_values)),
                        "std_value": float(np.std(param_values))
                    }
    
    # SDR bounds evolution
    if sdr_transformer and pbounds_original:
        analytics["bounds_evolution"] = {
            "original_bounds": pbounds_original,
            "current_bounds": pbounds_global,
            "reduction_percentage": {}
        }
        for param_name in pbounds_original.keys():
            if param_name in pbounds_global:
                orig_range = pbounds_original[param_name][1] - pbounds_original[param_name][0]
                curr_range = pbounds_global[param_name][1] - pbounds_global[param_name][0]
                reduction = (1 - curr_range/orig_range) * 100
                analytics["bounds_evolution"]["reduction_percentage"][param_name] = float(reduction)
    
    # Count constraint violations
    constraint_func = create_constraint_function("tv_constraints")
    if constraint_func:
        violations = 0
        for history_item in optimization_history:
            if constraint_func(history_item["params"]) < 0:
                violations += 1
        analytics["constraint_violations"] = violations
    
    return analytics

# Version info endpoint (new in v3.0.0)
@app.get("/version")
def version_info():
    import bayes_opt
    return {
        "server_version": "3.0.0-enhanced",
        "bayes_opt_version": bayes_opt.__version__ if hasattr(bayes_opt, '__version__') else "3.0.0",
        "features": [
            "typed_optimization", 
            "advanced_logging", 
            "confidence_intervals", 
            "latin_hypercube_sampling",
            "suggest_evaluate_register",
            "sequential_domain_reduction",
            "mixed_acquisition_functions",
            "parameter_constraints",
            "quality_metrics",
            "optimization_analytics"
        ]
    }

# Utility to run via: uvicorn opt_server:app --reload 

def create_tradingview_acquisition_function(acq_type: str, 
                                          strategy_type: str = "general",
                                          risk_tolerance: str = "medium",
                                          kappa: float = 2.576, 
                                          xi: float = 0.01):
    """Create TradingView-optimized acquisition function"""
    
    # Adjust parameters based on risk tolerance and strategy type
    if risk_tolerance == "low":
        kappa *= 0.7  # Less exploration
        xi *= 0.5
    elif risk_tolerance == "high":
        kappa *= 1.3  # More exploration
        xi *= 1.5
    
    # Create base acquisition function
    if acq_type.lower() == "ucb":
        base_acq = acquisition.UpperConfidenceBound(kappa=kappa)
    elif acq_type.lower() == "ei":
        base_acq = acquisition.ExpectedImprovement(xi=xi)
    elif acq_type.lower() == "poi":
        base_acq = acquisition.ProbabilityOfImprovement(xi=xi)
    elif acq_type.lower() == "mixed":
        base_acq = MixedAcquisitionFunction(kappa=kappa, xi=xi)
    else:
        base_acq = acquisition.UpperConfidenceBound(kappa=kappa)
    
    # Wrap with TradingView-specific enhancements
    return TradingViewAcquisitionFunction(base_acq, strategy_type, risk_tolerance)

def generate_session_id(pbounds: Dict, strategy_type: str) -> str:
    """Generate unique session ID based on parameters and strategy"""
    session_data = f"{pbounds}_{strategy_type}_{datetime.now().isoformat()}"
    return hashlib.md5(session_data.encode()).hexdigest()[:12]

def save_optimization_session(session_id: str, data: WarmStartData):
    """Save optimization session for warm start (simplified file-based storage)"""
    try:
        filename = f"session_{session_id}.pkl"
        with open(filename, 'wb') as f:
            pickle.dump(data.dict(), f)
        logger.info(f"Session {session_id} saved successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to save session {session_id}: {e}")
        return False

def load_optimization_session(session_id: str) -> Optional[Dict]:
    """Load optimization session for warm start"""
    try:
        filename = f"session_{session_id}.pkl"
        with open(filename, 'rb') as f:
            data = pickle.load(f)
        logger.info(f"Session {session_id} loaded successfully")
        return data
    except Exception as e:
        logger.error(f"Failed to load session {session_id}: {e}")
        return None

def estimate_completion_time(current_iteration: int, total_iterations: int) -> str:
    """Estimate completion time based on current progress and backtest durations"""
    if current_iteration <= 1 or not session_start_time:
        return "Calculating..."
    
    elapsed_time = (datetime.now() - session_start_time).total_seconds()
    avg_time_per_iteration = elapsed_time / current_iteration
    remaining_iterations = total_iterations - current_iteration
    estimated_remaining_seconds = remaining_iterations * avg_time_per_iteration
    
    if estimated_remaining_seconds < 60:
        return f"{int(estimated_remaining_seconds)} seconds"
    elif estimated_remaining_seconds < 3600:
        return f"{int(estimated_remaining_seconds // 60)} minutes"
    else:
        hours = int(estimated_remaining_seconds // 3600)
        minutes = int((estimated_remaining_seconds % 3600) // 60)
        return f"{hours}h {minutes}m"

def calculate_diversity_score(params: Dict[str, float]) -> float:
    """Calculate how diverse current parameters are from recent suggestions"""
    if len(optimization_history) < 2:
        return 1.0
    
    recent_params = [h["params"] for h in optimization_history[-5:]]  # Last 5 suggestions
    diversity_scores = []
    
    for recent in recent_params:
        param_distances = []
        for key in params.keys():
            if key in recent and key in pbounds_original:
                min_val, max_val = pbounds_original[key]
                param_range = max_val - min_val
                if param_range > 0:
                    normalized_distance = abs(params[key] - recent[key]) / param_range
                    param_distances.append(normalized_distance)
        
        if param_distances:
            diversity_scores.append(np.mean(param_distances))
    
    return np.mean(diversity_scores) if diversity_scores else 1.0

def analyze_strategy_performance_trend() -> str:
    """Analyze if strategy performance is improving, stable, or declining"""
    if len(optimization_history) < 5:
        return "insufficient_data"
    
    recent_targets = [h["target"] for h in optimization_history[-10:]]
    
    # Calculate trend using simple linear regression slope
    x = np.arange(len(recent_targets))
    if len(recent_targets) > 1:
        slope = np.polyfit(x, recent_targets, 1)[0]
        
        if slope > 0.01:  # Threshold for improvement
            return "improving"
        elif slope < -0.01:  # Threshold for decline
            return "declining"
        else:
            return "stable"
    
    return "stable" 