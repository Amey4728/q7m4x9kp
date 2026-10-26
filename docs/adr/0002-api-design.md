# ADR 0002: API design

**Status:** accepted

## Decision
* **Versioned:** all data endpoints live under `/api/v1`. A breaking change ships as `/api/v2` next
  to it, so the old front end keeps working during a rollout. `/api/health` is unversioned (ops).
* **Typed contract:** every endpoint declares a Pydantic response model. The OpenAPI spec is exported
  (`scripts/export_openapi.py`) and the front end's TypeScript types are generated from it
  (`npm run gen:api`). CI fails if the spec and generated types drift apart.
* **One error shape:** `{"error": {"code", "message", "request_id"}}` for validation, 404 and 500 alike.
  Internals are never leaked; the request id links a user report to one log line.
* **Explicit units and conventions:** MW / MWh, ISO-8601 UTC strings, `error = forecast − actual`.
* **Domain-level parameters:** clients ask for `decision_date` + `cutoff`, not raw publish times. The
  "no forecasts from after the cut-off" rule lives on the server and is property-tested.
* **Caching:** responses carry `ETag: <data_version>` and `Cache-Control: max-age=3600`;
  `If-None-Match` returns 304.

## Consequences
Adding fields is non-breaking. Renaming or removing one is caught at compile time in the front end.
