# ADR 0001: Ship a data snapshot instead of calling Elexon live

**Status:** accepted

## Context
The scope is decisions made in January 2026, which is fixed history. Calling Elexon on every page view
would add 1–3 s of latency, make the app depend on a third party's uptime, and make results
non-reproducible if Elexon revises data.

## Decision
`scripts/fetch_data.py` pulls the data once (async, bounded concurrency, retries) and writes
`backend/data/*.csv.gz` (~100 KB). The API reads it into memory at start-up. The snapshot's hash is
the `data_version`, used as the ETag.

## Consequences
* Pages respond in milliseconds; the app works if Elexon is down; tests run against fixed data.
* CSV (not Parquet) keeps the Vercel function under its size limit without pyarrow.
* Going live means a scheduled refresh job writing a new snapshot (or a small DB). The ETag already
  handles cache invalidation when the data changes.
