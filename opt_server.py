from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Tuple, Any, Optional
from bayes_opt import BayesianOptimization
import random  # add at top

app = FastAPI()

# In-memory storage for a single optimizer instance
optimizer: Optional[BayesianOptimization] = None
init_points_global: int = 0
n_iter_global: int = 0
suggestion_count: int = 0
pbounds_global: Dict[str, Tuple[float, float]] = {}

class InitRequest(BaseModel):
    pbounds: Dict[str, Tuple[float, float]]
    init_points: int
    n_iter: int

class ObserveRequest(BaseModel):
    params: Dict[str, float]
    target: float

class SuggestResponse(BaseModel):
    params: Dict[str, float]
    done: bool

class BestResponse(BaseModel):
    params: Dict[str, float]
    target: float

# helper to generate a random sample within bounds
def random_sample():
    return {k: random.uniform(v[0], v[1]) for k, v in pbounds_global.items()}

# Helper to coerce parameters to int when bounds are integer-valued
def coerce_params(raw_params):
    coerced = {}
    for k, v in raw_params.items():
        lo, hi = pbounds_global[k]
        # if both bounds are whole numbers, treat this parameter as integer
        if float(lo).is_integer() and float(hi).is_integer():
            coerced[k] = int(round(v))
        else:
            coerced[k] = v
    return coerced

@app.post("/init", response_model=SuggestResponse)
def init(req: InitRequest):
    global optimizer, init_points_global, n_iter_global, suggestion_count, pbounds_global
    # Always initialize a fresh optimizer instance
    optimizer = None
    pbounds_global = req.pbounds
    init_points_global = req.init_points
    n_iter_global = req.n_iter
    suggestion_count = 1
    optimizer = BayesianOptimization(
        f=lambda **kwargs: None,
        pbounds=pbounds_global,
        verbose=0,
        random_state=1,
        allow_duplicate_points=True,
    )
    # Return first random suggestion with proper integer coercion
    raw = random_sample()
    params = coerce_params(raw)
    return {"params": params, "done": False}

@app.post("/observe", response_model=SuggestResponse)
def observe(req: ObserveRequest):
    global optimizer, suggestion_count
    if optimizer is None:
        raise HTTPException(status_code=400, detail="Optimizer not initialized")
    # Register the observed target
    optimizer.register(params=req.params, target=req.target)
    suggestion_count += 1
    # Decide next suggestion
    if suggestion_count <= init_points_global:
        raw = random_sample()
    elif suggestion_count <= init_points_global + n_iter_global:
        raw = optimizer.suggest()
    else:
        return {"params": {}, "done": True}
    params = coerce_params(raw)
    return {"params": params, "done": False}

@app.get("/best", response_model=BestResponse)
def best():
    global optimizer
    if optimizer is None:
        raise HTTPException(status_code=400, detail="Optimizer not initialized")
    best = optimizer.max
    params = coerce_params(best['params'])
    return {"params": params, "target": best['target']}

# Utility to run via: uvicorn opt_server:app --reload 