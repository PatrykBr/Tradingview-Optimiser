from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Tuple, Optional, List
from bayes_opt import BayesianOptimization, acquisition
from sklearn.gaussian_process.kernels import Matern
import logging
import random
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Global state
optimizer: Optional[BayesianOptimization] = None
init_points_global: int = 0
n_iter_global: int = 0
suggestion_count: int = 0
pbounds_global: Dict[str, Tuple[float, float]] = {}
optimization_history: List[Dict] = []
parameter_types_global: Dict[str, str] = {}
categorical_mappings_global: Dict[str, List[str]] = {}

class InitRequest(BaseModel):
    pbounds: Dict[str, Tuple[float, float]]
    init_points: int
    n_iter: int
    acquisition_type: Optional[str] = "ucb"
    kappa: Optional[float] = 2.576
    xi: Optional[float] = 0.01
    alpha: Optional[float] = 1e-6
    random_state: Optional[int] = 42
    parameter_types: Optional[Dict[str, str]] = {}
    categorical_mappings: Optional[Dict[str, List[str]]] = {}
    target_metrics: Optional[List[str]] = ["net_profit"]

class ObserveRequest(BaseModel):
    params: Dict[str, float]
    target: float
    additional_metrics: Optional[Dict[str, float]] = {}

class SuggestResponse(BaseModel):
    params: Dict[str, float]
    done: bool
    acquisition_value: Optional[float] = None

class BestResponse(BaseModel):
    params: Dict[str, float]
    target: float

class OptimizationStatus(BaseModel):
    iteration: int
    total_iterations: int
    best_target: float
    current_exploration_ratio: float

def convert_parameters(params_dict, parameter_types, categorical_mappings, to_processed=True):
    """Convert parameters between encoded and processed formats"""
    result = {}
    
    for param_name, value in params_dict.items():
        param_type = parameter_types.get(param_name, "continuous")
        
        if to_processed:
            # Convert from encoded to processed (for display/response)
            if param_type == "integer":
                result[param_name] = int(round(float(value)))
            elif param_type == "categorical":
                if param_name in categorical_mappings:
                    options = categorical_mappings[param_name]
                    index = min(max(0, int(float(value))), len(options) - 1)
                    result[param_name] = options[index]
                else:
                    result[param_name] = value
            else:  # continuous
                result[param_name] = float(value)
        else:
            # Convert from processed to encoded (for optimizer)
            if param_type == "categorical" and param_name in categorical_mappings:
                options = categorical_mappings[param_name]
                if isinstance(value, str) and value in options:
                    result[param_name] = float(options.index(value))
                else:
                    result[param_name] = float(value)
            else:
                result[param_name] = float(value)
    
    return result

@app.post("/init", response_model=SuggestResponse)
def init(req: InitRequest):
    global optimizer, init_points_global, n_iter_global, suggestion_count
    global pbounds_global, optimization_history, parameter_types_global, categorical_mappings_global
    
    try:
        # Store global parameters
        pbounds_global = req.pbounds
        init_points_global = req.init_points
        n_iter_global = req.n_iter
        suggestion_count = 0
        parameter_types_global = req.parameter_types or {}
        categorical_mappings_global = req.categorical_mappings or {}
        optimization_history = []
        
        logger.info(f"Initializing optimization with bounds: {pbounds_global}")
        
        # Adjust bounds for categorical parameters
        adjusted_bounds = {}
        for param_name, (min_val, max_val) in pbounds_global.items():
            param_type = parameter_types_global.get(param_name, "continuous")
            if param_type == "categorical" and param_name in categorical_mappings_global:
                num_options = len(categorical_mappings_global[param_name])
                adjusted_bounds[param_name] = (0, num_options - 1)
            else:
                adjusted_bounds[param_name] = (min_val, max_val)
        
        # Create acquisition function
        if req.acquisition_type.lower() == "ei":
            acq_func = acquisition.ExpectedImprovement(xi=req.xi)
        elif req.acquisition_type.lower() == "poi":
            acq_func = acquisition.ProbabilityOfImprovement(xi=req.xi)
        else:  # ucb
            acq_func = acquisition.UpperConfidenceBound(kappa=req.kappa)
        
        # Initialize optimizer
        optimizer = BayesianOptimization(
            f=None,
            pbounds=adjusted_bounds,
            acquisition_function=acq_func,
            random_state=req.random_state,
            allow_duplicate_points=True
        )
        
        # Set GP parameters
        kernel = Matern(length_scale=1.0, length_scale_bounds=(1e-2, 1e2), nu=2.5)
        optimizer.set_gp_params(alpha=req.alpha, kernel=kernel, n_restarts_optimizer=5)
        
        # Generate first suggestion (random)
        suggestion = {}
        for param_name, (min_val, max_val) in adjusted_bounds.items():
            suggestion[param_name] = random.uniform(min_val, max_val)
        
        # Convert to proper parameter types for response
        processed_params = convert_parameters(suggestion, parameter_types_global, categorical_mappings_global, to_processed=True)
        response_params = convert_parameters(processed_params, parameter_types_global, categorical_mappings_global, to_processed=False)
        
        suggestion_count += 1
        total_iterations = init_points_global + n_iter_global
        done = suggestion_count >= total_iterations
        
        logger.info(f"Generated suggestion {suggestion_count}/{total_iterations}: {processed_params}")
        
        return SuggestResponse(
            params=response_params,
            done=done,
            acquisition_value=0.0
        )
        
    except Exception as e:
        logger.error(f"Error in init: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/observe", response_model=SuggestResponse)
def observe(req: ObserveRequest):
    global optimizer, suggestion_count, optimization_history
    
    try:
        if optimizer is None:
            raise HTTPException(status_code=400, detail="Optimizer not initialized")
        
        logger.info(f"Observe called with params: {req.params}")
        
        # Convert parameters to encoded format for optimizer
        encoded_params = convert_parameters(req.params, parameter_types_global, categorical_mappings_global, to_processed=False)
        logger.info(f"Encoded params: {encoded_params}")
        
        # Register observation
        optimizer.register(params=encoded_params, target=req.target)
        logger.info(f"Registered observation successfully")
        
        # Store in history
        processed_params = convert_parameters(req.params, parameter_types_global, categorical_mappings_global, to_processed=True)
        history_entry = {
            "iteration": suggestion_count,
            "params": processed_params,
            "target": req.target,
            "timestamp": datetime.now().isoformat()
        }
        optimization_history.append(history_entry)
        
        logger.info(f"Observed result: {processed_params} -> {req.target}")
        
        # Check if done
        total_iterations = init_points_global + n_iter_global
        done = suggestion_count >= total_iterations
        
        if done:
            logger.info("Optimization completed!")
            return SuggestResponse(params={}, done=True)
        
        # Get next suggestion
        if suggestion_count < init_points_global:
            # Random exploration
            logger.info("Using random exploration")
            suggestion = {}
            # Use space.keys for parameter names and space.bounds array for ranges
            param_names = list(optimizer.space.keys)
            bounds_array = optimizer.space.bounds
            logger.info(f"Param names: {param_names}")
            logger.info(f"Bounds array: {bounds_array}")
            
            for i, param_name in enumerate(param_names):
                if i < len(bounds_array):
                    min_val, max_val = float(bounds_array[i][0]), float(bounds_array[i][1])
                    suggestion[param_name] = random.uniform(min_val, max_val)
                    logger.info(f"Generated {param_name}: {suggestion[param_name]} in range [{min_val}, {max_val}]")
        else:
            # Bayesian optimization
            logger.info("Using Bayesian optimization")
            suggestion = optimizer.suggest()
            logger.info(f"Raw suggestion from optimizer: {suggestion} (type: {type(suggestion)})")
        
        # Ensure suggestion is a dictionary
        if not isinstance(suggestion, dict):
            logger.error(f"Suggestion is not a dict! Type: {type(suggestion)}, Value: {suggestion}")
            raise ValueError(f"optimizer.suggest() returned {type(suggestion)} instead of dict")
        
        # Convert to proper parameter types for response
        processed_params = convert_parameters(suggestion, parameter_types_global, categorical_mappings_global, to_processed=True)
        response_params = convert_parameters(processed_params, parameter_types_global, categorical_mappings_global, to_processed=False)
        
        suggestion_count += 1
        
        logger.info(f"Generated suggestion {suggestion_count}/{total_iterations}: {processed_params}")
        
        return SuggestResponse(
            params=response_params,
            done=False,
            acquisition_value=None
        )
        
    except Exception as e:
        logger.error(f"Error in observe: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/best", response_model=BestResponse)
def best():
    global optimizer
    
    try:
        if optimizer is None or len(optimizer.space.target) == 0:
            raise HTTPException(status_code=400, detail="No observations yet")
        
        # Get best result
        best_params_raw = optimizer.max["params"]
        best_target = optimizer.max["target"]
        
        logger.info(f"Raw best params: {best_params_raw} (type: {type(best_params_raw)})")
        
        # Ensure best_params is a dictionary
        if not isinstance(best_params_raw, dict):
            logger.error(f"Best params is not a dict! Type: {type(best_params_raw)}")
            raise ValueError(f"optimizer.max['params'] returned {type(best_params_raw)} instead of dict")
        
        # Convert to proper parameter types
        best_params = convert_parameters(best_params_raw, parameter_types_global, categorical_mappings_global, to_processed=True)
        
        logger.info(f"Best result: {best_params} -> {best_target}")
        
        return BestResponse(params=best_params, target=best_target)
        
    except Exception as e:
        logger.error(f"Error in best: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status", response_model=OptimizationStatus)
def status():
    global optimizer, suggestion_count
    
    try:
        if optimizer is None:
            raise HTTPException(status_code=400, detail="Optimizer not initialized")
        
        total_iterations = init_points_global + n_iter_global
        best_target = optimizer.max["target"] if len(optimizer.space.target) > 0 else 0.0
        
        # Calculate exploration ratio
        if suggestion_count <= init_points_global:
            exploration_ratio = 1.0
        else:
            exploitation_iterations = suggestion_count - init_points_global
            max_exploitation_iterations = n_iter_global
            exploration_ratio = max(0.1, 1.0 - (exploitation_iterations / max_exploitation_iterations))
        
        return OptimizationStatus(
            iteration=suggestion_count,
            total_iterations=total_iterations,
            best_target=best_target,
            current_exploration_ratio=exploration_ratio
        )
        
    except Exception as e:
        logger.error(f"Error in status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/history")
def get_history():
    return {"history": optimization_history}

@app.get("/health")
def health_check():
    return {"status": "healthy", "version": "2.0.0-stable"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 