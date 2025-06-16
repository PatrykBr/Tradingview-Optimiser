from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Tuple, Any, Optional, List, Union
from bayes_opt import BayesianOptimization, acquisition
from sklearn.gaussian_process.kernels import Matern, RBF, WhiteKernel
import numpy as np
import logging
import random

# Configure logging with state tracking (v3.0.0 feature)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# In-memory storage for optimizer instances
optimizer: Optional[BayesianOptimization] = None
acquisition_function: Optional[object] = None
init_points_global: int = 0
n_iter_global: int = 0
suggestion_count: int = 0
pbounds_global: Dict[str, Tuple[float, float]] = {}
optimization_history: List[Dict] = []

class InitRequest(BaseModel):
    pbounds: Dict[str, Tuple[float, float]]
    init_points: int
    n_iter: int
    acquisition_type: Optional[str] = "ucb"  # ucb, ei, poi
    kappa: Optional[float] = 2.576  # UCB exploration parameter
    xi: Optional[float] = 0.01  # EI exploration parameter
    alpha: Optional[float] = 1e-6  # GP noise parameter
    n_restarts_optimizer: Optional[int] = 5  # GP optimization restarts
    kernel_type: Optional[str] = "matern"  # matern, rbf
    random_state: Optional[int] = 42  # For reproducibility

class ObserveRequest(BaseModel):
    params: Dict[str, float]
    target: float

class SuggestResponse(BaseModel):
    params: Dict[str, float]
    done: bool
    acquisition_value: Optional[float] = None
    confidence_interval: Optional[Tuple[float, float]] = None

class BestResponse(BaseModel):
    params: Dict[str, float]
    target: float
    confidence_interval: Optional[Tuple[float, float]] = None

class OptimizationStatus(BaseModel):
    iteration: int
    total_iterations: int
    best_target: float
    current_exploration_ratio: float
    gp_score: Optional[float] = None

def create_acquisition_function(acq_type: str, kappa: float = 2.576, xi: float = 0.01):
    """Create the appropriate acquisition function (v3.0.0 compatible)"""
    if acq_type.lower() == "ucb":
        return acquisition.UpperConfidenceBound(kappa=kappa)
    elif acq_type.lower() == "ei":
        return acquisition.ExpectedImprovement(xi=xi)
    elif acq_type.lower() == "poi":
        return acquisition.ProbabilityOfImprovement(xi=xi)
    else:
        logger.warning(f"Unknown acquisition type {acq_type}, defaulting to UCB")
        return acquisition.UpperConfidenceBound(kappa=kappa)

def create_kernel(kernel_type: str, n_dims: int):
    """Create the appropriate kernel for the GP"""
    if kernel_type.lower() == "rbf":
        return RBF(length_scale=1.0, length_scale_bounds=(1e-2, 1e2))
    elif kernel_type.lower() == "matern":
        return Matern(length_scale=1.0, length_scale_bounds=(1e-2, 1e2), nu=2.5)
    else:
        logger.warning(f"Unknown kernel type {kernel_type}, defaulting to Matern")
        return Matern(length_scale=1.0, length_scale_bounds=(1e-2, 1e2), nu=2.5)

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

@app.post("/init", response_model=SuggestResponse)
def init(req: InitRequest):
    global optimizer, acquisition_function, init_points_global, n_iter_global, suggestion_count, pbounds_global, optimization_history
    
    logger.info(f"Initializing optimizer with {req.acquisition_type} acquisition, alpha={req.alpha}")
    
    # Reset all global state
    optimizer = None
    pbounds_global = req.pbounds
    init_points_global = req.init_points
    n_iter_global = req.n_iter
    suggestion_count = 1
    optimization_history = []
    
    # Create acquisition function
    acquisition_function = create_acquisition_function(
        req.acquisition_type, req.kappa, req.xi
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
    params = coerce_params(raw)
    
    logger.info(f"First suggestion: {params}")
    
    return SuggestResponse(
        params=params, 
        done=False,
        acquisition_value=0.0,  # Random sample has no acquisition value
        confidence_interval=None
    )

@app.post("/observe", response_model=SuggestResponse)
def observe(req: ObserveRequest):
    global optimizer, suggestion_count, optimization_history
    
    if optimizer is None:
        raise HTTPException(status_code=400, detail="Optimizer not initialized")
    
    logger.info(f"Observing: params={req.params}, target={req.target}")
    
    # Register the observed point using Suggest-Evaluate-Register paradigm
    optimizer.register(params=req.params, target=req.target)
    
    # Add to optimization history
    optimization_history.append({
        "iteration": suggestion_count,
        "params": req.params,
        "target": req.target,
        "is_best": req.target >= max([h["target"] for h in optimization_history] + [req.target])
    })
    
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
    
    # Coerce parameters and get confidence interval
    params = coerce_params(raw)
    confidence_interval = get_confidence_interval(params)
    
    logger.info(f"Next suggestion: {params}, acquisition_value: {acquisition_val:.4f}")
    
    return SuggestResponse(
        params=params, 
        done=False,
        acquisition_value=acquisition_val,
        confidence_interval=confidence_interval
    )

@app.get("/best", response_model=BestResponse)
def best():
    global optimizer
    if optimizer is None:
        raise HTTPException(status_code=400, detail="Optimizer not initialized")
    
    if len(optimizer.res) == 0:
        raise HTTPException(status_code=400, detail="No observations recorded yet")
    
    best_result = optimizer.max
    params = coerce_params(best_result['params'])
    confidence_interval = get_confidence_interval(params)
    
    logger.info(f"Best result: {params}, target: {best_result['target']}")
    
    return BestResponse(
        params=params, 
        target=best_result['target'],
        confidence_interval=confidence_interval
    )

@app.get("/status", response_model=OptimizationStatus)
def status():
    """Get current optimization status and diagnostics"""
    global optimizer, optimization_history
    
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
    
    return OptimizationStatus(
        iteration=current_iteration,
        total_iterations=total_iterations,
        best_target=best_target,
        current_exploration_ratio=exploration_ratio,
        gp_score=gp_score
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

# Version info endpoint (new in v3.0.0)
@app.get("/version")
def version_info():
    import bayes_opt
    return {
        "server_version": "3.0.0",
        "bayes_opt_version": bayes_opt.__version__ if hasattr(bayes_opt, '__version__') else "3.0.0",
        "features": [
            "typed_optimization", 
            "advanced_logging", 
            "confidence_intervals", 
            "latin_hypercube_sampling",
            "suggest_evaluate_register"
        ]
    }

# Utility to run via: uvicorn opt_server:app --reload 