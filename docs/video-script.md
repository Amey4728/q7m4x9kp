# Video script (max 10 min total)

Record at 1440×900 or larger, browser zoom 100%, light mode. Keep the live Vercel URL in the address bar
for Part 1. Rough timings are in brackets.

---

## Part 1: Client pitch (≤ 5 min)

**[0:00] Hook (30 s).** Title screen, or the Decision page.
> "Every morning before 11 o'clock, your desk commits to buying tomorrow's power. Wind is the biggest
> swing factor. Today we're showing what our pilot found when we replayed every January 2026 decision
> against what the wind actually did, and the tool we built so your team can do that every day."

**[0:30] The decision, as your trader sees it (1 min 15 s).** Day-ahead decision page, untick
"Show what actually happened".
* "Here it's Thursday 15 January, 10:59. The latest Elexon forecast is the 09:30 run. The app picks it
  automatically and never shows anything published after your cut-off."
* KPI cards: Elexon says 191 GWh. Our adjusted forecast says 167 GWh. Firm wind (P10) is 92 GWh, the
  cautious floor.
* The shaded band: "the range wind landed in 8 times out of 10 on recent days."
* The cut-off selector: "If your process locks positions earlier, set 09:00 and everything recalculates."

**[1:45] Reveal (45 s).** Tick "Show what actually happened".
* "The orange line is what the wind did. It stays inside the band." Step through a few days with the
  arrows. Pick one big miss (e.g. decide 10 Jan or 27 Jan) to show a large shortfall day.
* Bottom chart: "This is how the forecast for that day moved run by run. The blue one is what you had
  at decision time; grey runs came later."

**[2:30] What January taught us (1 min 30 s).** Forecast accuracy page.
* Read the findings box: "In 84% of hours the forecast was too high, by 1.7 GW on average. If you
  trusted it as is, you were structurally short."
* Daily energy error chart: "Almost every bar is red: real shortfalls of tens of GWh a day."
* Horizon chart: "Accuracy drops the further ahead you look. Day-ahead decisions sit in this shaded
  window."
* "Bigger forecasts, bigger misses": "The error grows with the size of the forecast, so we adjust in
  percentage terms."
* The headline: "Our adjusted forecast uses only data you'd have had that morning, and cuts the typical
  hourly error by a third: 2.0 GW to 1.3 GW, with bias almost gone."

**[4:00] Explorer + close (1 min).** Forecast explorer: drag the horizon slider from 48 h to 2 h.
* "Your analysts can test any horizon: here's what a 2-hour-ahead forecast looks like versus 48 hours."
* Download CSV: "Everything is exportable into your own models."
* Close: "Next steps for a production phase: daily live refresh, more months to confirm the
  adjustment, and adding solar and demand forecasts so the tool shows your net position directly."

---

## Part 2: Technical review (≤ 5 min)

Have open: GitHub repo (README), editor, the app, a terminal, and a green GitHub Actions run.

**[0:00] Scope and ambiguity I resolved (40 s).** README → "Data and assumptions".
> "The brief left a few things open, so I pinned them down and wrote them up:"
* What "available at decision time" means: D-1 at 11:00 gate closure; latest run with
  `publishTime <= cut-off`, with a per-hour fallback. The cut-off is configurable.
* "January decisions" means delivery days 2 Jan – 1 Feb, so the data window is shifted.
* Hourly forecast vs half-hourly actual: compared on the hour. Negative horizons dropped. Sign
  convention stated. The 16 Jan totals were checked by hand against the raw API, and a test pins them.

**[0:40] Architecture (50 s).** README diagram → ADR 0001.
* Snapshot, not live calls: why (fixed history, speed, resilience, reproducibility).
* Backend layers: `main.py` (HTTP) → `service.py` (use cases, cached per cut-off) → `core/` (pure
  functions). Open `core/selection.py`.
* Same-origin `/api` everywhere: the Vite proxy, nginx in Compose, and a Vercel rewrite to `api/index.py`.
  The same code runs in all three.

**[1:30] An API that ages well (50 s).** ADR 0002, then `/docs`.
* `/api/v1` versioning. Pydantic response models → OpenAPI → generated TS types; the CI contract job
  fails on drift. Show a nullable field the types forced the UI to handle.
* One error shape with a request id; `X-Request-ID` / `Server-Timing` headers; JSON access logs.
  Show a 422 in the browser and the matching log line.
* ETag on `data_version` → 304s.

**[2:20] Front end (1 min).** ADR 0003 → `src/api/queries.ts`, `src/state/urlState.ts`, `ErrorHeatmap.tsx`.
* Three kinds of state: server cache (React Query, prefetching the next days; show ←/→ being instant),
  the URL (paste a deep link), and local state (the slider only commits on release).
* The heatmap: hand-built SVG with a D3 diverging scale, one tab stop with arrow keys, and click-through
  to the day (demo with the keyboard).
* Lazy pages with a separate charts chunk; table twin for every chart; light/dark and phone layout.

**[3:20] Numerical rigour (40 s).** `core/correction.py`, `metrics.paired_block_bootstrap`.
* Walk-forward: day D only learns from days ≤ D-2. A test proves D-1 can't leak in.
* "Is the 34% real?" A day-block bootstrap gives a 21–45% interval; whole days are resampled because
  hourly errors within a day are correlated. The band's under-coverage is reported, not hidden.

**[4:00] Tests, CI, how to review (1 min).**
* Show `tests/test_properties.py`: Hypothesis generates random forecast sets and checks "never after the
  cut-off" and "always the latest run". It found two bugs in my own test setup while I wrote it.
* Async Elexon client tests with a fake transport (retries, no retry on 4xx, concurrency bound).
* Coverage: backend 98% (48 tests), front end 21 tests.
* CI: lint → tests with a coverage gate → contract check → Docker Compose smoke test. Pre-commit hooks
  and a PR template.
* Run it: `docker compose up --build`. Read README → ADRs → `core/` → `tests/`.
* Next steps: a scheduled refresh worker, a longer backtest, a calibrated band, and BST handling.
