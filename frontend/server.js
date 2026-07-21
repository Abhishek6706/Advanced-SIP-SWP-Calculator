/**
 * Express server for the SIP-SWP Planner frontend.
 *
 * Responsibilities:
 *   1. Serve the static single-page app from ./public
 *   2. Proxy calculation requests to the Python FastAPI service so the browser
 *      only ever talks to this Node server (never directly to FastAPI).
 *
 * The FastAPI base URL is configurable via the FASTAPI_URL env var
 * (default http://127.0.0.1:8000). This server listens on PORT (default 3000).
 *
 * Uses Node's built-in global `fetch` (Node 18+), so no extra HTTP client
 * dependency is required.
 */

const path = require("path");
const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/**
 * Forward a JSON POST to the FastAPI backend and relay its response
 * (status + body) back to the browser.
 */
async function proxyToFastAPI(fastapiPath, req, res) {
  try {
    const upstream = await fetch(`${FASTAPI_URL}${fastapiPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const text = await upstream.text();
    // Relay the upstream status so validation errors (422) surface in the UI.
    res
      .status(upstream.status)
      .type(upstream.headers.get("content-type") || "application/json")
      .send(text);
  } catch (err) {
    console.error(`Proxy error for ${fastapiPath}:`, err.message);
    res.status(502).json({
      error: "calculation_service_unavailable",
      detail:
        "Could not reach the calculation service. Is FastAPI running on " +
        FASTAPI_URL +
        "?",
    });
  }
}

app.post("/api/sip/simulate", (req, res) =>
  proxyToFastAPI("/api/sip/simulate", req, res)
);

app.post("/api/swp/simulate", (req, res) =>
  proxyToFastAPI("/api/swp/simulate", req, res)
);

app.get("/api/health", async (_req, res) => {
  try {
    const upstream = await fetch(`${FASTAPI_URL}/api/health`);
    const body = await upstream.json();
    res.json({ node: "ok", fastapi: body });
  } catch {
    res.status(502).json({ node: "ok", fastapi: "unreachable" });
  }
});

app.listen(PORT, () => {
  console.log(`SIP-SWP Planner frontend on http://localhost:${PORT}`);
  console.log(`Proxying calculations to FastAPI at ${FASTAPI_URL}`);
});
