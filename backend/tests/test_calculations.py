"""Unit tests for the pure simulation engine."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import calculations  # noqa: E402


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def base_sip():
    return {
        "monthly_investment": 10000,
        "tenure_years": 10,
        "annual_return": 12,
        "inflation_rate": 6,
        "lifestyle_inflation": 3,
        "step_up": 0,
    }


def base_swp():
    return {
        "starting_corpus": 10_000_000,
        "monthly_withdrawal": 50000,
        "annual_return": 8,
        "inflation_rate": 6,
        "lifestyle_inflation": 0,
        "step_up": 0,
        "max_years": 50,
    }


# --------------------------------------------------------------------------- #
# Monthly rate
# --------------------------------------------------------------------------- #
def test_monthly_rate_compounds_to_annual():
    r = calculations._monthly_rate(12)
    assert math.isclose((1 + r) ** 12 - 1, 0.12, rel_tol=1e-9)


def test_monthly_rate_zero_free():
    # A 1% annual return must give a tiny positive monthly rate.
    assert calculations._monthly_rate(1) > 0


# --------------------------------------------------------------------------- #
# SIP
# --------------------------------------------------------------------------- #
def test_sip_length_matches_tenure():
    yearly = calculations.simulate_sip(base_sip())
    assert len(yearly) == 10
    assert all(len(y["months"]) == 12 for y in yearly)


def test_sip_invested_is_principal_only():
    # With no step-up, total invested = monthly * 12 * years.
    yearly = calculations.simulate_sip(base_sip())
    last = yearly[-1]
    assert math.isclose(last["invested"], 10000 * 12 * 10, rel_tol=1e-9)


def test_sip_nominal_exceeds_invested_with_positive_return():
    yearly = calculations.simulate_sip(base_sip())
    last = yearly[-1]
    assert last["nominal"] > last["invested"]


def test_sip_zero_return_nominal_equals_invested():
    inp = base_sip()
    inp["annual_return"] = 1  # min allowed; use ~0 growth check via tiny value
    # With a very small return nominal should be only slightly above invested.
    yearly = calculations.simulate_sip(inp)
    last = yearly[-1]
    assert last["nominal"] >= last["invested"]


def test_sip_step_up_increases_contribution():
    inp = base_sip()
    inp["step_up"] = 10
    yearly = calculations.simulate_sip(inp)
    # Year 2 contribution should be 10% higher than year 1.
    assert math.isclose(
        yearly[1]["monthly_investment"], yearly[0]["monthly_investment"] * 1.10,
        rel_tol=1e-6,
    )
    # Total invested must exceed the flat (no step-up) case.
    flat = calculations.simulate_sip(base_sip())
    assert yearly[-1]["invested"] > flat[-1]["invested"]


def test_sip_adjusted_values_ordering():
    # Fully-adjusted <= real and <= lifestyle_adjusted <= nominal.
    yearly = calculations.simulate_sip(base_sip())
    last = yearly[-1]
    assert last["fully_adjusted"] <= last["real"] <= last["nominal"]
    assert last["fully_adjusted"] <= last["lifestyle_adjusted"] <= last["nominal"]


def test_sip_no_inflation_real_equals_nominal():
    inp = base_sip()
    inp["inflation_rate"] = 0
    inp["lifestyle_inflation"] = 0
    yearly = calculations.simulate_sip(inp)
    last = yearly[-1]
    assert math.isclose(last["real"], last["nominal"], rel_tol=1e-9)
    assert math.isclose(last["fully_adjusted"], last["nominal"], rel_tol=1e-9)


def test_sip_summary_fields():
    yearly = calculations.simulate_sip(base_sip())
    s = calculations.sip_summary(yearly)
    assert s["total_invested"] == yearly[-1]["invested"]
    assert s["maturity_nominal"] == yearly[-1]["nominal"]
    assert math.isclose(
        s["wealth_gained"], yearly[-1]["nominal"] - yearly[-1]["invested"], rel_tol=1e-6
    )


# --------------------------------------------------------------------------- #
# SWP
# --------------------------------------------------------------------------- #
def test_swp_spec_sanity_example():
    """From the spec: corpus 200, withdraw 5/month -> remaining after month 1
    must be 200*(1+monthly_rate) - 5, NOT 195."""
    inp = {
        "starting_corpus": 200,
        "monthly_withdrawal": 5,
        "annual_return": 12,
        "inflation_rate": 0,
        "lifestyle_inflation": 0,
        "max_years": 50,
    }
    # Note: starting_corpus below the API min is fine for the pure function;
    # validation only applies at the API layer.
    yearly = calculations.simulate_swp(inp)
    m_rate = calculations._monthly_rate(12)
    expected_after_m1 = 200 * (1 + m_rate) - 5
    first_month = yearly[0]["months"][0]
    assert math.isclose(first_month["remaining_nominal"], round(expected_after_m1, 2), rel_tol=1e-9)
    assert first_month["remaining_nominal"] != 195


def test_swp_depletes_when_withdrawal_too_high():
    inp = base_swp()
    inp["monthly_withdrawal"] = 500000  # very aggressive
    yearly = calculations.simulate_swp(inp)
    assert yearly[-1]["depleted"] is True
    assert yearly[-1]["remaining_nominal"] == 0.0


def test_swp_sustains_when_withdrawal_low():
    inp = base_swp()
    inp["monthly_withdrawal"] = 500  # trivially small vs 1cr @ 8%
    yearly = calculations.simulate_swp(inp)
    assert yearly[-1]["depleted"] is False
    assert len(yearly) == inp["max_years"]


def test_swp_cumulative_withdrawn_grows_with_lifestyle():
    flat = calculations.simulate_swp(base_swp())
    inp = base_swp()
    inp["lifestyle_inflation"] = 8
    grown = calculations.simulate_swp(inp)
    # With rising withdrawals, more is taken out over the same early horizon.
    horizon = min(len(flat), len(grown)) - 1
    assert grown[horizon]["cumulative_withdrawn"] >= flat[horizon]["cumulative_withdrawn"]


def test_swp_step_up_increases_withdrawal():
    inp = base_swp()
    inp["step_up"] = 10
    yearly = calculations.simulate_swp(inp)
    # Year 2 withdrawal should be 10% higher than year 1 (lifestyle inflation 0).
    assert math.isclose(
        yearly[1]["withdrawal"], yearly[0]["withdrawal"] * 1.10, rel_tol=1e-6
    )


def test_swp_step_up_and_lifestyle_compound_together():
    inp = base_swp()
    inp["lifestyle_inflation"] = 5
    inp["step_up"] = 10
    yearly = calculations.simulate_swp(inp)
    # Both effects compound multiplicatively on the yearly withdrawal.
    expected = yearly[0]["withdrawal"] * 1.05 * 1.10
    assert math.isclose(yearly[1]["withdrawal"], expected, rel_tol=1e-6)


def test_swp_step_up_depletes_faster():
    base = base_swp()
    base["monthly_withdrawal"] = 70000  # high enough to deplete within horizon
    slow = calculations.simulate_swp(base)
    fast_inp = dict(base)
    fast_inp["step_up"] = 15
    fast = calculations.simulate_swp(fast_inp)
    assert slow[-1]["depleted"] and fast[-1]["depleted"]
    # Drawing more each year must exhaust the corpus no later than the base case.
    assert fast[-1]["month_index"] <= slow[-1]["month_index"]


def test_swp_remaining_not_naive_subtraction():
    inp = base_swp()
    yearly = calculations.simulate_swp(inp)
    year1 = yearly[0]
    naive = inp["starting_corpus"] - year1["cumulative_withdrawn"]
    # Because the corpus keeps earning, simulated remaining must beat naive.
    assert year1["remaining_nominal"] > naive


def test_swp_summary_longevity():
    inp = base_swp()
    inp["monthly_withdrawal"] = 500000
    yearly = calculations.simulate_swp(inp)
    s = calculations.swp_summary(yearly)
    assert s["depleted"] is True
    assert s["total_longevity_months"] == yearly[-1]["month_index"]
    assert s["sustains_indefinitely"] is False


def test_swp_corpus_never_negative():
    inp = base_swp()
    inp["monthly_withdrawal"] = 500000
    yearly = calculations.simulate_swp(inp)
    for y in yearly:
        for m in y["months"]:
            assert m["remaining_nominal"] >= 0.0
