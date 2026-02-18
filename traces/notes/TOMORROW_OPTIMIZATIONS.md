# Tomorrow Optimization Handoff (2026-02-18)

Context:
- Streaming merge correctness regression was fixed in commit `c0b5c3f`.
- Preserve merge semantics first; only apply non-semantic performance optimizations.

## Prioritized Next Optimizations

1. BufferWorker round-trip reduction (Low risk, Medium impact)
- In `v4Tick`, replace multiple async worker calls (`hasSpeech` energy + inference + silence tail)
  with one consolidated request returning required VAD state for `[cursor, current]`.
- Goal: reduce main<->worker message overhead and latency jitter.

2. Worker response payload slimming (Low risk, Medium impact)
- In `PROCESS_V4_CHUNK_WITH_FEATURES_DONE`, send only deltas for sentence entries
  and avoid repeating unchanged heavy fields each tick.
- Goal: reduce structured clone/message transfer overhead.

3. UI render containment for transcript pane (Low risk, Medium impact)
- Ensure only changed transcript segments re-render.
- Avoid full text reconciliation when only immature tail changes.

4. Mel feature transfer reuse/pooling (Low risk, Medium impact)
- Reuse transferable buffers between mel worker and transcription worker where possible.
- Goal: lower allocation churn and GC pressure.

5. Debug panel hard-off path (Low risk, Low/Medium impact)
- Verify hidden debug panel does zero compute (no chart updates/data transforms).

6. Incremental cache telemetry guardrails (Low risk, Safety/Observability)
- Keep cache prefix validity guard.
- Add counters/log sampling for cache-hit/cache-bypass reasons.

## Guardrails
- Do not alter sentence merge semantics.
- Keep `UtteranceBasedMerger` regression fixtures green.
- If optimization conflicts with transcript coherence, disable optimization.

## Validation Checklist (each optimization)
- `npm test -- src/lib/transcription/WindowBuilder.test.ts src/lib/transcription/UtteranceBasedMerger.test.ts src/lib/transcription/UtteranceBasedMerger.regression.test.ts`
- `npm test`
- `npm run build`
- Optional trace compare with `metrics/trace_ultimate.py` when profiling session is available.

## DONE / SKIPPED / TODO (Round 2 - 2026-02-18)

### DONE
- `#1` BufferWorker round-trip reduction:
  - Added consolidated `GET_VAD_SUMMARY` worker query and switched `v4Tick` to one call for energy speech, optional inference speech, and energy silence tail.
  - Existing `HAS_SPEECH` and `GET_SILENCE_TAIL` APIs were kept for compatibility.
- `#3` UI render containment for transcript pane:
  - Batched v4 UI/store updates in `App.tsx` to reduce reactive churn per inference tick.
  - `TranscriptionDisplay` now skips rebuilding merged finalized corpus while `Live` tab is active.
- `#5` Debug panel hard-off path:
  - Added unmount/dispose guards in `LayeredBufferVisualizer` so pending async callbacks and animation loop do no work after panel close/unmount.
- `#6` Incremental cache telemetry guardrails:
  - Kept existing cache prefix validity guard.
  - Added sampled counters/logging for `enabled`, `bypassNonPositivePrefix`, and `bypassOutsideWindow`.

### SKIPPED
- `#2` Worker response payload slimming:
  - Deferred in this conservative pass to avoid v4 worker payload/interface churn and regression risk.
- `#4` Mel feature transfer reuse/pooling:
  - Deferred due to higher risk around transferable ownership and cross-worker lifecycle coordination.

### TODO
- Revisit `#2` with explicit payload contract/perf benchmarks before changing worker response shapes.
- Revisit `#4` behind an opt-in flag after adding dedicated transfer-lifetime tests and profiling proof.

### Merger Safety Note
- No text merge algorithm paths were optimized/refactored in this round.
- `UtteranceBasedMerger` semantics intentionally unchanged.
