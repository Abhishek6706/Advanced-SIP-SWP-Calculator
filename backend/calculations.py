"""Pure simulation engine for the SIP-SWP Planner.

This module contains **framework-free**, unit-testable functions that implement
the accumulation (SIP) and decumulation (SWP) simulations. No FastAPI / web code
lives here — everything is plain Python operating on dicts so it can be tested
directly with ``pytest``.

Key formulas
------------
Monthly rate from an annual return ``r`` (in percent)::

    monthly_rate = (1 + r / 100) ** (1 / 12) - 1

This is the *geometric* monthly rate so that 12 months of compounding reproduces
the annual return exactly (as opposed to the naive ``r / 12`` simple division).

SIP (accumulation)
    Simulated month-by-month. Each month the running corpus grows by the monthly
    rate and then the current monthly contribution is added. At the start of every
    year after the first, the contribution is stepped up by ``step_up`` percent so
    the step-up compounds correctly (a closed-form annuity formula cannot capture
    this cleanly, hence the explicit simulation).

SWP (decumulation)
    Simulated month-by-month. Each month::

        corpus = corpus * (1 + monthly_rate) - withdrawal

    The withdrawal amount itself is increased once a year by the lifestyle
    inflation rate, modelling a retiree who spends more each year to keep pace
    with rising lifestyle costs.

Inflation adjustments
    * Inflation-adjusted (real) value = nominal / (1 + infl) ** years_elapsed
    * Lifestyle-adjusted value        = nominal / (1 + life) ** years_elapsed
    * Fully-adjusted ("actual") value = nominal / ((1 + infl) ** y * (1 + life) ** y)
"""

from __future__ import annotations

from typing import Any


# Maximum number of years the SWP simulation will run before giving up and
# declaring the corpus "sustains indefinitely" within the modelled horizon.
DEFAULT_SWP_MAX_YEARS = 50


def _monthly_rate(annual_return_pct: float) -> float:
    """Convert an annual return percentage into a geometric monthly rate.

    Example: 12% annual -> (1.12) ** (1/12) - 1 ≈ 0.009489 (~0.95% / month).
    """
    return (1.0 + annual_return_pct / 100.0) ** (1.0 / 12.0) - 1.0


def simulate_sip(inputs: dict[str, Any]) -> list[dict[str, Any]]:
    """Simulate a Systematic Investment Plan month-by-month.

    Parameters
    ----------
    inputs : dict
        Expected keys:
            ``monthly_investment`` : float  -- starting monthly contribution (₹)
            ``tenure_years``       : int    -- number of years to invest (>= 1)
            ``annual_return``      : float  -- expected annual return (%)
            ``inflation_rate``     : float  -- general inflation rate (%)
            ``lifestyle_inflation``: float  -- lifestyle inflation rate (%)
            ``step_up``            : float  -- annual SIP increase (%)

    Returns
    -------
    list[dict]
        One entry per year (year 1 .. tenure) plus a ``months`` array inside
        each entry giving the month-by-month detail. Each yearly entry exposes:

            year, month_index (absolute month at year end),
            invested (cumulative principal),
            invested_fully_adjusted (principal deflated by both inflations),
            nominal (corpus value),
            real (inflation-adjusted),
            lifestyle_adjusted,
            fully_adjusted,
            monthly_investment (contribution used during that year)

    Notes
    -----
    The corpus is grown *before* the monthly contribution is added, which models
    a contribution made at the end of each month (ordinary annuity). The very
    first contribution therefore earns no return in its first month.
    """
    monthly_investment = float(inputs["monthly_investment"])
    tenure_years = int(inputs["tenure_years"])
    annual_return = float(inputs["annual_return"])
    inflation_rate = float(inputs["inflation_rate"])
    lifestyle_inflation = float(inputs["lifestyle_inflation"])
    step_up = float(inputs["step_up"])

    m_rate = _monthly_rate(annual_return)

    corpus = 0.0
    invested = 0.0
    current_contribution = monthly_investment

    yearly: list[dict[str, Any]] = []

    for year in range(1, tenure_years + 1):
        # Step up the contribution at the start of every year after the first.
        if year > 1 and step_up > 0:
            current_contribution *= 1.0 + step_up / 100.0

        months: list[dict[str, Any]] = []
        for month_in_year in range(1, 13):
            absolute_month = (year - 1) * 12 + month_in_year
            # Grow existing corpus, then add this month's contribution.
            corpus = corpus * (1.0 + m_rate) + current_contribution
            invested += current_contribution

            years_elapsed = absolute_month / 12.0
            infl_factor = (1.0 + inflation_rate / 100.0) ** years_elapsed
            life_factor = (1.0 + lifestyle_inflation / 100.0) ** years_elapsed

            months.append(
                {
                    "month": absolute_month,
                    "invested": round(invested, 2),
                    "invested_fully_adjusted": round(
                        invested / (infl_factor * life_factor), 2
                    ),
                    "nominal": round(corpus, 2),
                    "real": round(corpus / infl_factor, 2),
                    "lifestyle_adjusted": round(corpus / life_factor, 2),
                    "fully_adjusted": round(corpus / (infl_factor * life_factor), 2),
                }
            )

        last = months[-1]
        yearly.append(
            {
                "year": year,
                "month_index": last["month"],
                "monthly_investment": round(current_contribution, 2),
                "invested": last["invested"],
                "invested_fully_adjusted": last["invested_fully_adjusted"],
                "nominal": last["nominal"],
                "real": last["real"],
                "lifestyle_adjusted": last["lifestyle_adjusted"],
                "fully_adjusted": last["fully_adjusted"],
                "months": months,
            }
        )

    return yearly


def simulate_swp(inputs: dict[str, Any]) -> list[dict[str, Any]]:
    """Simulate a Systematic Withdrawal Plan month-by-month.

    Parameters
    ----------
    inputs : dict
        Expected keys:
            ``starting_corpus``    : float  -- lump sum at the start (₹)
            ``monthly_withdrawal`` : float  -- starting monthly withdrawal (₹)
            ``annual_return``      : float  -- expected return on remaining corpus (%)
            ``inflation_rate``     : float  -- general inflation rate (%)
            ``lifestyle_inflation``: float  -- annual growth of the withdrawal (%)
            ``step_up``            : float  -- extra annual withdrawal increase (%)
            ``max_years``          : int    -- optional horizon cap (default 50)

    Returns
    -------
    list[dict]
        One entry per simulated year. Each yearly entry exposes:

            year, month_index,
            withdrawal (monthly withdrawal used during that year),
            remaining_nominal (corpus at year end from the simulation),
            remaining_real (corpus deflated to today's terms),
            cumulative_withdrawn,
            depleted (bool), months (month-by-month detail)

    Notes
    -----
    The remaining corpus is taken **directly from the simulation** —
    ``corpus = corpus * (1 + monthly_rate) - withdrawal`` — never from a naive
    ``principal - total_withdrawn``. At the start of each year after the first
    the withdrawal grows by **both** the lifestyle inflation rate **and** the
    step-up rate (compounded together), letting the user deliberately draw a bit
    more each year on top of keeping pace with lifestyle costs. Simulation stops
    the month the corpus hits zero (flagged as depleted) or when ``max_years``
    is reached.
    """
    starting_corpus = float(inputs["starting_corpus"])
    monthly_withdrawal = float(inputs["monthly_withdrawal"])
    annual_return = float(inputs["annual_return"])
    inflation_rate = float(inputs["inflation_rate"])
    lifestyle_inflation = float(inputs["lifestyle_inflation"])
    step_up = float(inputs.get("step_up", 0.0))
    max_years = int(inputs.get("max_years", DEFAULT_SWP_MAX_YEARS))

    m_rate = _monthly_rate(annual_return)

    corpus = starting_corpus
    cumulative_withdrawn = 0.0
    current_withdrawal = monthly_withdrawal
    depleted = False

    yearly: list[dict[str, Any]] = []

    for year in range(1, max_years + 1):
        # From year 2 onward, grow the withdrawal by lifestyle inflation and the
        # step-up together (both compound year on year).
        if year > 1:
            current_withdrawal *= (
                (1.0 + lifestyle_inflation / 100.0) * (1.0 + step_up / 100.0)
            )

        months: list[dict[str, Any]] = []
        for month_in_year in range(1, 13):
            absolute_month = (year - 1) * 12 + month_in_year

            # Grow the remaining corpus, then withdraw for this month.
            corpus = corpus * (1.0 + m_rate) - current_withdrawal

            if corpus <= 0.0:
                # Only the portion actually available is withdrawn in the final
                # month; the corpus cannot go negative.
                actual_withdrawal = current_withdrawal + corpus  # corpus is <= 0
                if actual_withdrawal < 0.0:
                    actual_withdrawal = 0.0
                cumulative_withdrawn += actual_withdrawal
                corpus = 0.0
                depleted = True
            else:
                cumulative_withdrawn += current_withdrawal

            years_elapsed = absolute_month / 12.0
            infl_factor = (1.0 + inflation_rate / 100.0) ** years_elapsed

            months.append(
                {
                    "month": absolute_month,
                    "withdrawal": round(current_withdrawal, 2),
                    "remaining_nominal": round(corpus, 2),
                    "remaining_real": round(corpus / infl_factor, 2),
                    "cumulative_withdrawn": round(cumulative_withdrawn, 2),
                }
            )

            if depleted:
                break

        last = months[-1]
        yearly.append(
            {
                "year": year,
                "month_index": last["month"],
                "withdrawal": round(current_withdrawal, 2),
                "remaining_nominal": last["remaining_nominal"],
                "remaining_real": last["remaining_real"],
                "cumulative_withdrawn": last["cumulative_withdrawn"],
                "starting_corpus": round(starting_corpus, 2),
                "depleted": depleted,
                "months": months,
            }
        )

        if depleted:
            break

    return yearly


def sip_summary(yearly: list[dict[str, Any]]) -> dict[str, Any]:
    """Derive headline numbers for the SIP result set."""
    if not yearly:
        return {}
    last = yearly[-1]
    return {
        "maturity_nominal": last["nominal"],
        "maturity_real": last["real"],
        "maturity_lifestyle_adjusted": last["lifestyle_adjusted"],
        "maturity_fully_adjusted": last["fully_adjusted"],
        "total_invested": last["invested"],
        "wealth_gained": round(last["nominal"] - last["invested"], 2),
        "tenure_years": last["year"],
    }


def swp_summary(yearly: list[dict[str, Any]]) -> dict[str, Any]:
    """Derive headline numbers for the SWP result set (longevity, totals)."""
    if not yearly:
        return {}
    last = yearly[-1]
    depleted = last["depleted"]

    # Longevity: find the exact month of depletion if it happened.
    longevity_months = last["month_index"] if depleted else None

    return {
        "depleted": depleted,
        "longevity_years": (longevity_months // 12) if depleted else None,
        "longevity_months": (longevity_months % 12) if depleted else None,
        "total_longevity_months": longevity_months,
        "total_withdrawn": last["cumulative_withdrawn"],
        "final_corpus_nominal": last["remaining_nominal"],
        "final_corpus_real": last["remaining_real"],
        "sustains_indefinitely": not depleted,
        "starting_corpus": last["starting_corpus"],
    }
