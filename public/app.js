/* ===========================================================================
   SIP-SWP Planner — frontend logic (vanilla JS)

   Contents:
     1. Utilities (INR formatting, debounce)
     2. SliderField — reusable slider + synced number-input component
     3. Field definitions for SIP and SWP
     4. State + SIP <-> SWP linking logic
     5. API calls (via the Node proxy) with debouncing
     6. Chart.js rendering (4 charts)
     7. Wiring / bootstrap
=========================================================================== */

/* ------------------------------------------------------------------ */
/* 1. Utilities                                                        */
/* ------------------------------------------------------------------ */

/** Format a number using the Indian numbering system with a ₹ prefix. */
function formatINR(value, { decimals = 0 } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Number(value);
  return (
    "₹" +
    rounded.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

/** Compact ₹ for chart axis ticks (e.g. ₹1.2Cr, ₹45L, ₹3T). */
function formatINRCompact(value) {
  const v = Number(value);
  const abs = Math.abs(v);
  if (abs >= 1e7) return "₹" + (v / 1e7).toFixed(2).replace(/\.00$/, "") + "Cr";
  if (abs >= 1e5) return "₹" + (v / 1e5).toFixed(2).replace(/\.00$/, "") + "L";
  if (abs >= 1e3) return "₹" + (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return "₹" + Math.round(v);
}

/** Trailing-throttle: call fn at most once per `wait` ms. */
function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 3500);
}

/* ------------------------------------------------------------------ */
/* 2. SliderField — reusable component                                */
/* ------------------------------------------------------------------ */
/**
 * Builds a labelled slider + number input that stay in sync, with clamping
 * to [min, max] and step snapping. Used consistently for every input.
 *
 * config: { key, label, min, max, step, value, unit, hint, decimals, info }
 * onChange(value) is called (validated + clamped) whenever the value changes.
 */
class SliderField {
  constructor(config, onChange) {
    this.cfg = Object.assign({ decimals: 0, unit: "", value: config.min }, config);
    this.onChange = onChange;
    this.value = this.cfg.value;
    this.locked = false;
    this.el = this._build();
    this.setValue(this.value, { silent: true });
  }

  _build() {
    const c = this.cfg;
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.dataset.key = c.key;

    const infoHtml = c.info
      ? `<span class="info-icon" tabindex="0" data-tip="${c.info.replace(/"/g, "&quot;")}">i</span>`
      : "";
    const hintHtml = c.hint ? `<span class="field-hint">${c.hint}</span>` : "";

    wrap.innerHTML = `
      <div class="field-top">
        <label class="field-label">${c.label}${infoHtml}${hintHtml}</label>
        <input type="number" class="num-input" min="${c.min}" max="${c.max}"
               step="${c.step}" />
      </div>
      <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" />
    `;

    this.numEl = wrap.querySelector(".num-input");
    this.rangeEl = wrap.querySelector('input[type="range"]');

    // Slider drag -> update number (live).
    this.rangeEl.addEventListener("input", () => {
      this.setValue(parseFloat(this.rangeEl.value));
    });

    // Typing in the number box. Clamp/validate on change/blur; allow free
    // typing on `input` but reflect to slider when parseable.
    this.numEl.addEventListener("input", () => {
      const raw = parseFloat(this.numEl.value);
      if (!Number.isNaN(raw)) {
        this.rangeEl.value = this._clamp(raw);
        this._emit(this._clamp(raw));
      }
    });
    this.numEl.addEventListener("change", () => this._commitNumber());
    this.numEl.addEventListener("blur", () => this._commitNumber());

    return wrap;
  }

  _clamp(v) {
    const c = this.cfg;
    let x = Math.min(c.max, Math.max(c.min, v));
    // Snap to step relative to min.
    const steps = Math.round((x - c.min) / c.step);
    x = c.min + steps * c.step;
    return parseFloat(x.toFixed(6));
  }

  _commitNumber() {
    const raw = parseFloat(this.numEl.value);
    if (Number.isNaN(raw)) {
      this.numEl.classList.add("invalid");
      this.setValue(this.value); // restore last good
      this.numEl.classList.remove("invalid");
      return;
    }
    const clamped = this._clamp(raw);
    if (clamped !== raw) this.numEl.classList.remove("invalid");
    this.setValue(clamped);
  }

  _emit(v) {
    this.value = v;
    if (!this.locked && typeof this.onChange === "function") this.onChange(v);
  }

  /**
   * Programmatically set the value (used by SIP->SWP linking).
   * Pass { raw: true } to bypass clamping/step-snapping and store the exact
   * value — used when the SIP-linked corpus should flow through untouched even
   * if it sits above the slider's visible max.
   */
  setValue(v, { silent = false, raw = false } = {}) {
    const val = raw ? v : this._clamp(v);
    this.value = val;
    const display = this.cfg.decimals ? val.toFixed(this.cfg.decimals) : String(val);
    this.numEl.value = display;
    // The range thumb visually caps at its max, but this.value keeps the exact number.
    this.rangeEl.value = val;
    this.numEl.classList.remove("invalid");
    if (!silent && !this.locked && typeof this.onChange === "function") {
      this.onChange(val);
    }
  }

  setLocked(locked) {
    this.locked = locked;
    this.el.classList.toggle("locked", locked);
    this.numEl.disabled = locked;
    this.rangeEl.disabled = locked;
  }
}

/* ------------------------------------------------------------------ */
/* 3. Field definitions                                               */
/* ------------------------------------------------------------------ */
const SIP_FIELDS = [
  { key: "monthly_investment", label: "Monthly Investment", min: 500, max: 1000000, step: 500, value: 25000, hint: "₹500 – ₹10,00,000" },
  { key: "tenure_years", label: "Tenure (years)", min: 1, max: 40, step: 1, value: 15 },
  { key: "annual_return", label: "Expected Annual Return (%)", min: 1, max: 30, step: 0.1, value: 12, decimals: 1, info: "The average yearly growth rate you expect your investments to earn." },
  { key: "inflation_rate", label: "Inflation Rate (%)", min: 0, max: 15, step: 0.1, value: 6, decimals: 1, info: "The general yearly rise in prices, used to show your corpus in today's money." },
  { key: "lifestyle_inflation", label: "Lifestyle Inflation (%)", min: 0, max: 20, step: 0.1, value: 3, decimals: 1, info: "The extra yearly rise in your own spending and expectations, on top of general inflation." },
  { key: "step_up", label: "Auto Step-Up (%/yr)", min: 0, max: 25, step: 0.5, value: 10, decimals: 1, info: "At the start of each year the monthly SIP amount increases by this percentage, and the increase compounds year on year." },
];

const SWP_FIELDS = [
  { key: "starting_corpus", label: "Starting Corpus", min: 100000, max: 1000000000, step: 50000, value: 10000000, hint: "₹1,00,000 – ₹100 Cr", info: "The lump sum you begin withdrawing from — link it to your SIP result or enter it manually." },
  { key: "monthly_withdrawal", label: "Monthly Withdrawal", min: 500, max: 1000000, step: 500, value: 60000, hint: "₹500 – ₹10,00,000", info: "The amount you take out each month in the first year. It grows in later years (see below)." },
  { key: "max_years", label: "Withdrawal Horizon (years)", min: 1, max: 80, step: 1, value: 30, info: "How many years to plan withdrawals for. If your corpus lasts beyond this, it's shown as sustaining; the chart also stops here." },
  { key: "annual_return", label: "Expected Annual Return (%)", min: 1, max: 30, step: 0.1, value: 8, decimals: 1, info: "Return earned on the corpus that is still invested while you withdraw." },
  { key: "inflation_rate", label: "Inflation Rate (%)", min: 0, max: 15, step: 0.1, value: 6, decimals: 1, info: "The general yearly rise in prices, used to show your remaining corpus in today's money." },
  { key: "lifestyle_inflation", label: "Lifestyle Inflation (%)", min: 0, max: 20, step: 0.1, value: 5, decimals: 1, info: "Your monthly withdrawal increases by this % each year to keep pace with rising lifestyle costs — withdrawals are not flat." },
  { key: "step_up", label: "Withdrawal Step-Up (%/yr)", min: 0, max: 25, step: 0.5, value: 0, decimals: 1, info: "An extra deliberate increase to your monthly withdrawal each year, applied on top of lifestyle inflation (the two compound together). Use it to draw a little more from the corpus year over year." },
];

/* ------------------------------------------------------------------ */
/* 4. State                                                           */
/* ------------------------------------------------------------------ */
const sipControls = {}; // key -> SliderField
const swpControls = {};
const charts = {}; // id -> Chart instance

let lastSipResult = null; // cache last SIP response for linking
let lastSwpResult = null; // cache last SWP response (for PDF export)

// SWP linkage state
let corpusSource = "sip"; // "sip" | "manual"
const inflationInherited = { inflation_rate: true, lifestyle_inflation: true };

/* ------------------------------------------------------------------ */
/* 5. API calls                                                       */
/* ------------------------------------------------------------------ */
async function callApi(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      else if (j.error) detail = j.error;
    } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

function collectValues(controls) {
  const out = {};
  for (const [k, f] of Object.entries(controls)) out[k] = f.value;
  return out;
}

/** Run the SIP simulation and re-render. */
async function runSip() {
  try {
    const inputs = collectValues(sipControls);
    const data = await callApi("/api/sip/simulate", inputs);
    lastSipResult = data;
    renderSipSummary(data.summary);
    renderSipCharts(data.yearly);
    // If SWP is linked to SIP, propagate the new corpus / inflation values.
    propagateSipToSwp();
  } catch (err) {
    showToast("SIP: " + err.message);
  }
}

/** Run the SWP simulation and re-render. */
async function runSwp() {
  try {
    const inputs = collectValues(swpControls);
    const data = await callApi("/api/swp/simulate", inputs);
    lastSwpResult = data;
    renderSwpSummary(data.summary);
    renderSwpCharts(data.yearly);
  } catch (err) {
    showToast("SWP: " + err.message);
  }
}

const runSipDebounced = debounce(runSip, 130);
const runSwpDebounced = debounce(runSwp, 130);

/* ------------------------------------------------------------------ */
/* 4b. SIP -> SWP linking                                             */
/* ------------------------------------------------------------------ */
function propagateSipToSwp() {
  if (!lastSipResult) return;
  const finalCorpus = lastSipResult.summary.maturity_nominal;

  // Corpus — flow the exact SIP final value through, no clamping.
  if (corpusSource === "sip") {
    swpControls.starting_corpus.setValue(finalCorpus, { silent: true, raw: true });
    updateCorpusBadge(finalCorpus);
  }

  // Inherited inflation values
  if (inflationInherited.inflation_rate) {
    swpControls.inflation_rate.setValue(sipControls.inflation_rate.value, { silent: true });
  }
  if (inflationInherited.lifestyle_inflation) {
    swpControls.lifestyle_inflation.setValue(sipControls.lifestyle_inflation.value, { silent: true });
  }

  // Re-run SWP with the propagated values.
  runSwpDebounced();
}

function updateCorpusBadge(finalCorpus) {
  const badge = document.getElementById("corpus-link-badge");
  if (corpusSource === "sip") {
    badge.classList.remove("unlinked");
    badge.innerHTML = `🔗 Corpus linked to SIP: <strong>${formatINR(finalCorpus)}</strong>`;
  } else {
    badge.classList.add("unlinked");
    badge.innerHTML = `⛓️‍💥 Corpus unlinked — manual entry (independent from SIP).`;
  }
}

function setCorpusSource(source) {
  corpusSource = source;
  const corpusField = swpControls.starting_corpus;
  if (source === "sip") {
    corpusField.setLocked(true);
    // Inflation values revert to inherited when re-linking.
    setInflationInherited("inflation_rate", true);
    setInflationInherited("lifestyle_inflation", true);
    propagateSipToSwp();
  } else {
    // Unlink: pre-fill manual slider with last known SIP corpus, then free it.
    corpusField.setLocked(false);
    // Inflation becomes independent too.
    setInflationInherited("inflation_rate", false);
    setInflationInherited("lifestyle_inflation", false);
    updateCorpusBadge();
    runSwpDebounced();
  }
}

function setInflationInherited(key, inherited) {
  inflationInherited[key] = inherited;
  const field = swpControls[key];
  if (inherited && lastSipResult) {
    field.setValue(sipControls[key].value, { silent: true });
  }
  field.setLocked(inherited);
  // Add/refresh the inline "inherited / unlock" note.
  refreshInflationNote(key);
}

function refreshInflationNote(key) {
  const field = swpControls[key];
  let note = field.el.querySelector(".inherit-note");
  if (!note) {
    note = document.createElement("button");
    note.type = "button";
    note.className = "inherit-note";
    note.style.cssText =
      "margin-top:6px;font-size:0.76rem;background:none;border:none;color:var(--brand);cursor:pointer;padding:0;text-decoration:underline;";
    field.el.appendChild(note);
  }
  if (corpusSource !== "sip") {
    note.style.display = "none";
    return;
  }
  note.style.display = "";
  if (inflationInherited[key]) {
    note.textContent = "Inherited from SIP · click to unlock & override";
    note.onclick = () => setInflationInherited(key, false);
  } else {
    note.textContent = "Overridden · click to re-inherit from SIP";
    note.onclick = () => setInflationInherited(key, true);
  }
}

/* ------------------------------------------------------------------ */
/* 6. Summary rendering                                               */
/* ------------------------------------------------------------------ */
function summaryCard(label, value, cls = "", sub = "", tip = "") {
  const labelHtml = tip
    ? `<span class="term" tabindex="0" data-tip="${tip.replace(/"/g, "&quot;")}">${label}</span>`
    : label;
  return `<div class="summary-card">
    <div class="label">${labelHtml}</div>
    <div class="value ${cls}">${value}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ""}
  </div>`;
}

function renderSipSummary(s) {
  document.getElementById("sip-summary").innerHTML = [
    summaryCard("Maturity (nominal)", formatINR(s.maturity_nominal), "green", "",
      "The actual rupee value of your investment at the end, before adjusting for inflation."),
    summaryCard("Total invested", formatINR(s.total_invested), "", "",
      "The total money you actually put in over the whole period."),
    summaryCard("Wealth gained", formatINR(s.wealth_gained), "green", "",
      "The returns earned on top of the money you invested."),
    summaryCard("Real value (inflation-adj.)", formatINR(s.maturity_real), "amber", "",
      "What your final amount is worth in today's money, after general inflation."),
    summaryCard("Fully-adjusted value", formatINR(s.maturity_fully_adjusted), "amber", "after inflation + lifestyle inflation",
      "What your final amount is really worth in today's money after both general and lifestyle inflation."),
  ].join("");
}

function renderSwpSummary(s) {
  const longevityTip =
    "How long your corpus lasts before it runs out, given your withdrawals and returns.";
  let longevity;
  if (s.sustains_indefinitely) {
    longevity = summaryCard("Corpus longevity", "Sustains ✓", "green", "does not deplete within horizon", longevityTip);
  } else {
    const y = s.longevity_years;
    const m = s.longevity_months;
    longevity = summaryCard("Corpus longevity", `${y}y ${m}m`, "red", "corpus exhausted", longevityTip);
  }
  document.getElementById("swp-summary").innerHTML = [
    longevity,
    summaryCard("Starting corpus", formatINR(s.starting_corpus), "", "",
      "The lump sum you begin withdrawing from."),
    summaryCard("Total withdrawn", formatINR(s.total_withdrawn), "amber", "",
      "The total amount taken out over the whole period. Can exceed the starting corpus, since it keeps earning returns while being drawn down."),
    summaryCard("Final corpus (nominal)", formatINR(s.final_corpus_nominal), s.depleted ? "red" : "green", "",
      "The actual rupees left at the end of the horizon (₹0 if the corpus ran out)."),
    summaryCard("Final corpus (real)", formatINR(s.final_corpus_real), "amber", "in today's money",
      "What the leftover corpus is worth in today's money, after general inflation."),
  ].join("");
}

/* ------------------------------------------------------------------ */
/* 7. Chart helpers                                                   */
/* ------------------------------------------------------------------ */
const CHART_COLORS = {
  invested: "#64748b",
  investedReal: "#dc2626",
  nominal: "#2f6df6",
  real: "#16a34a",
  lifestyle: "#a855f7",
  fully: "#d97706",
  remaining: "#2f6df6",
  remainingReal: "#16a34a",
  redeemed: "#d97706",
  principal: "#64748b",
};

function baseLineOptions(monthly) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { boxWidth: 14, usePointStyle: true } },
      tooltip: {
        callbacks: {
          title: (items) =>
            (monthly ? "Month " : "Year ") + items[0].label,
          label: (ctx) => `${ctx.dataset.label}: ${formatINR(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { title: { display: true, text: monthly ? "Month" : "Year" }, grid: { display: false } },
      y: {
        title: { display: true, text: "₹" },
        ticks: { callback: (v) => formatINRCompact(v) },
      },
    },
  };
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

/** Flatten yearly -> monthly series when the monthly toggle is on. */
function extractSeries(yearly, monthly, fields) {
  const labels = [];
  const series = {};
  fields.forEach((f) => (series[f] = []));

  if (monthly) {
    yearly.forEach((y) => {
      y.months.forEach((m) => {
        labels.push(m.month);
        fields.forEach((f) => series[f].push(m[f]));
      });
    });
  } else {
    yearly.forEach((y) => {
      labels.push(y.year);
      fields.forEach((f) => series[f].push(y[f]));
    });
  }
  return { labels, series };
}

/* --------------------- SIP chart ----------------------------------- */
function renderSipCharts(yearly) {
  const monthly = document.getElementById("sip-monthly-toggle").checked;

  const { labels, series } = extractSeries(yearly, monthly, [
    "invested",
    "invested_fully_adjusted",
    "nominal",
    "fully_adjusted",
  ]);
  const last = yearly[yearly.length - 1];

  // Chart 1: Principal invested (nominal) vs Nominal corpus — before inflation.
  destroyChart("sip-chart-nominal");
  charts["sip-chart-nominal"] = new Chart(
    document.getElementById("sip-chart-nominal"),
    {
      type: "line",
      data: {
        labels,
        datasets: [
          dsLine("Principal invested", series.invested, CHART_COLORS.invested, { dashed: true }),
          Object.assign(
            dsLine("Nominal corpus", series.nominal, CHART_COLORS.nominal),
            { fill: "-1", backgroundColor: "rgba(47,109,246,0.12)" }
          ),
        ],
      },
      options: baseLineOptions(monthly),
    }
  );
  document.getElementById("sip-nominal-callout").innerHTML =
    `Invested: <strong>${formatINR(last.invested)}</strong> · ` +
    `Nominal corpus: <strong>${formatINR(last.nominal)}</strong> · ` +
    `Wealth gained: <strong>${formatINR(last.nominal - last.invested)}</strong>`;

  // Chart 2: Principal invested (after both inflations) vs Actual corpus value.
  destroyChart("sip-chart-real");
  charts["sip-chart-real"] = new Chart(
    document.getElementById("sip-chart-real"),
    {
      type: "line",
      data: {
        labels,
        datasets: [
          dsLine("Principal invested (after both inflations)", series.invested_fully_adjusted, CHART_COLORS.investedReal, { dashed: true }),
          Object.assign(
            dsLine("Actual corpus (after both inflations)", series.fully_adjusted, CHART_COLORS.fully),
            { fill: "-1", backgroundColor: "rgba(217,119,6,0.12)" }
          ),
        ],
      },
      options: baseLineOptions(monthly),
    }
  );
  document.getElementById("sip-real-callout").innerHTML =
    `Invested (real): <strong>${formatINR(last.invested_fully_adjusted)}</strong> · ` +
    `Actual corpus (real): <strong>${formatINR(last.fully_adjusted)}</strong> · ` +
    `Real gain: <strong>${formatINR(last.fully_adjusted - last.invested_fully_adjusted)}</strong>`;
}

/* --------------------- SWP charts ---------------------------------- */
function renderSwpCharts(yearly) {
  const monthly = document.getElementById("swp-monthly-toggle").checked;
  const depletedYear = yearly.find((y) => y.depleted);

  // Chart 1: remaining nominal, remaining real, cumulative withdrawn
  const { labels, series } = extractSeries(yearly, monthly, [
    "remaining_nominal",
    "remaining_real",
    "cumulative_withdrawn",
  ]);
  destroyChart("swp-chart-main");
  const opts = baseLineOptions(monthly);
  if (depletedYear) {
    opts.plugins.subtitle = {
      display: true,
      text: `⚠ Corpus exhausted in Year ${depletedYear.year}`,
      color: CHART_COLORS.redeemed,
    };
  }
  charts["swp-chart-main"] = new Chart(
    document.getElementById("swp-chart-main"),
    {
      type: "line",
      data: {
        labels,
        datasets: [
          dsLine("Remaining corpus (nominal)", series.remaining_nominal, CHART_COLORS.remaining),
          dsLine("Remaining corpus (real)", series.remaining_real, CHART_COLORS.remainingReal),
          dsLine("Cumulative withdrawn", series.cumulative_withdrawn, CHART_COLORS.redeemed, { dashed: true }),
        ],
      },
      options: opts,
    }
  );

  // Chart 2: grouped bars per YEAR — Redeemed & Remaining, with Principal
  // as a dashed reference line (so it isn't double-counted).
  const barLabels = yearly.map((y) => y.year);
  const redeemed = yearly.map((y) => y.cumulative_withdrawn);
  const remaining = yearly.map((y) => y.remaining_nominal);
  const principal = yearly.map((y) => y.starting_corpus);

  destroyChart("swp-chart-bars");
  charts["swp-chart-bars"] = new Chart(
    document.getElementById("swp-chart-bars"),
    {
      type: "bar",
      data: {
        labels: barLabels,
        datasets: [
          {
            label: "Redeemed so far",
            data: redeemed,
            backgroundColor: CHART_COLORS.redeemed,
            borderRadius: 4,
          },
          {
            label: "Remaining corpus",
            data: remaining,
            backgroundColor: CHART_COLORS.remaining,
            borderRadius: 4,
          },
          {
            label: "Principal (starting corpus)",
            data: principal,
            type: "line",
            borderColor: CHART_COLORS.principal,
            borderDash: [6, 6],
            pointRadius: 0,
            borderWidth: 2,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", labels: { boxWidth: 14, usePointStyle: true } },
          tooltip: {
            callbacks: {
              title: (items) => "Year " + items[0].label,
              label: (ctx) => `${ctx.dataset.label}: ${formatINR(ctx.parsed.y)}`,
            },
          },
          subtitle: depletedYear
            ? {
                display: true,
                text: `⚠ Corpus exhausted in Year ${depletedYear.year}`,
                color: CHART_COLORS.redeemed,
              }
            : { display: false },
        },
        scales: {
          x: { title: { display: true, text: "Year" }, grid: { display: false } },
          y: {
            beginAtZero: true,
            title: { display: true, text: "₹" },
            ticks: { callback: (v) => formatINRCompact(v) },
          },
        },
      },
    }
  );
}

function dsLine(label, data, color, { dashed = false } = {}) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    borderDash: dashed ? [6, 5] : [],
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.15,
    fill: false,
  };
}

/* ------------------------------------------------------------------ */
/* 7b. PDF export — full plan (inputs + results + charts)             */
/* ------------------------------------------------------------------ */

/**
 * ASCII-safe rupee formatter for the PDF. jsPDF's standard font can't render
 * the ₹ glyph (it degrades to "¹"), so the PDF uses "Rs " with Indian-system
 * grouping. The on-screen UI and chart images still use the real ₹ symbol.
 */
function formatINRPlain(value, { decimals = 0 } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return (
    "Rs " +
    Number(value).toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

/** Format a single input value for the PDF, based on its field key. */
function formatFieldValue(key, v) {
  if (["monthly_investment", "monthly_withdrawal", "starting_corpus"].includes(key)) {
    return formatINRPlain(v);
  }
  if (["tenure_years", "max_years"].includes(key)) return `${v} years`;
  return `${v}%`;
}

function inputRows(fields, controls) {
  return fields.map((f) => [f.label, formatFieldValue(f.key, controls[f.key].value)]);
}

function sipSummaryRows(s) {
  return [
    ["Maturity (nominal)", formatINRPlain(s.maturity_nominal)],
    ["Total invested", formatINRPlain(s.total_invested)],
    ["Wealth gained", formatINRPlain(s.wealth_gained)],
    ["Real value (inflation-adjusted)", formatINRPlain(s.maturity_real)],
    ["Lifestyle-adjusted value", formatINRPlain(s.maturity_lifestyle_adjusted)],
    ["Fully-adjusted value (both inflations)", formatINRPlain(s.maturity_fully_adjusted)],
  ];
}

function swpSummaryRows(s) {
  const longevity = s.sustains_indefinitely
    ? "Sustains (no depletion within horizon)"
    : `${s.longevity_years}y ${s.longevity_months}m (corpus exhausted)`;
  return [
    ["Corpus longevity", longevity],
    ["Starting corpus", formatINRPlain(s.starting_corpus)],
    ["Total withdrawn", formatINRPlain(s.total_withdrawn)],
    ["Final corpus (nominal)", formatINRPlain(s.final_corpus_nominal)],
    ["Final corpus (real, today's money)", formatINRPlain(s.final_corpus_real)],
  ];
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Capture every chart as a PNG. Inactive (hidden) panels have zero-size
 * canvases, so we briefly reveal them off-screen at a fixed width, let the
 * charts resize/redraw, snapshot them, then restore everything.
 */
/**
 * Snapshot a chart as a white-background JPEG data URL. Chart.js canvases are
 * transparent, so we composite onto white first (a plain JPEG would turn
 * transparent pixels black). JPEG keeps the file small while staying crisp.
 */
async function chartToWhiteJpeg(chart) {
  const png = chart.toBase64Image("image/png", 1);
  const img = await loadImage(png);
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0);
  return cv.toDataURL("image/jpeg", 0.92);
}

async function captureChartImages() {
  // Render at a fixed wide size and a high pixel ratio so the snapshots stay
  // crisp (~350 DPI) when scaled to the PDF width, instead of a blurry ~1x grab.
  const HIRES_DPR = 2.5;
  const EXPORT_WIDTH = "1000px";

  const restore = [];
  document.querySelectorAll(".panel:not(.active)").forEach((p) => {
    restore.push([p, p.getAttribute("style") || ""]);
    p.style.display = "block";
    p.style.position = "absolute";
    p.style.left = "-10000px";
    p.style.top = "0";
    p.style.width = EXPORT_WIDTH;
  });

  // Temporarily bump every chart's device pixel ratio, then redraw.
  const dprRestore = [];
  Object.values(charts).forEach((c) => {
    dprRestore.push([c, c.options.devicePixelRatio]);
    c.options.devicePixelRatio = HIRES_DPR;
    c.resize();
  });
  await new Promise((r) => setTimeout(r, 400)); // allow layout + hi-res redraw

  const images = {};
  for (const [id, c] of Object.entries(charts)) {
    try {
      images[id] = await chartToWhiteJpeg(c);
    } catch (_) {
      images[id] = null;
    }
  }

  // Restore original device pixel ratio, panel styles, and on-screen sizing.
  dprRestore.forEach(([c, dpr]) => {
    c.options.devicePixelRatio = dpr;
  });
  restore.forEach(([p, css]) => p.setAttribute("style", css));
  Object.values(charts).forEach((c) => c.resize());
  return images;
}

async function downloadPlanPDF(scope = "both") {
  const btn = document.getElementById("download-pdf");
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast("PDF library failed to load. Check your connection and retry.");
    return;
  }
  // Make sure the needed simulations have run at least once. SWP can depend on
  // the SIP-linked corpus, so ensure SIP first whenever SWP is included.
  if (scope !== "swp" && !lastSipResult) await runSip();
  if (scope !== "sip") {
    if (!lastSipResult) await runSip();
    if (!lastSwpResult) await runSwp();
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing PDF…";

  try {
    const images = await captureChartImages();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentW = pageW - margin * 2;
    let y = margin;

    const ensure = (h) => {
      if (y + h > pageH - margin) {
        doc.addPage();
        y = margin;
      }
    };

    const sectionTitle = (t) => {
      ensure(34);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(47, 109, 246);
      doc.text(t, margin, y);
      y += 10;
    };

    const table = (head, body) => {
      doc.autoTable({
        startY: y + 6,
        head: [head],
        body,
        margin: { left: margin, right: margin },
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [47, 109, 246], textColor: 255 },
        alternateRowStyles: { fillColor: [244, 246, 251] },
        theme: "grid",
      });
      y = doc.lastAutoTable.finalY + 16;
    };

    const addChart = async (id, caption) => {
      const src = images[id];
      if (!src) return;
      const img = await loadImage(src);
      const h = contentW * (img.naturalHeight / img.naturalWidth);
      ensure(h + 22);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(90, 100, 120);
      doc.text(caption, margin, y);
      y += 8;
      doc.addImage(src, "JPEG", margin, y, contentW, h);
      y += h + 16;
    };

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(26, 34, 51);
    const titleByScope = {
      sip: "SIP Investment Plan",
      swp: "SWP Withdrawal Plan",
      both: "SIP-SWP Wealth Management Plan",
    };
    doc.text(titleByScope[scope] || titleByScope.both, margin, y);
    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 130, 150);
    doc.text("Generated on " + new Date().toLocaleString("en-IN"), margin, y);
    y += 20;

    // SIP
    if (scope !== "swp") {
      sectionTitle("SIP - Accumulation");
      table(["SIP Input", "Value"], inputRows(SIP_FIELDS, sipControls));
      table(["SIP Result", "Value"], sipSummaryRows(lastSipResult.summary));
      await addChart("sip-chart-nominal", "Invested vs. nominal corpus (before inflation)");
      await addChart("sip-chart-real", "Invested vs. actual corpus (after both inflations)");
    }

    // SWP
    if (scope !== "sip") {
      sectionTitle("SWP - Withdrawal");
      const swpRows = [
        ["Corpus source", corpusSource === "sip" ? "Linked to SIP final value" : "Manual entry"],
        ...inputRows(SWP_FIELDS, swpControls),
      ];
      table(["SWP Input", "Value"], swpRows);
      table(["SWP Result", "Value"], swpSummaryRows(lastSwpResult.summary));
      await addChart("swp-chart-main", "Corpus depletion over time");
      await addChart("swp-chart-bars", "Principal vs. Redeemed vs. Remaining (per year)");
    }

    // Footer disclaimer on every page
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(150, 158, 175);
      doc.text(
        "Projections are estimates based on the assumptions entered and are not financial advice.",
        margin,
        pageH - 20
      );
      doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 20, { align: "right" });
    }

    const suffix = scope === "both" ? "" : "-" + scope;
    doc.save("wealth-management-plan" + suffix + ".pdf");
  } catch (err) {
    showToast("Could not build PDF: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/* ------------------------------------------------------------------ */
/* 8. Bootstrap / wiring                                              */
/* ------------------------------------------------------------------ */
function buildFields(defs, container, controls, onChange) {
  const host = document.getElementById(container);
  defs.forEach((def) => {
    const field = new SliderField(def, () => onChange());
    controls[def.key] = field;
    host.appendChild(field.el);
  });
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
      // Charts need a resize nudge when their panel becomes visible.
      Object.values(charts).forEach((c) => c.resize());
    });
  });
}

function initCorpusSource() {
  document.querySelectorAll('input[name="corpus-source"]').forEach((radio) => {
    radio.addEventListener("change", (e) => setCorpusSource(e.target.value));
  });
}

function init() {
  buildFields(SIP_FIELDS, "sip-inputs", sipControls, runSipDebounced);
  buildFields(SWP_FIELDS, "swp-inputs", swpControls, runSwpDebounced);

  initTabs();
  initCorpusSource();

  // Download-plan button opens a scope chooser (SIP only / SWP only / Both).
  const dlModal = document.getElementById("download-modal");
  const openDlModal = () => {
    dlModal.hidden = false;
  };
  const closeDlModal = () => {
    dlModal.hidden = true;
  };
  document.getElementById("download-pdf").addEventListener("click", openDlModal);
  document.getElementById("dl-cancel").addEventListener("click", closeDlModal);
  dlModal.querySelectorAll(".modal-opt").forEach((opt) => {
    opt.addEventListener("click", () => {
      const scope = opt.dataset.scope;
      closeDlModal();
      downloadPlanPDF(scope);
    });
  });
  // Dismiss on backdrop click or Escape.
  dlModal.addEventListener("click", (e) => {
    if (e.target === dlModal) closeDlModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dlModal.hidden) closeDlModal();
  });

  // Monthly/annual toggles just re-render from cached data.
  document.getElementById("sip-monthly-toggle").addEventListener("change", () => {
    if (lastSipResult) renderSipCharts(lastSipResult.yearly);
  });
  document.getElementById("swp-monthly-toggle").addEventListener("change", () => {
    runSwp();
  });

  // Start SWP corpus locked (linked to SIP by default).
  swpControls.starting_corpus.setLocked(true);
  setInflationInherited("inflation_rate", true);
  setInflationInherited("lifestyle_inflation", true);

  // Initial run: SIP first (which then propagates to SWP).
  runSip();
}

document.addEventListener("DOMContentLoaded", init);
