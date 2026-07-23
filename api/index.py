"""Vercel serverless entrypoint for the SIP-SWP Planner API.

Vercel's ``@vercel/python`` runtime detects a module-level ASGI ``app``
object and serves it directly, so we just re-export the FastAPI app defined
in :mod:`backend.main`. The repo root is added to ``sys.path`` so the
``backend`` package imports correctly inside the serverless bundle.
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.main import app  # noqa: E402

__all__ = ["app"]
