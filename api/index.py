"""Vercel entry point: exposes the FastAPI app from backend/ as a serverless function."""

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DATA_DIR", str(BACKEND / "data"))

from app.main import app  # noqa: E402,F401
