# Prompt: Advanced SIP + SWP Financial Calculator

Copy everything below into Claude Code / Opus.

---

## Project Goal

Build a single-page web app called **"SIP-SWP Planner"** — an advanced financial calculator with two linked modules:

1. **SIP (Systematic Investment Plan)** — accumulation phase
2. **SWP (Systematic Withdrawal Plan)** — decumulation phase, which can optionally inherit its starting corpus and assumptions directly from the SIP module

Every numeric input must be controlled by **both a slider and a directly-editable number field**, kept in sync (dragging the slider updates the number box live, and typing a number moves the slider, with validation/clamping to min-max range).

---

## Tech Stack

- **Backend (calculation engine)**: Python + FastAPI
  - All SIP/SWP simulation logic lives in Python, in a dedicated `calculations.py` module (pure functions, unit-testable with `pytest`, no web/framework code inside).
  - Expose two REST endpoints: `POST /api/sip/simulate` and `POST /api/swp/simulate`, each accepting a JSON body of inputs and returning year-by-year (and month-by-month) simulation arrays as JSON.
  - Use Pydantic models for request/response validation (min/max ranges enforced server-side too, not just in the UI).
- **Frontend/server (UI)**: Node.js + Express serving a static frontend (plain HTML/CSS/JavaScript — no frontend framework needed).
  - Express serves the static files and proxies/forwards calculation requests to the Python FastAPI service (so the browser only ever talks to the Node server).
  - Use vanilla JS (or lightweight helper libraries only if needed) to build the slider/number-input components and wire them up.
  - Use **Chart.js** (via CDN or npm) for the line charts instead of Recharts.
- Run both services locally: FastAPI on one port (e.g., 8000), Express on another (e.g., 3000), with Express calling FastAPI via `fetch`/`axios`. Include a simple root-level `README.md` explaining how to start both (e.g., `uvicorn` for Python, `node server.js` or `npm start` for Node), and a `package.json` + `requirements.txt` for dependencies.
- State/recalculation: on any slider/input change in the browser, debounce and call the Node backend, which calls Python, and re-render the charts and summary cards with the returned data. Avoid recalculating on every single pixel of slider drag — throttle to something like every 100-150ms.

---

## Module 1: SIP Inputs

Each input below needs: label, slider, synced number input, and a sensible min/max/step.

| Input | Suggested Range | Step |
|---|---|---|
| Monthly Investment Amount | ₹500 – ₹10,00,000 | 500 |
| Tenure (years) | 1 – 40 | 1 |
| Expected Annual Return (%) | 1 – 30 | 0.1 |
| Inflation Rate (%) | 0 – 15 | 0.1 |
| Lifestyle Inflation Rate (%) | 0 – 20 | 0.1 |
| Auto Step-Up (annual increase in SIP amount, %) | 0 – 25 | 0.5 |

### SIP Calculation Logic

- **Auto Step-Up**: at the start of each subsequent year, increase the monthly SIP contribution by the step-up %. Do NOT assume a closed-form annuity formula — simulate month-by-month (or year-by-year with monthly compounding inside each year) so step-up compounds correctly.
- Monthly rate = `(1 + annualReturn/100)^(1/12) - 1`
- Track and expose, for every year (and month) of the simulation:
  - **Nominal corpus value** (actual ₹ accumulated)
  - **Total amount invested so far** (principal only, for reference)
  - **Inflation-adjusted (real) value** = nominal value ÷ `(1 + inflationRate/100)^yearsElapsed`
  - **Lifestyle-inflation-adjusted value** = nominal value ÷ `(1 + lifestyleInflationRate/100)^yearsElapsed`
  - **Fully-adjusted ("actual") value** = nominal value ÷ `[(1 + inflationRate/100)^yearsElapsed × (1 + lifestyleInflationRate/100)^yearsElapsed]` — this compounds both general inflation and lifestyle inflation together, representing the realistic purchasing power of the corpus after both effects are accounted for.
- Final output: nominal maturity value, real value (CPI-adjusted), and lifestyle-adjusted value at end of tenure.

### SIP Chart

Line chart, X-axis = years (or months, with a toggle if easy to add), showing **four lines together on one chart**:
1. Cumulative principal invested (total ₹ put in so far, no growth — a straight reference line for "money in")
2. Nominal corpus growth
3. Inflation-adjusted (real) growth
4. Lifestyle-inflation-adjusted growth

This lets the user visually compare how much they've actually invested against nominal growth and both inflation-adjusted views, all on the same timeline. Use distinct colors/line styles per line and a clear legend. Add tooltips on hover showing the exact ₹ value for each line at that year/month.

### SIP Chart 2: Principal vs Fully-Adjusted ("Actual") Value

A second, simpler line chart with just **two lines**:
1. Cumulative principal invested
2. Fully-adjusted ("actual") value — the nominal corpus after both general inflation AND lifestyle inflation have been compounded together (see the "Fully-adjusted" formula above)

Purpose: this chart directly answers "how much did I put in vs. what is it really worth today after both kinds of inflation eat into it," without the visual noise of the other lines. Shade the area between the two lines to make the gap visually obvious, and display the final-year gap as a callout number (e.g., "Invested: ₹X · Real worth after inflation: ₹Y").

---

## Module 2: SWP Inputs

| Input | Behavior |
|---|---|
| **Starting Corpus** | Radio/toggle: "Use SIP final value" vs "Enter manually". If "Use SIP final value" is selected, auto-populate from the SIP module's final nominal corpus (live-updating if SIP inputs change) and disable the slider (read-only display). If "Enter manually" is selected, show a normal slider + number input (range e.g. ₹1,00,000 – ₹10,00,00,000). |
| **Monthly Withdrawal Amount** | Slider + number input, e.g. ₹500 – ₹5,00,000 |
| **Expected Annual Return (on remaining corpus)** | Slider + number input, 1–30%, independent of SIP's return rate |
| **Inflation Rate** | If SIP module has been used to feed the corpus, **default to and lock to SIP's inflation rate value** (show it as inherited, with a small "unlock to override" option). If SIP is NOT feeding the corpus (manual entry chosen), show a normal independent slider + input. |
| **Lifestyle Inflation Rate** | Same inheritance rule as Inflation Rate above — inherit from SIP if SIP is the corpus source, otherwise independent slider + input. |

### SWP Calculation Logic

- Simulate month-by-month depletion of the corpus:
  - Each month: `corpus = corpus * (1 + monthlyReturn) - withdrawalAmount`
  - The **withdrawal amount itself should increase annually by the (inherited or manual) lifestyle inflation rate** — i.e., simulate the real-world behavior that a person withdraws more each year to keep pace with their lifestyle costs. State this assumption clearly in a UI tooltip/info icon so the user understands why withdrawal isn't flat.
  - Stop simulation when corpus hits zero (flag "corpus exhausted in Year X, Month Y") or when it reaches a configured max horizon (e.g., 50 years), whichever comes first.
- Track for every year (and month):
  - Remaining nominal corpus
  - Remaining corpus in today's terms (deflated by general inflation rate)
  - Cumulative amount withdrawn so far
- Output: corpus longevity (years/months until depletion, or "sustains indefinitely" if corpus never goes to zero within horizon), total withdrawn, and final corpus value if not depleted.

### SWP Chart

Line chart, X-axis = years/months, showing:
1. Remaining nominal corpus over time
2. Remaining corpus in inflation-adjusted (real) terms
3. (Optional but nice) cumulative withdrawals line

Clearly mark the depletion point on the chart if the corpus runs out before the horizon ends.

### SWP Chart 2: Principal vs Redeemed vs Remaining (Bar Chart)

A **bar chart** (grouped or stacked — grouped preferred for clarity) with X-axis = year, showing three bars/segments per year:
1. **Principal (starting corpus)** — a flat reference value, same every year, i.e. the original amount that went into SWP
2. **Redeemed so far** — cumulative amount withdrawn up to that year
3. **Remaining corpus** — nominal corpus left at the end of that year

This gives an at-a-glance view of how the original lump sum is being drawn down year by year, alongside how much has already been taken out and how much is left.

**Important — values must be the simulated (resultant) values, not naive arithmetic:** "Remaining corpus" is NOT `principal − total withdrawn so far`. It must come directly from the month-by-month simulation (`corpus = corpus × (1 + monthlyReturn) − withdrawalAmount`, repeated), so it correctly reflects the corpus still earning returns while being drawn down. Similarly, "Redeemed so far" is the actual cumulative sum of withdrawals taken — which grows year over year if lifestyle inflation is increasing the withdrawal amount, so don't assume a flat `withdrawalAmount × monthsElapsed` either. Only "Principal" is a static, unaffected number (the original starting corpus). Example to sanity-check the implementation: starting corpus ₹200, withdrawing ₹5/month — the "Remaining" value after month 1 should be `200 × (1 + monthlyReturn) − 5`, NOT `195`.

If using stacked bars, make sure "Redeemed" + "Remaining" visually relates back to how it compares against the flat "Principal" bar/line (e.g., render Principal as a dashed reference line overlaid on the stacked bars rather than a third stacked segment, so it doesn't double-count). Include a tooltip per bar showing exact ₹ values, and highlight the year of depletion (if any) directly on this chart too.

---

## UI/UX Requirements

- Two clearly separated sections/tabs: "SIP" and "SWP", but SWP should visibly show its live link to SIP (e.g., a small badge: "Corpus linked to SIP: ₹X" with an unlink toggle).
- All sliders should have their current value displayed next to them at all times, not just on drag.
- Debounce/optimize recalculation so dragging sliders feels smooth (use `useMemo` for derived chart data).
- Responsive layout — should work reasonably on both desktop and mobile widths.
- Use ₹ (INR) formatting with commas (e.g., ₹12,34,567) — Indian numbering system, not Western.
- Add a summary card above each chart with key numbers (maturity value, real value, corpus longevity, etc.) in large, easy-to-read text.

---

## Validation / Edge Cases to Handle

- Prevent negative or zero values where nonsensical (e.g., tenure ≥ 1 year, return rate not negative unless you intentionally allow it).
- If SWP monthly withdrawal × 12 > reasonable % of corpus × expected return, still allow it — just let the simulation show fast depletion (this is a valid/valuable scenario, don't block it).
- If SIP inputs change after SWP has "linked" to it, SWP's corpus and inherited inflation values should reactively update.
- Handle the "unlink" case gracefully — when a user switches from SIP-linked to manual entry, pre-fill the manual slider with the last known SIP value as a convenience starting point, but make it fully independent from then on.

---

## Deliverables

1. A working two-service app with this rough structure:
   ```
   /backend
     main.py              # FastAPI app, routes only
     calculations.py       # simulateSIP(), simulateSWP() — pure functions
     models.py              # Pydantic request/response schemas
     requirements.txt
     tests/
       test_calculations.py
   /frontend
     server.js              # Express static server + proxy to FastAPI
     package.json
     public/
       index.html
       styles.css
       app.js               # slider/input sync, fetch calls, Chart.js rendering
   README.md
   ```
2. `calculations.py` with pure, documented functions:
   - `simulate_sip(inputs: dict) -> list[dict]`
   - `simulate_swp(inputs: dict) -> list[dict]`
   - Include type hints and docstrings explaining the formulas used.
3. A reusable slider+number-input JS component/pattern in `app.js` (not tied to any framework) used consistently for every input across both panels.
4. Brief root `README.md` explaining: how to install and run both services, the formulas/assumptions used (especially around lifestyle inflation driving SWP withdrawal growth, and step-up driving SIP contribution growth), and the API contract between Node and FastAPI.

If any requirement above is ambiguous or you think a different reasonable assumption fits standard SIP/SWP calculator conventions better, state your assumption clearly in the README rather than silently guessing.
