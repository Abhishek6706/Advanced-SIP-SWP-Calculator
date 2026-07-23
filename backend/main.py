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

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import calculations
from .models import (
    SIPRequest,
    SIPResponse,
    SWPRequest,
    SWPResponse,
)

# Static single-page frontend lives at <repo>/frontend/public. On Vercel the
# whole project is bundled into the function, so this path resolves there too.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public"

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


# Serve the static SPA (index.html, app.js, styles.css) from the same app so a
# single Vercel function handles both the API and the frontend. Mounted last so
# the explicit /api/* routes above take precedence; html=True serves index.html
# at "/" and for directory requests. Guarded so an API-only local run (without
# the frontend built) still starts cleanly.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
