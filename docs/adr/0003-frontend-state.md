# ADR 0003: Front-end state

**Status:** accepted

## Decision
Three kinds of state, three homes:

| State | Where | Why |
|---|---|---|
| Server data | TanStack Query cache | Shared across views, deduplicated, abortable; `staleTime: Infinity` because the data is immutable; neighbouring days are prefetched so ←/→ is instant; previous data stays on screen while the next loads (no skeleton flash). |
| Shareable view state (tab, day, cut-off, explorer range, horizon) | URL query string via `useUrlParam` (`useSyncExternalStore`) | Deep links, reload-safe, back/forward work, validated with defaults. |
| Ephemeral UI (hover cell, slider while dragging, table toggle) | Local `useState` | Not worth sharing; the slider only commits to the URL (and fetches) on release. |

Pages are lazy-loaded; charts live in a shared chunk that loads with the first page that needs it.

## Consequences
No global store library is needed. Any view can be shared as a link.
