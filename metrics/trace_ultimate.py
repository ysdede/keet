#!/usr/bin/env python3
"""
Ultimate Chrome trace analyzer for Keet.

Usage examples:
  python metrics/trace_ultimate.py traces/Trace-20260217T235732.json \
    --output-json traces/baseline.ultimate.json \
    --output-md traces/baseline.ultimate.md

  python metrics/trace_ultimate.py traces/Trace-after.json \
    --baseline-json traces/baseline.ultimate.json \
    --output-json traces/after.ultimate.json \
    --output-md traces/after.ultimate.md
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import mean


def to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def percentile(sorted_vals, q):
    if not sorted_vals:
        return 0.0
    idx = int(max(0.0, min(1.0, q)) * (len(sorted_vals) - 1))
    return sorted_vals[idx]


def load_trace(trace_path: Path):
    with trace_path.open('r', encoding='utf-8') as f:
        raw = json.load(f)
    if isinstance(raw, dict):
        events = raw.get('traceEvents', [])
    elif isinstance(raw, list):
        events = raw
    else:
        events = []
    if not isinstance(events, list):
        raise ValueError('Invalid trace format: traceEvents is not a list')
    events = [e for e in events if isinstance(e, dict)]
    return events


def trace_duration_s(events, renderer_pid=None):
    scoped = events
    if renderer_pid is not None:
        scoped = [e for e in events if e.get('pid') == renderer_pid and e.get('ph') == 'X']
        if not scoped:
            scoped = [e for e in events if e.get('pid') == renderer_pid]

    points = []
    for e in scoped:
        ts = to_float(e.get('ts'), None)
        if ts is None:
            continue
        dur = to_float(e.get('dur'), 0.0)
        points.append(ts)
        points.append(ts + dur)

    if not points:
        return 0.0
    return round((max(points) - min(points)) / 1_000_000.0, 2)


def build_meta(events):
    pid_names = {}
    tid_names = {}
    worker_urls = {}

    for e in events:
        ph = e.get('ph')
        name = e.get('name')
        pid = e.get('pid')
        tid = e.get('tid')
        args = e.get('args') or {}

        if ph == 'M' and name == 'process_name' and pid is not None:
            pname = (args.get('name') or '').strip()
            if pname:
                pid_names[int(pid)] = pname
        elif ph == 'M' and name == 'thread_name' and pid is not None and tid is not None:
            tname = (args.get('name') or '').strip()
            if tname:
                tid_names[(int(pid), int(tid))] = tname

        if name == 'TracingSessionIdForWorker':
            data = args.get('data') if isinstance(args.get('data'), dict) else args
            if isinstance(data, dict):
                wt = data.get('workerThreadId')
                if wt is None:
                    wt = tid
                url = data.get('url') or data.get('scriptURL') or data.get('workerUrl')
                if wt is not None and url:
                    worker_urls[int(wt)] = str(url)

    renderer_pids = [pid for pid, n in pid_names.items() if 'renderer' in n.lower()]
    gpu_pid = next((pid for pid, n in pid_names.items() if 'gpu process' in n.lower()), None)

    renderer_pid = None
    if renderer_pids:
        has_main = [
            pid for pid in renderer_pids
            if any(p == pid and name == 'CrRendererMain' for (p, _), name in tid_names.items())
        ]
        if has_main:
            renderer_pid = has_main[0]
        else:
            counts = defaultdict(int)
            for (pid, _), _ in tid_names.items():
                if pid in renderer_pids:
                    counts[pid] += 1
            renderer_pid = max(counts, key=counts.get) if counts else renderer_pids[0]

    main_tid = None
    compositor_tid = None
    audio_tid = None
    worker_tids = []

    if renderer_pid is not None:
        for (pid, tid), name in tid_names.items():
            if pid != renderer_pid:
                continue
            if name == 'CrRendererMain':
                main_tid = tid
            elif name == 'Compositor':
                compositor_tid = tid
            elif 'AudioWorklet' in name:
                audio_tid = tid
            elif name == 'DedicatedWorker thread':
                worker_tids.append(tid)

    return {
        'pid_names': pid_names,
        'tid_names': tid_names,
        'worker_urls': worker_urls,
        'ids': {
            'renderer_pid': renderer_pid,
            'main_tid': main_tid,
            'compositor_tid': compositor_tid,
            'audio_worklet_tid': audio_tid,
            'worker_tids': sorted(set(worker_tids)),
            'gpu_pid': gpu_pid,
        },
    }


def collect_x(events, renderer_pid, tid=None):
    out = []
    if renderer_pid is None:
        return out
    for e in events:
        if e.get('ph') != 'X':
            continue
        if e.get('pid') != renderer_pid:
            continue
        if tid is not None and e.get('tid') != tid:
            continue
        out.append(e)
    return out


def summarize_thread(events, renderer_pid, tid, label, long_task_ms=50, top=15):
    if renderer_pid is None or tid is None:
        return {
            'tid': tid,
            'label': label,
            'event_count': 0,
            'total_dur_ms': 0.0,
            'long_tasks': {'threshold_ms': long_task_ms, 'count': 0, 'max_ms': 0.0},
            'handle_post_message': {'count': 0, 'total_ms': 0.0, 'max_ms': 0.0, 'p95_ms': 0.0},
            'top_names': [],
        }

    xs = collect_x(events, renderer_pid, tid)
    total_ms = sum(to_float(e.get('dur')) for e in xs) / 1000.0
    by_name = defaultdict(lambda: {'count': 0, 'total_us': 0.0, 'max_us': 0.0})
    longs = []
    hpm = []
    threshold_us = long_task_ms * 1000.0

    for e in xs:
        name = str(e.get('name') or '?')
        dur_us = to_float(e.get('dur'))
        s = by_name[name]
        s['count'] += 1
        s['total_us'] += dur_us
        s['max_us'] = max(s['max_us'], dur_us)
        if dur_us >= threshold_us:
            longs.append(dur_us / 1000.0)
        if name == 'HandlePostMessage':
            hpm.append(dur_us / 1000.0)

    top_rows = sorted(by_name.items(), key=lambda kv: kv[1]['total_us'], reverse=True)[:top]
    top_names = [
        {
            'name': n,
            'count': int(s['count']),
            'total_ms': round(s['total_us'] / 1000.0, 1),
            'max_ms': round(s['max_us'] / 1000.0, 2),
        }
        for n, s in top_rows
    ]

    hpm_sorted = sorted(hpm)
    return {
        'tid': tid,
        'label': label,
        'event_count': len(xs),
        'total_dur_ms': round(total_ms, 1),
        'long_tasks': {
            'threshold_ms': long_task_ms,
            'count': len(longs),
            'max_ms': round(max(longs), 2) if longs else 0.0,
        },
        'handle_post_message': {
            'count': len(hpm),
            'total_ms': round(sum(hpm), 1),
            'max_ms': round(max(hpm), 2) if hpm else 0.0,
            'p95_ms': round(percentile(hpm_sorted, 0.95), 2) if hpm else 0.0,
        },
        'top_names': top_names,
    }

def summarize_gc(events, renderer_pid):
    if renderer_pid is None:
        return {'count': 0, 'total_ms': 0.0, 'by_thread': {}}

    by_thread = defaultdict(lambda: {'count': 0, 'total_us': 0.0, 'max_us': 0.0})
    total_count = 0
    total_us = 0.0

    for e in collect_x(events, renderer_pid):
        name = str(e.get('name') or '')
        cat = str(e.get('cat') or '')
        if 'gc' not in name.lower() and 'gc' not in cat.lower():
            continue
        tid = int(e.get('tid'))
        dur_us = to_float(e.get('dur'))
        s = by_thread[tid]
        s['count'] += 1
        s['total_us'] += dur_us
        s['max_us'] = max(s['max_us'], dur_us)
        total_count += 1
        total_us += dur_us

    payload = {
        str(tid): {
            'count': int(s['count']),
            'total_ms': round(s['total_us'] / 1000.0, 1),
            'max_ms': round(s['max_us'] / 1000.0, 2),
        }
        for tid, s in sorted(by_thread.items(), key=lambda kv: kv[1]['total_us'], reverse=True)
    }
    return {'count': total_count, 'total_ms': round(total_us / 1000.0, 1), 'by_thread': payload}


def render_summary(main_summary, duration_s):
    by_name = {r['name']: r for r in main_summary.get('top_names', [])}

    def row(name):
        r = by_name.get(name, {})
        count = int(r.get('count', 0))
        total_ms = to_float(r.get('total_ms'))
        rate = count / duration_s if duration_s > 0 else 0.0
        return {'count': count, 'total_ms': round(total_ms, 1), 'rate_per_s': round(rate, 2)}

    return {
        'fire_animation_frame': row('FireAnimationFrame'),
        'page_animator_scripted': row('PageAnimator::serviceScriptedAnimations'),
        'commit': row('Commit'),
        'update_layout_tree': row('UpdateLayoutTree'),
    }


def audioworklet_intervals(events, renderer_pid, audio_tid):
    if renderer_pid is None or audio_tid is None:
        return {'event_name': None, 'count': 0}

    xs = collect_x(events, renderer_pid, audio_tid)
    run_a = [e for e in xs if str(e.get('name')) == 'RunTask']
    run_b = [e for e in xs if str(e.get('name')) == 'ThreadControllerImpl::RunTask']
    use = run_b if len(run_b) > len(run_a) else run_a

    if len(use) < 2:
        return {'event_name': 'RunTask', 'count': len(use)}

    use = sorted(use, key=lambda e: to_float(e.get('ts')))
    ts = [to_float(e.get('ts')) for e in use]
    durs = [to_float(e.get('dur')) / 1000.0 for e in use]
    intervals = [(ts[i + 1] - ts[i]) / 1000.0 for i in range(len(ts) - 1)]

    durs_sorted = sorted(durs)
    ints_sorted = sorted(intervals)

    return {
        'event_name': str(use[0].get('name')),
        'count': len(use),
        'duration_ms': {
            'avg': round(mean(durs), 3),
            'p95': round(percentile(durs_sorted, 0.95), 3),
            'max': round(max(durs), 3),
        },
        'interval_ms': {
            'avg': round(mean(intervals), 3),
            'p50': round(percentile(ints_sorted, 0.5), 3),
            'p95': round(percentile(ints_sorted, 0.95), 3),
            'max': round(max(intervals), 3),
        },
    }


def infer_worker_roles(worker_urls):
    roles = {}
    for tid, url in worker_urls.items():
        low = url.lower()
        if 'transcription.worker' in low:
            roles['transcription'] = tid
        elif 'tenvad.worker' in low:
            roles['tenvad'] = tid
        elif 'mel.worker' in low:
            roles['mel'] = tid
        elif 'buffer.worker' in low:
            roles['buffer'] = tid
    return roles


def get_gc_ms(gc_summary, tid):
    if tid is None:
        return 0.0
    return to_float((gc_summary.get('by_thread', {}).get(str(tid), {})).get('total_ms'))


def mk_activity(threads):
    rows = []
    for t in threads:
        rows.append({'label': t['label'], 'tid': t.get('tid'), 'total_dur_ms': t.get('total_dur_ms', 0.0)})
    rows.sort(key=lambda x: to_float(x.get('total_dur_ms')), reverse=True)
    return rows


def compute_kpis(duration_s, main, render, aw_ints, thread_by_tid, roles, gc):
    tx_tid = roles.get('transcription')
    ten_tid = roles.get('tenvad')
    mel_tid = roles.get('mel')

    tx = thread_by_tid.get(tx_tid, {})
    ten = thread_by_tid.get(ten_tid, {})
    mel = thread_by_tid.get(mel_tid, {})

    tx_long = tx.get('long_tasks', {})
    awi = aw_ints.get('interval_ms', {})

    return {
        'trace_duration_s': round(duration_s, 2),
        'main_total_ms': round(to_float(main.get('total_dur_ms')), 1),
        'main_long_tasks_count': int(main.get('long_tasks', {}).get('count', 0)),
        'fire_animation_frame_rate_per_s': round(to_float(render.get('fire_animation_frame', {}).get('rate_per_s')), 2),
        'page_animator_total_ms': round(to_float(render.get('page_animator_scripted', {}).get('total_ms')), 1),
        'transcription_worker_total_ms': round(to_float(tx.get('total_dur_ms')), 1),
        'transcription_worker_gc_total_ms': round(get_gc_ms(gc, tx_tid), 1),
        'transcription_worker_long_tasks_count': int(tx_long.get('count', 0)),
        'transcription_worker_long_task_max_ms': round(to_float(tx_long.get('max_ms')), 2),
        'tenvad_worker_total_ms': round(to_float(ten.get('total_dur_ms')), 1),
        'mel_worker_total_ms': round(to_float(mel.get('total_dur_ms')), 1),
        'audio_worklet_runtask_interval_p95_ms': round(to_float(awi.get('p95')), 3),
        'audio_worklet_runtask_interval_max_ms': round(to_float(awi.get('max')), 3),
    }


def compare_kpis(current, baseline):
    out = {}
    keys = sorted(set(current.keys()) & set(baseline.keys()))
    for k in keys:
        c = current[k]
        b = baseline[k]
        if not isinstance(c, (int, float)) or not isinstance(b, (int, float)):
            continue
        delta = float(c) - float(b)
        pct = None if b == 0 else round((delta / float(b)) * 100.0, 2)
        out[k] = {
            'baseline': b,
            'current': c,
            'delta_abs': round(delta, 3),
            'delta_pct': pct,
        }
    return out

def rank_bottlenecks(duration_s, main, thread_by_tid, roles, gc, render, aw_thread, aw_ints):
    rows = []

    tx_tid = roles.get('transcription')
    tx = thread_by_tid.get(tx_tid)
    if tx:
        tx_total = to_float(tx.get('total_dur_ms'))
        tx_gc = get_gc_ms(gc, tx_tid)
        tx_long = tx.get('long_tasks', {})
        tx_long_count = int(tx_long.get('count', 0))
        tx_long_max = to_float(tx_long.get('max_ms'))
        score = tx_total + tx_gc * 5 + tx_long_count * 6 + tx_long_max * 2
        rows.append({
            'category': 'transcription_worker_hot_path',
            'title': 'Transcription worker hot path',
            'score': round(score, 1),
            'impact': 'Primary CPU and tail-latency source',
            'evidence': {
                'tid': tx_tid,
                'total_dur_ms': round(tx_total, 1),
                'share_of_trace_pct': round((tx_total / (duration_s * 1000.0)) * 100.0, 1) if duration_s > 0 else 0.0,
                'long_tasks_over_threshold': tx_long_count,
                'max_long_task_ms': round(tx_long_max, 2),
                'gc_total_ms': round(tx_gc, 1),
            },
        })

    main_total = to_float(main.get('total_dur_ms'))
    raf = render.get('fire_animation_frame', {})
    page = render.get('page_animator_scripted', {})
    commit = render.get('commit', {})
    layout = render.get('update_layout_tree', {})
    render_score = (
        main_total * 0.15
        + to_float(page.get('total_ms'))
        + to_float(commit.get('total_ms'))
        + to_float(layout.get('total_ms'))
        + to_float(raf.get('rate_per_s')) * 10
    )
    rows.append({
        'category': 'main_thread_render_churn',
        'title': 'Main-thread animation/render churn',
        'score': round(render_score, 1),
        'impact': 'Sustained UI CPU pressure',
        'evidence': {
            'total_dur_ms': round(main_total, 1),
            'share_of_trace_pct': round((main_total / (duration_s * 1000.0)) * 100.0, 1) if duration_s > 0 else 0.0,
            'fire_animation_frame_rate_per_s': raf.get('rate_per_s', 0.0),
            'page_animator_total_ms': page.get('total_ms', 0.0),
            'commit_total_ms': commit.get('total_ms', 0.0),
            'update_layout_tree_total_ms': layout.get('total_ms', 0.0),
        },
    })

    for role, title, impact in [
        ('tenvad', 'TEN-VAD worker messaging/processing', 'Medium CPU load'),
        ('mel', 'Mel worker messaging/processing', 'Medium CPU load'),
        ('buffer', 'Buffer worker', 'Low impact currently'),
    ]:
        tid = roles.get(role)
        ws = thread_by_tid.get(tid)
        if not ws:
            continue
        hp = ws.get('handle_post_message', {})
        total = to_float(ws.get('total_dur_ms'))
        score = total + to_float(hp.get('total_ms')) * 2
        rows.append({
            'category': f'{role}_worker',
            'title': title,
            'score': round(score, 1),
            'impact': impact,
            'evidence': {
                'tid': tid,
                'total_dur_ms': round(total, 1),
                'handle_post_message_count': int(hp.get('count', 0)),
                'handle_post_message_total_ms': round(to_float(hp.get('total_ms')), 1),
            },
        })

    aw_total = to_float(aw_thread.get('total_dur_ms')) if aw_thread else 0.0
    aw_p95 = to_float(aw_ints.get('interval_ms', {}).get('p95'))
    aw_max = to_float(aw_ints.get('interval_ms', {}).get('max'))
    if aw_total > 0 or aw_p95 > 0:
        score = aw_total + aw_p95 * 20 + aw_max * 5
        rows.append({
            'category': 'audio_worklet_scheduling',
            'title': 'AudioWorklet scheduling pressure',
            'score': round(score, 1),
            'impact': 'Secondary jitter risk',
            'evidence': {
                'tid': aw_thread.get('tid') if aw_thread else None,
                'total_dur_ms': round(aw_total, 1),
                'interval_p95_ms': round(aw_p95, 3),
                'interval_max_ms': round(aw_max, 3),
            },
        })

    rows.sort(key=lambda x: to_float(x.get('score')), reverse=True)
    for i, row in enumerate(rows, 1):
        row['rank'] = i
    return rows


def build_markdown(summary):
    lines = []
    lines.append('# Trace Ultimate Report')
    lines.append('')
    lines.append(f"- Trace: `{summary['trace_file']}`")
    lines.append(f"- Duration: `{summary['trace_duration_s']}s`")
    lines.append(f"- Total events: `{summary['total_events']}`")
    lines.append('')

    lines.append('## Ranked Bottlenecks')
    lines.append('')
    lines.append('| Rank | Bottleneck | Impact | Key Evidence |')
    lines.append('|---:|---|---|---|')
    for row in summary.get('bottlenecks', []):
        ev = row.get('evidence', {})
        ev_bits = ', '.join([f"{k}={ev[k]}" for k in list(ev.keys())[:4]])
        lines.append(f"| {row['rank']} | {row['title']} | {row['impact']} | {ev_bits} |")
    lines.append('')

    lines.append('## KPI Snapshot')
    lines.append('')
    lines.append('| KPI | Value |')
    lines.append('|---|---:|')
    for k, v in summary.get('kpis', {}).items():
        lines.append(f'| `{k}` | {v} |')
    lines.append('')

    if summary.get('compare'):
        lines.append('## Baseline Comparison')
        lines.append('')
        lines.append('| KPI | Baseline | Current | Delta | Delta % |')
        lines.append('|---|---:|---:|---:|---:|')
        for k, row in summary['compare'].items():
            pct = '' if row['delta_pct'] is None else f"{row['delta_pct']:.2f}%"
            lines.append(f"| `{k}` | {row['baseline']} | {row['current']} | {row['delta_abs']} | {pct} |")
        lines.append('')

    lines.append('## Thread Activity')
    lines.append('')
    lines.append('| Label | TID | Total ms |')
    lines.append('|---|---:|---:|')
    for row in summary.get('thread_activity', []):
        lines.append(f"| {row['label']} | {row.get('tid', '')} | {row['total_dur_ms']} |")
    lines.append('')

    return '\n'.join(lines)


def print_report(summary):
    print('=' * 88)
    print('KEET TRACE ULTIMATE ANALYZER')
    print('=' * 88)
    print(f"Trace file      : {summary['trace_file']}")
    print(f"Trace duration  : {summary['trace_duration_s']}s")
    print(f"Total events    : {summary['total_events']}")
    ids = summary.get('thread_ids', {})
    print(
        'Renderer map    : '
        f"pid={ids.get('renderer_pid')} main={ids.get('main_tid')} "
        f"compositor={ids.get('compositor_tid')} audio={ids.get('audio_worklet_tid')}"
    )
    print('')

    print('Top Thread Activity')
    for row in summary.get('thread_activity', [])[:10]:
        print(f"  {row['label']:<30} tid={str(row.get('tid')):<8} total={row['total_dur_ms']:>8}ms")

    print('')
    print('Ranked Bottlenecks')
    for row in summary.get('bottlenecks', []):
        ev = row.get('evidence', {})
        ev_bits = ', '.join([f"{k}={ev[k]}" for k in list(ev.keys())[:4]])
        print(f"  {row['rank']:>2}. {row['title']} | impact={row['impact']} | score={row['score']} | {ev_bits}")

    print('')
    print('KPI Snapshot')
    for k, v in summary.get('kpis', {}).items():
        print(f'  {k:<45} {v}')

    if summary.get('compare'):
        print('')
        print('Baseline Delta')
        for k, row in summary['compare'].items():
            pct = 'n/a' if row['delta_pct'] is None else f"{row['delta_pct']:.2f}%"
            print(f"  {k:<45} baseline={row['baseline']} current={row['current']} delta={row['delta_abs']} ({pct})")

    print('=' * 88)

def analyze(trace_path, baseline_json=None, long_task_ms=50, top=15):
    events = load_trace(trace_path)
    meta = build_meta(events)
    ids = meta['ids']
    renderer_pid = ids['renderer_pid']

    threads = []
    if ids['main_tid'] is not None:
        threads.append(summarize_thread(events, renderer_pid, ids['main_tid'], 'Main Thread', long_task_ms, top))
    if ids['compositor_tid'] is not None:
        threads.append(summarize_thread(events, renderer_pid, ids['compositor_tid'], 'Compositor', long_task_ms, top))
    if ids['audio_worklet_tid'] is not None:
        threads.append(summarize_thread(events, renderer_pid, ids['audio_worklet_tid'], 'AudioWorklet', long_task_ms, top))
    for tid in ids['worker_tids']:
        threads.append(summarize_thread(events, renderer_pid, tid, f'Worker-{tid}', long_task_ms, top))

    by_tid = {t['tid']: t for t in threads if t.get('tid') is not None}
    main = next((t for t in threads if t['label'] == 'Main Thread'), {})
    aw_thread = next((t for t in threads if t['label'] == 'AudioWorklet'), {})

    gc = summarize_gc(events, renderer_pid)
    roles = infer_worker_roles(meta['worker_urls'])
    duration_s = trace_duration_s(events, renderer_pid=renderer_pid)
    render = render_summary(main, duration_s)
    aw_ints = audioworklet_intervals(events, renderer_pid, ids['audio_worklet_tid'])

    bottlenecks = rank_bottlenecks(duration_s, main, by_tid, roles, gc, render, aw_thread, aw_ints)
    kpis = compute_kpis(duration_s, main, render, aw_ints, by_tid, roles, gc)

    compare = None
    if baseline_json is not None:
        with baseline_json.open('r', encoding='utf-8') as f:
            baseline = json.load(f)
        baseline_kpis = baseline.get('kpis', {}) if isinstance(baseline, dict) else {}
        if isinstance(baseline_kpis, dict):
            compare = compare_kpis(kpis, baseline_kpis)

    summary = {
        'version': 'ultimate-1.0',
        'trace_file': trace_path.name,
        'trace_path': str(trace_path),
        'total_events': len(events),
        'trace_duration_s': duration_s,
        'thread_ids': ids,
        'process_names': {str(pid): name for pid, name in meta['pid_names'].items()},
        'thread_names': {f'{pid}:{tid}': name for (pid, tid), name in meta['tid_names'].items()},
        'worker_urls_by_tid': {str(tid): url for tid, url in sorted(meta['worker_urls'].items())},
        'worker_roles': roles,
        'thread_activity': mk_activity(threads),
        'threads': {str(t['tid']): t for t in threads if t.get('tid') is not None},
        'gc': gc,
        'render_loop': render,
        'audio_worklet_intervals': aw_ints,
        'bottlenecks': bottlenecks,
        'kpis': kpis,
        'compare': compare,
    }
    return summary


def parse_args():
    p = argparse.ArgumentParser(description='Ultimate Chrome trace analyzer for Keet')
    p.add_argument('trace_path', help='Input Chrome trace JSON path')
    p.add_argument('--output-json', dest='output_json', help='Output JSON path')
    p.add_argument('--output-md', dest='output_md', help='Output Markdown path')
    p.add_argument('--baseline-json', dest='baseline_json', help='Baseline analyzer JSON path')
    p.add_argument('--window-sec', dest='window_sec', type=int, default=30, help='Reserved for trend window size')
    p.add_argument('--long-task-ms', dest='long_task_ms', type=int, default=50, help='Long task threshold in ms')
    p.add_argument('--top', dest='top', type=int, default=15, help='Top rows per thread')
    return p.parse_args()


def run_cli(args):
    trace_path = Path(args.trace_path)
    if not trace_path.exists():
        print(f'Error: trace file not found: {trace_path}')
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

    out_json = Path(args.output_json) if args.output_json else trace_path.with_name('trace_ultimate_summary.json')
    out_json.parent.mkdir(parents=True, exist_ok=True)
    with out_json.open('w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    print(f'JSON written: {out_json}')

    if args.output_md:
        out_md = Path(args.output_md)
        out_md.parent.mkdir(parents=True, exist_ok=True)
        out_md.write_text(build_markdown(summary), encoding='utf-8')
        print(f'Markdown written: {out_md}')

    return 0


def main():
    return run_cli(parse_args())


if __name__ == '__main__':
    raise SystemExit(main())
