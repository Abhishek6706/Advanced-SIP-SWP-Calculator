"""Pydantic request/response schemas for the SIP-SWP Planner API.

Ranges here mirror the sliders in the UI so validation is enforced
server-side too (not just in the browser). ``ge``/``le`` bounds reject
out-of-range values with a 422 automatically.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# SIP
# --------------------------------------------------------------------------- #
class SIPRequest(BaseModel):
    """Inputs for a SIP (accumulation) simulation."""

    monthly_investment: float = Field(
        ..., ge=500, le=1_000_000, description="Monthly investment amount (₹)"
    )
    tenure_years: int = Field(..., ge=1, le=40, description="Investment tenure (years)")
    annual_return: float = Field(
        ..., ge=1, le=30, description="Expected annual return (%)"
    )
    inflation_rate: float = Field(
        ..., ge=0, le=15, description="General inflation rate (%)"
    )
    lifestyle_inflation: float = Field(
        ..., ge=0, le=20, description="Lifestyle inflation rate (%)"
    )
    step_up: float = Field(
        ..., ge=0, le=25, description="Annual SIP step-up increase (%)"
    )


class SIPYearPoint(BaseModel):
    year: int
    month_index: int
    monthly_investment: float
    invested: float
    invested_fully_adjusted: float
    nominal: float
    real: float
    lifestyle_adjusted: float
    fully_adjusted: float
    months: list[dict]


class SIPSummary(BaseModel):
    maturity_nominal: float
    maturity_real: float
    maturity_lifestyle_adjusted: float
    maturity_fully_adjusted: float
    total_invested: float
    wealth_gained: float
    tenure_years: int


class SIPResponse(BaseModel):
    summary: SIPSummary
    yearly: list[SIPYearPoint]


# --------------------------------------------------------------------------- #
# SWP
# --------------------------------------------------------------------------- #
class SWPRequest(BaseModel):
    """Inputs for a SWP (decumulation) simulation."""

    starting_corpus: float = Field(
        ..., ge=100_000, le=1_000_000_000, description="Starting corpus (₹, up to 100 Cr)"
    )
    monthly_withdrawal: float = Field(
        ..., ge=500, le=1_000_000, description="Monthly withdrawal amount (₹, up to 10 lakh)"
    )
    annual_return: float = Field(
        ..., ge=1, le=30, description="Expected annual return on remaining corpus (%)"
    )
    inflation_rate: float = Field(
        ..., ge=0, le=15, description="General inflation rate (%)"
    )
    lifestyle_inflation: float = Field(
        ..., ge=0, le=20, description="Annual withdrawal growth / lifestyle inflation (%)"
    )
    step_up: float = Field(
        default=0, ge=0, le=25, description="Extra annual withdrawal step-up (%)"
    )
    max_years: int = Field(
        default=50, ge=1, le=80, description="Maximum simulation horizon (years)"
    )


class SWPYearPoint(BaseModel):
    year: int
    month_index: int
    withdrawal: float
    remaining_nominal: float
    remaining_real: float
    cumulative_withdrawn: float
    starting_corpus: float
    depleted: bool
    months: list[dict]


class SWPSummary(BaseModel):
    depleted: bool
    longevity_years: int | None
    longevity_months: int | None
    total_longevity_months: int | None
    total_withdrawn: float
    final_corpus_nominal: float
    final_corpus_real: float
    sustains_indefinitely: bool
    starting_corpus: float


class SWPResponse(BaseModel):
    summary: SWPSummary
    yearly: list[SWPYearPoint]
