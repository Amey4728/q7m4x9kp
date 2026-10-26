"""Request IDs, timing and structured (JSON) access logs.

Every response carries `X-Request-ID` (echoed from the caller if given) and `Server-Timing`, and
every request logs one JSON line, so a user-reported problem can be traced to a single log entry.
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

log = logging.getLogger("wfm.access")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {"level": record.levelname, "logger": record.name, "msg": record.getMessage()}
        payload.update(getattr(record, "fields", {}))
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging() -> None:
    root = logging.getLogger("wfm")
    if root.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    root.propagate = False


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = rid
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            log.exception("unhandled", extra={"fields": {"request_id": rid, "path": request.url.path}})
            raise
        finally:
            ms = (time.perf_counter() - start) * 1000
            log.info(
                "request",
                extra={
                    "fields": {
                        "request_id": rid,
                        "method": request.method,
                        "path": request.url.path,
                        "query": request.url.query,
                        "status": status,
                        "duration_ms": round(ms, 1),
                    }
                },
            )
        response.headers["X-Request-ID"] = rid
        response.headers["Server-Timing"] = f"app;dur={ms:.1f}"
        return response
