# SIP-SWP Planner

An advanced financial calculator with two linked modules:

- **SIP (Systematic Investment Plan)** — the accumulation phase.
- **SWP (Systematic Withdrawal Plan)** — the decumulation phase, which can
  optionally inherit its starting corpus and inflation assumptions directly
  from the SIP module.

Every numeric input is controlled by **both a slider and a synced, editable
number field** (drag the slider → the number updates live; type a number → the
slider moves, with clamping to the min/max range).

---

## Architecture

```
Browser  ──▶  Node / Express (:3000)  ──▶  Python / FastAPI (:8000)
             serves static SPA +           pure calculation engine
             proxies /api/* calls          (calculations.py)
```

The browser **only ever talks to the Node server**. Express serves the static
frontend and forwards `/api/sip/simulate` and `/api/swp/simulate` to FastAPI.

```
requirements.txt        Python deps (project root, shared)
venv/                   Python virtual environment (project root)
/backend
  main.py               FastAPI app — routes only (thin)
  calculations.py       simulate_sip() / simulate_swp() — pure functions
  models.py             Pydantic request/response schemas (range validation)
  tests/
    test_calculations.py
/frontend
  server.js             Express static server + proxy to FastAPI
  package.json
  public/
    index.html
    styles.css
    app.js              slider/number sync, fetch calls, Chart.js rendering
README.md
```

---

## Running locally

You need **Python 3.10+** and **Node 18+** (for the built-in `fetch`).

### 1. Backend (FastAPI)

The `venv` and `requirements.txt` live at the **project root** (shared), so
create the environment there, then start uvicorn from inside `backend/`:

```bash
# from the project root
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cd backend
uvicorn main:app --reload --port 8000
```

FastAPI is now on <http://127.0.0.1:8000> (interactive docs at `/docs`).

### 2. Frontend (Express)

In a second terminal:

```bash
cd frontend
npm install
npm start                         # node server.js
```

Open <http://localhost:3000>.

Environment overrides (optional):

- `PORT` — Express port (default `3000`).
- `FASTAPI_URL` — FastAPI base URL (default `http://127.0.0.1:8000`).

### Running the tests

```bash
# from the project root
source venv/bin/activate
cd backend
python -m pytest tests/ -q
```

---

## API contract (Node ↔ FastAPI)

Both endpoints accept a JSON body and return `{ summary, yearly }`. `yearly` is
an array with one entry per year; each entry also carries a `months` array with
month-by-month detail.

### `POST /api/sip/simulate`

Request:

```json
{
  "monthly_investment": 25000,
  "tenure_years": 15,
  "annual_return": 12,
  "inflation_rate": 6,
  "lifestyle_inflation": 3,
  "step_up": 10
}
```

Response (abridged):

```json
{
  "summary": {
    "maturity_nominal": 0,
    "maturity_real": 0,
    "maturity_lifestyle_adjusted": 0,
    "maturity_fully_adjusted": 0,
    "total_invested": 0,
    "wealth_gained": 0,
    "tenure_years": 15
  },
  "yearly": [
    {
      "year": 1,
      "month_index": 12,
      "monthly_investment": 25000,
      "invested": 0,
      "nominal": 0,
      "real": 0,
      "lifestyle_adjusted": 0,
      "fully_adjusted": 0,
      "months": [ { "month": 1, "invested": 0, "nominal": 0, "real": 0, "lifestyle_adjusted": 0, "fully_adjusted": 0 } ]
    }
  ]
}
```

### `POST /api/swp/simulate`

Request:

```json
{
  "starting_corpus": 10000000,
  "monthly_withdrawal": 60000,
  "annual_return": 8,
  "inflation_rate": 6,
  "lifestyle_inflation": 5,
  "step_up": 0,
  "max_years": 50
}
```

Response `summary` includes corpus longevity (`longevity_years` /
`longevity_months` or `sustains_indefinitely`), `total_withdrawn`, and the
final corpus in nominal and real terms. Each `yearly` entry carries
`remaining_nominal`, `remaining_real`, `cumulative_withdrawn`,
`starting_corpus`, and a `depleted` flag.

Input ranges are validated **server-side** with Pydantic (mirroring the UI
sliders), so out-of-range values return HTTP `422`.

---

## Formulas & assumptions

### Monthly rate

The annual return `r%` is converted to a **geometric** monthly rate:

```
monthly_rate = (1 + r/100) ^ (1/12) − 1
```

so 12 months of compounding reproduce the annual return exactly (rather than the
naive `r/12`).

### SIP (accumulation) — simulated month-by-month

- Each month the corpus grows by `monthly_rate`, then the current monthly
  contribution is added (end-of-month / ordinary annuity: the first
  contribution earns no return in its first month).
- **Auto step-up:** at the start of each year after the first, the monthly
  contribution is multiplied by `(1 + step_up/100)`, so the step-up **compounds**
  year on year. This is why the simulation is explicit rather than a closed-form
  annuity formula.
- Reported per year/month:
  - **Nominal corpus** — actual ₹ accumulated.
  - **Total invested** — cumulative principal only.
  - **Real (inflation-adjusted)** = `nominal / (1 + infl/100) ^ years_elapsed`.
  - **Lifestyle-adjusted** = `nominal / (1 + life/100) ^ years_elapsed`.
  - **Fully-adjusted ("actual")** =
    `nominal / [(1 + infl/100)^y × (1 + life/100)^y]` — both inflations
    compounded together; the realistic purchasing power of the corpus.

### SWP (decumulation) — simulated month-by-month

- Each month: `corpus = corpus × (1 + monthly_rate) − withdrawal`.
- The **withdrawal grows once a year** by the lifestyle inflation rate **and** an
  optional **step-up** rate — the two compound together:
  `withdrawal ×= (1 + lifestyle/100) × (1 + step_up/100)`. Lifestyle inflation
  keeps withdrawals in pace with rising costs; the step-up is a deliberate extra
  increase so you can draw a little more each year. Withdrawals are therefore
  **not flat** (explained in a UI tooltip).
- Simulation stops the month the corpus hits zero (flagged
  *"corpus exhausted in Year X"*) or when `max_years` is reached. The horizon
  is user-selectable in the UI (1–80 years, slider + input); the API defaults to
  50 when it isn't supplied.
- The corpus is never allowed to go negative; the final month withdraws only
  what remains.
- **Bar chart values are the simulated (resultant) values**, never naive
  arithmetic. "Remaining corpus" comes straight from the month-by-month
  recurrence (it keeps earning returns while being drawn down), and "Redeemed so
  far" is the actual cumulative sum of withdrawals (which rises with lifestyle
  inflation). Only "Principal" is a static reference — rendered as a **dashed
  reference line** over the grouped bars so it isn't double-counted.

### SIP → SWP linking

- **Corpus source** defaults to *"Use SIP final value"*: the SWP starting corpus
  is auto-populated from the SIP final **nominal** maturity value and updates
  live when SIP inputs change (the field is read-only while linked). Switching to
  *"Enter manually"* pre-fills the slider with the last SIP value as a
  convenience, then makes it fully independent.
- **Inflation & lifestyle inflation** are inherited from SIP while the corpus is
  SIP-sourced (shown with an *"unlock to override"* link). If corpus is entered
  manually, or the user explicitly unlocks, they become independent inputs.

### Other assumptions (chosen where the spec left room)

- **Contribution/withdrawal timing:** end-of-month (ordinary annuity).
- **Corpus when linked:** the SIP maturity value flows into the SWP corpus
  **exactly, without clamping** — even if it sits above the slider's visible
  position. The corpus slider/input range is ₹1,00,000 – ₹100 Cr
  (₹1,00,00,00,000) and the monthly withdrawal range is ₹500 – ₹10,00,000,
  enforced both in the UI and server-side.
- **INR formatting:** Indian numbering system with `en-IN` grouping
  (e.g. ₹12,34,567). Chart axes use compact ₹ (K / L / Cr).
- **Recalculation:** slider/number changes are debounced ~130 ms before calling
  the backend, keeping dragging smooth.
- **Node HTTP client:** uses Node 18+'s built-in global `fetch` (no `axios`
  dependency needed).
- **Download Plan (PDF):** the header button exports a PDF containing both SIP
  and SWP inputs, all result figures, and all four charts. Charts are captured
  client-side via Chart.js `toBase64Image()` and assembled with **jsPDF** +
  **jspdf-autotable** (loaded from CDN, so an internet connection is required
  for the export). Hidden panels are briefly rendered off-screen so their charts
  snapshot at full size regardless of which tab is active.
