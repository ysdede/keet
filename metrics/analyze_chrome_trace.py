#!/usr/bin/env python3
"""
Backward-compatible wrapper around metrics/trace_ultimate.py.

Legacy behavior:
  python analyze_chrome_trace.py [trace_file]

This wrapper keeps the old default filename and output filename conventions:
- default input: trace-keet-tracing.json (in metrics dir)
- output JSON: trace_analysis_summary.json (next to trace file)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from trace_ultimate import analyze, print_report


def parse_args():
    p = argparse.ArgumentParser(description='Analyze Chrome trace (legacy wrapper)')
    p.add_argument('trace_path', nargs='?', help='Input trace path')
    p.add_argument('--output-json', dest='output_json', help='Output JSON path override')
    p.add_argument('--output-md', dest='output_md', help='Optional Markdown report path')
    p.add_argument('--baseline-json', dest='baseline_json', help='Optional baseline JSON for comparison mode')
    p.add_argument('--long-task-ms', dest='long_task_ms', type=int, default=50)
    p.add_argument('--top', dest='top', type=int, default=15)
    return p.parse_args()


def main():
    args = parse_args()

    trace_path = Path(args.trace_path) if args.trace_path else Path(__file__).parent / 'trace-keet-tracing.json'
    if not trace_path.exists():
        print(f'Error: Trace file not found: {trace_path}')
        return 1

    baseline_path = Path(args.baseline_json) if args.baseline_json else None
    if baseline_path is not None and not baseline_path.exists():
        print(f'Error: baseline JSON not found: {baseline_path}')
        return 1

    summary = analyze(
        trace_path=trace_path,
        baseline_json=baseline_path,
        long_task_ms=args.long_task_ms,
        top=args.top,
    )

    print_report(summary)

    output_json = Path(args.output_json) if args.output_json else trace_path.with_name('trace_analysis_summary.json')
    output_json.parent.mkdir(parents=True, exist_ok=True)
    with output_json.open('w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    print(f'JSON summary written to: {output_json}')

    if args.output_md:
        from trace_ultimate import build_markdown

        output_md = Path(args.output_md)
        output_md.parent.mkdir(parents=True, exist_ok=True)
        output_md.write_text(build_markdown(summary), encoding='utf-8')
        print(f'Markdown report written to: {output_md}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
