"""FastAPI application for the SIP-SWP Planner.

This module is intentionally thin: it only wires HTTP routes to the pure
simulation functions in :mod:`calculations`. All the maths lives there.

Endpoints
---------
POST /api/sip/simulate  -> SIPResponse
POST /api/swp/simulate  -> SWPResponse
GET  /api/health        -> {"status": "ok"}
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import calculations
from models import (
    SIPRequest,
    SIPResponse,
    SWPRequest,
    SWPResponse,
)

app = FastAPI(
    title="SIP-SWP Planner API",
    description="Calculation engine for SIP (accumulation) and SWP (decumulation).",
    version="1.0.0",
)

# The browser only ever talks to the Node/Express server, but CORS is left
# permissive here so the API is easy to exercise directly during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/sip/simulate", response_model=SIPResponse)
def simulate_sip(req: SIPRequest) -> SIPResponse:
    yearly = calculations.simulate_sip(req.model_dump())
    summary = calculations.sip_summary(yearly)
    return SIPResponse(summary=summary, yearly=yearly)


@app.post("/api/swp/simulate", response_model=SWPResponse)
def simulate_swp(req: SWPRequest) -> SWPResponse:
    yearly = calculations.simulate_swp(req.model_dump())
    summary = calculations.swp_summary(yearly)
    return SWPResponse(summary=summary, yearly=yearly)
