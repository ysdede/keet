# Trace Analyzer Toolkit

## Primary Tool

`metrics/trace_ultimate.py` is the primary analyzer for Chrome traces.

### Features

- Thread/process discovery for renderer/main/compositor/audio/workers
- Worker URL mapping via `TracingSessionIdForWorker`
- Per-thread CPU + long-task summaries
- GC breakdown by thread
- Message cadence (`HandlePostMessage`)
- Main render-loop rates (`FireAnimationFrame`, `PageAnimator::serviceScriptedAnimations`)
- AudioWorklet interval stats
- Ranked bottlenecks with measured evidence
- Baseline comparison mode

## Usage

### Baseline

```bash
python metrics/trace_ultimate.py traces/Trace-20260217T235732.json \
  --output-json traces/baseline.ultimate.json \
  --output-md traces/baseline.ultimate.md
```

### Compare After vs Baseline

```bash
python metrics/trace_ultimate.py traces/Trace-after.json \
  --baseline-json traces/baseline.ultimate.json \
  --output-json traces/after.ultimate.json \
  --output-md traces/after.ultimate.md
```

## CLI Arguments

- Positional: `trace_path`
- Optional: `--output-json <path>`
- Optional: `--output-md <path>`
- Optional: `--baseline-json <path>`
- Optional: `--window-sec <int>` (reserved, default `30`)
- Optional: `--long-task-ms <int>` (default `50`)
- Optional: `--top <int>` (default `15`)

## Backward Compatibility

`metrics/analyze_chrome_trace.py` now delegates to `trace_ultimate.py` while preserving legacy defaults:

- Default input: `metrics/trace-keet-tracing.json`
- Default output: `<trace-dir>/trace_analysis_summary.json`
