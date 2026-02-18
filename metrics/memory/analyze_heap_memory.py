#!/usr/bin/env python3
from __future__ import annotations

import argparse
import bisect
import glob
import json
import re
import shlex
import sys
from collections import Counter, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

TIMESTAMP_RE = re.compile(r"Heap-(\d{8}T\d{6})")
SUFFIXES = {".heapsnapshot", ".heaptimeline"}
BUCKETS = [
    ("detached_dom", "Detached DOM", []),
    ("listeners", "Listener-Related", ["eventlistener", "listener"]),
    ("collections", "Arrays/Maps/Queues", ["array", "map", "set", "queue", "list"]),
    (
        "buffers_typed",
        "Buffers/Typed Arrays",
        ["arraybuffer", "jsarraybufferdata", "float32array", "uint8array", "dataview"],
    ),
    ("worker_message", "Worker/Message", ["worker", "messageport", "messageevent"]),
    (
        "audio_render_debug",
        "Audio/Render/Debug/Perf",
        ["audio", "canvas", "render", "gpu", "performance", "debug"],
    ),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def bfmt(v: int) -> str:
    u = ["B", "KB", "MB", "GB"]
    x = float(v)
    for unit in u:
        if abs(x) < 1024 or unit == u[-1]:
            return f"{x:.2f} {unit}"
        x /= 1024
    return f"{v} B"


def parse_ts(name: str) -> Optional[datetime]:
    m = TIMESTAMP_RE.search(name)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y%m%dT%H%M%S")
    except ValueError:
        return None


@dataclass(frozen=True)
class CaptureFile:
    path: Path
    kind: str
    ts: Optional[datetime]
    mtime: float

    @property
    def id(self) -> str:
        return self.path.name

    @property
    def sort_time(self) -> datetime:
        return self.ts if self.ts else datetime.fromtimestamp(self.mtime)


def discover(inputs: Sequence[str]) -> List[CaptureFile]:
    if not inputs:
        raise ValueError("No --inputs provided.")
    found: Dict[str, CaptureFile] = {}
    for item in inputs:
        matches = glob.glob(item, recursive=True)
        cands = [Path(x) for x in matches] if matches else ([Path(item)] if Path(item).exists() else [])
        for p in cands:
            if p.is_dir():
                for q in p.rglob("*"):
                    if q.is_file() and q.suffix.lower() in SUFFIXES:
                        k = "timeline" if q.suffix.lower() == ".heaptimeline" else "snapshot"
                        found[str(q.resolve())] = CaptureFile(q.resolve(), k, parse_ts(q.name), q.stat().st_mtime)
                continue
            if not p.is_file() or p.suffix.lower() not in SUFFIXES:
                continue
            k = "timeline" if p.suffix.lower() == ".heaptimeline" else "snapshot"
            found[str(p.resolve())] = CaptureFile(p.resolve(), k, parse_ts(p.name), p.stat().st_mtime)
    out = sorted(found.values(), key=lambda c: (c.sort_time, c.path.name.lower()))
    if not out:
        raise ValueError("No .heapsnapshot/.heaptimeline files found.")
    return out


def validate(payload: Dict[str, Any], strict: bool) -> List[str]:
    issues: List[str] = []
    for k in ["snapshot", "nodes", "edges", "strings"]:
        if k not in payload:
            issues.append(f"missing key: {k}")
    snap = payload.get("snapshot", {})
    meta = snap.get("meta", {})
    if not isinstance(meta, dict):
        issues.append("missing snapshot.meta")
    nf = meta.get("node_fields", [])
    ef = meta.get("edge_fields", [])
    if not isinstance(nf, list) or not isinstance(ef, list):
        issues.append("invalid node_fields/edge_fields")
    if isinstance(payload.get("nodes"), list) and isinstance(nf, list) and nf:
        if len(payload["nodes"]) % len(nf) != 0:
            issues.append("nodes shape mismatch")
        c = len(payload["nodes"]) // len(nf)
        if isinstance(snap.get("node_count"), int) and c != snap["node_count"]:
            issues.append(f"node_count mismatch {snap['node_count']} vs {c}")
    if isinstance(payload.get("edges"), list) and isinstance(ef, list) and ef:
        if len(payload["edges"]) % len(ef) != 0:
            issues.append("edges shape mismatch")
        c = len(payload["edges"]) // len(ef)
        if isinstance(snap.get("edge_count"), int) and c != snap["edge_count"]:
            issues.append(f"edge_count mismatch {snap['edge_count']} vs {c}")
    if strict and issues:
        raise ValueError("; ".join(issues))
    return issues


class G:
    def __init__(self, payload: Dict[str, Any]) -> None:
        self.payload = payload
        s, m = payload["snapshot"], payload["snapshot"]["meta"]
        self.nodes, self.edges, self.strings = payload["nodes"], payload["edges"], payload["strings"]
        self.nf, self.ef = m["node_fields"], m["edge_fields"]
        self.nfc, self.efc = len(self.nf), len(self.ef)
        self.n, self.e = s["node_count"], s["edge_count"]
        self.extra_native = int(s.get("extra_native_bytes", 0))
        self.nti, self.nni = self.nf.index("type"), self.nf.index("name")
        self.nii, self.nsi = self.nf.index("id"), self.nf.index("self_size")
        self.neci, self.ndi = self.nf.index("edge_count"), self.nf.index("detachedness")
        self.eti, self.eni, self.eto = self.ef.index("type"), self.ef.index("name_or_index"), self.ef.index("to_node")
        self.ntypes, self.etypes = m["node_types"][self.nti], m["edge_types"][self.eti]
        self.typ = [""] * self.n
        self.name = [""] * self.n
        self.oid = [0] * self.n
        self.selfs = [0] * self.n
        self.ec = [0] * self.n
        self.det = [0] * self.n
        self.estart = [0] * self.n
        cur = 0
        for i in range(self.n):
            b = i * self.nfc
            t = self.nodes[b + self.nti]
            nm = self.nodes[b + self.nni]
            self.typ[i] = self.ntypes[t]
            self.name[i] = self.strings[nm] if 0 <= nm < len(self.strings) else f"<s:{nm}>"
            self.oid[i] = self.nodes[b + self.nii]
            self.selfs[i] = self.nodes[b + self.nsi]
            self.ec[i] = self.nodes[b + self.neci]
            self.det[i] = self.nodes[b + self.ndi]
            self.estart[i] = cur
            cur += self.ec[i] * self.efc
        self.pred = [[] for _ in range(self.n)]
        self.strong_edges = 0
        for v in range(self.n):
            st, en = self.estart[v], self.estart[v] + self.ec[v] * self.efc
            for p in range(st, en, self.efc):
                et = self.etypes[self.edges[p + self.eti]]
                if et == "weak":
                    continue
                w = self.edges[p + self.eto] // self.nfc
                self.pred[w].append(v)
                self.strong_edges += 1

    def edge_name(self, et: str, noi: int) -> str:
        return str(noi) if et == "element" else (self.strings[noi] if 0 <= noi < len(self.strings) else str(noi))

    def out(self, i: int, strong: bool = True) -> Iterable[Tuple[str, str, int]]:
        st, en = self.estart[i], self.estart[i] + self.ec[i] * self.efc
        for p in range(st, en, self.efc):
            et = self.etypes[self.edges[p + self.eti]]
            if strong and et == "weak":
                continue
            to = self.edges[p + self.eto] // self.nfc
            yield et, self.edge_name(et, self.edges[p + self.eni]), to


def dominators(g: G, root: int = 0) -> Dict[str, Any]:
    n = g.n
    par, dfsn, seen, vert = [-1] * n, [0] * n, [False] * n, [-1]
    st = [(root, 0, 0)]
    k = 0
    while st:
        v, pos, mode = st.pop()
        if mode == 0:
            if seen[v]:
                continue
            seen[v] = True
            k += 1
            dfsn[v] = k
            vert.append(v)
            st.append((v, g.estart[v], 1))
            continue
        p, end = pos, g.estart[v] + g.ec[v] * g.efc
        while p < end:
            et = g.etypes[g.edges[p + g.eti]]
            if et != "weak":
                w = g.edges[p + g.eto] // g.nfc
                if not seen[w]:
                    par[w] = v
                    st.append((v, p + g.efc, 1))
                    st.append((w, 0, 0))
                    break
            p += g.efc
    N, idom = k, [-1] * n
    if N == 0:
        return {"idom": idom, "ret": [0] * n, "dfsn": dfsn, "child": [[] for _ in range(n)], "reach": 0}
    semi, anc, lab, buck = [0] * n, [-1] * n, list(range(n)), [[] for _ in range(n)]
    for i in range(1, N + 1):
        v = vert[i]
        semi[v] = i
        lab[v] = v

    def comp(v: int) -> None:
        if anc[v] != -1 and anc[anc[v]] != -1:
            comp(anc[v])
            if semi[lab[anc[v]]] < semi[lab[v]]:
                lab[v] = lab[anc[v]]
            anc[v] = anc[anc[v]]

    def evalv(v: int) -> int:
        if anc[v] == -1:
            return lab[v]
        comp(v)
        return lab[anc[v]] if semi[lab[anc[v]]] < semi[lab[v]] else lab[v]

    for i in range(N, 1, -1):
        w, s = vert[i], semi[vert[i]]
        for v in g.pred[w]:
            if dfsn[v] == 0:
                continue
            u = evalv(v)
            if semi[u] < s:
                s = semi[u]
        semi[w] = s
        buck[vert[s]].append(w)
        pw = par[w] if par[w] != -1 else root
        anc[w] = pw
        for v in buck[pw]:
            u = evalv(v)
            idom[v] = u if semi[u] < semi[v] else pw
        buck[pw].clear()
    for i in range(2, N + 1):
        w = vert[i]
        if idom[w] != vert[semi[w]]:
            idom[w] = idom[idom[w]]
    idom[root] = root
    child = [[] for _ in range(n)]
    for v in range(n):
        if v == root or dfsn[v] == 0:
            continue
        p = idom[v]
        if p != -1:
            child[p].append(v)
    ret, post = [0] * n, []
    st2 = [(root, 0)]
    while st2:
        v, mode = st2.pop()
        if mode == 0:
            st2.append((v, 1))
            for c in child[v]:
                st2.append((c, 0))
        else:
            post.append(v)
    for v in post:
        ret[v] = g.selfs[v] + sum(ret[c] for c in child[v])
    return {"idom": idom, "ret": ret, "dfsn": dfsn, "child": child, "reach": sum(1 for x in dfsn if x > 0)}


def bfs_paths(g: G, root: int = 0) -> Tuple[List[int], List[str]]:
    par, pedge, seen = [-1] * g.n, [""] * g.n, [False] * g.n
    q: deque[int] = deque([root])
    seen[root] = True
    while q:
        v = q.popleft()
        for et, en, w in g.out(v, strong=True):
            if seen[w]:
                continue
            seen[w] = True
            par[w] = v
            pedge[w] = f"{et}:{en}"
            q.append(w)
    return par, pedge


def path_to(g: G, par: List[int], pedge: List[str], node: Optional[int]) -> Dict[str, Any]:
    if node is None or node < 0 or node >= g.n or (node != 0 and par[node] == -1):
        return {"reachable": False, "path_nodes": [], "path_text": "N/A"}
    chain = [node]
    x = node
    while x != 0 and par[x] != -1 and len(chain) < 30:
        x = par[x]
        chain.append(x)
    chain.reverse()
    nodes, parts = [], []
    for i, idx in enumerate(chain):
        item = {
            "node_index": idx,
            "node_type": g.typ[idx],
            "constructor": g.name[idx],
            "self_size": g.selfs[idx],
            "object_id": g.oid[idx],
            "edge_from_parent": None if i == 0 else pedge[idx],
        }
        nodes.append(item)
        if i == 0:
            parts.append(f"#{idx} {g.typ[idx]} {g.name[idx]!r} self={g.selfs[idx]} id={g.oid[idx]}")
        else:
            parts.append(f"--{pedge[idx]}--> #{idx} {g.typ[idx]} {g.name[idx]!r} self={g.selfs[idx]} id={g.oid[idx]}")
    return {"reachable": True, "path_nodes": nodes, "path_text": " ".join(parts)}


@dataclass
class HeapGraph:
    raw: G
    idom: List[int]
    retained: List[int]
    dfsn: List[int]
    children: List[List[int]]
    reach: int
    parent: List[int]
    parent_edge: List[str]

    @classmethod
    def from_payload(cls, payload: Dict[str, Any], root: int = 0) -> "HeapGraph":
        g = G(payload)
        dom = dominators(g, root)
        parent, parent_edge = bfs_paths(g, root)
        return cls(
            raw=g,
            idom=dom["idom"],
            retained=dom["ret"],
            dfsn=dom["dfsn"],
            children=dom["child"],
            reach=dom["reach"],
            parent=parent,
            parent_edge=parent_edge,
        )

    def path_to(self, node: Optional[int]) -> Dict[str, Any]:
        return path_to(self.raw, self.parent, self.parent_edge, node)


@dataclass
class A:
    cap: CaptureFile
    issues: List[str]
    hg: HeapGraph
    g: G
    c_count: Counter
    c_self: Counter
    t_count: Counter
    t_self: Counter
    buckets: Dict[str, Any]
    top_ret: List[Dict[str, Any]]
    detached: Dict[str, Any]
    timeline: Dict[str, Any]


def analyze_cap(cap: CaptureFile, payload: Dict[str, Any], strict: bool, top_n: int) -> A:
    issues = validate(payload, strict)
    hg = HeapGraph.from_payload(payload, root=0)
    g = hg.raw
    c_count, c_self, t_count, t_self = Counter(), Counter(), Counter(), Counter()
    for i in range(g.n):
        c_count[g.name[i]] += 1
        c_self[g.name[i]] += g.selfs[i]
        t_count[g.typ[i]] += 1
        t_self[g.typ[i]] += g.selfs[i]
    ret = hg.retained
    top_ret = []
    for i in range(g.n):
        if i == 0 or hg.dfsn[i] == 0:
            continue
        if g.typ[i] == "synthetic" and g.name[i].startswith("("):
            continue
        top_ret.append({"node_index": i, "constructor": g.name[i], "node_type": g.typ[i], "self_size": g.selfs[i], "retained_size": ret[i], "detachedness": g.det[i], "object_id": g.oid[i]})
    top_ret.sort(key=lambda x: (x["retained_size"], x["self_size"]), reverse=True)
    det_nodes = [i for i, d in enumerate(g.det) if d]
    det_set = set(det_nodes)
    det_roots = [i for i in det_nodes if hg.idom[i] == -1 or hg.idom[i] == i or hg.idom[i] not in det_set]
    detached = {
        "detached_node_count": len(det_nodes),
        "detached_self_size": int(sum(g.selfs[i] for i in det_nodes)),
        "detached_retained_nonunique": int(sum(ret[i] for i in det_nodes)),
        "detached_retained_unique_estimate": int(sum(ret[i] for i in det_roots)),
        "detached_root_like_nodes": len(det_roots),
        "top_detached_nodes": sorted(({"node_index": i, "constructor": g.name[i], "node_type": g.typ[i], "self_size": g.selfs[i], "retained_size": ret[i], "detachedness": g.det[i]} for i in det_nodes), key=lambda x: (x["retained_size"], x["self_size"]), reverse=True)[:top_n],
    }
    names_l = [x.lower() for x in g.name]
    buckets: Dict[str, Any] = {}
    for bid, label, pats in BUCKETS:
        idxs = det_nodes if bid == "detached_dom" else [i for i, ln in enumerate(names_l) if any(p in ln for p in pats)]
        sidx = set(idxs)
        roots = [i for i in idxs if hg.idom[i] == -1 or hg.idom[i] == i or hg.idom[i] not in sidx]
        buckets[bid] = {
            "label": label,
            "count": len(idxs),
            "self_size_sum": int(sum(g.selfs[i] for i in idxs)),
            "retained_sum_nonunique": int(sum(ret[i] for i in idxs)),
            "retained_unique_estimate": int(sum(ret[i] for i in roots)),
            "top_nodes": sorted(({"node_index": i, "constructor": g.name[i], "node_type": g.typ[i], "self_size": g.selfs[i], "retained_size": ret[i], "detachedness": g.det[i]} for i in idxs), key=lambda x: (x["retained_size"], x["self_size"]), reverse=True)[:top_n],
        }
    timeline: Dict[str, Any] = {"sample_fields": [], "sample_count": 0, "top_id_growth_bursts": [], "survivor_pressure_checkpoints": []}
    if cap.kind == "timeline" or payload.get("samples"):
        sf = payload["snapshot"]["meta"].get("sample_fields", [])
        smp = payload.get("samples", [])
        timeline["sample_fields"] = sf
        if sf and smp and len(smp) % len(sf) == 0:
            w, rows = len(sf), len(smp) // len(sf)
            timeline["sample_count"] = rows
            fmap = {n: i for i, n in enumerate(sf)}
            ti, ii = fmap.get("timestamp_us", 0), fmap.get("last_assigned_id", 1 if w > 1 else None)
            if ii is not None:
                tv, iv = [int(smp[r * w + ti]) for r in range(rows)], [int(smp[r * w + ii]) for r in range(rows)]
                tmin, tmax = min(tv), max(tv)
                timeline["timestamp_range_us"] = [tmin, tmax]
                timeline["duration_seconds"] = round((tmax - tmin) / 1_000_000.0, 6)
                timeline["id_range"] = [min(iv), max(iv)]
                bursts = []
                for i in range(1, len(tv)):
                    dt, did = tv[i] - tv[i - 1], iv[i] - iv[i - 1]
                    if dt > 0:
                        bursts.append({"sample_index": i, "delta_id": did, "delta_time_us": dt, "id_per_us": did / dt})
                bursts.sort(key=lambda x: x["id_per_us"], reverse=True)
                timeline["top_id_growth_bursts"] = bursts[:top_n]
                tot = max(1, sum(g.selfs))
                for cp in [0.0, 0.25, 0.5, 0.75, 0.9, 0.99, 1.0]:
                    tt = tmin + int((tmax - tmin) * cp)
                    pos = min(len(tv) - 1, bisect.bisect_left(tv, tt))
                    thr = iv[pos]
                    ss = sum(s for oid, s in zip(g.oid, g.selfs) if oid <= thr)
                    timeline["survivor_pressure_checkpoints"].append({"checkpoint": cp, "id_threshold": thr, "survivor_self_size": ss, "survivor_ratio": ss / tot})
    return A(cap, issues, hg, g, c_count, c_self, t_count, t_self, buckets, top_ret, detached, timeline)


def top_counter(c: Counter, n: int) -> List[Dict[str, Any]]:
    return [{"name": k, "value": v} for k, v in c.most_common(n)]


def summary(a: A, n: int) -> Dict[str, Any]:
    return {
        "capture_id": a.cap.id,
        "path": str(a.cap.path),
        "kind": a.cap.kind,
        "timestamp": a.cap.sort_time.isoformat(),
        "validation_issues": a.issues,
        "node_count": a.g.n,
        "edge_count": a.g.e,
        "strong_edge_count": a.g.strong_edges,
        "reachable_nodes": a.hg.reach,
        "total_heap_self_size": int(sum(a.g.selfs)),
        "extra_native_bytes": a.g.extra_native,
        "constructor_count_top": top_counter(a.c_count, n),
        "constructor_self_top": top_counter(a.c_self, n),
        "type_count": top_counter(a.t_count, n),
        "type_self": top_counter(a.t_self, n),
        "detached_summary": a.detached,
        "top_retained_owners": a.top_ret[:n],
        "pattern_buckets": a.buckets,
        "timeline": a.timeline,
    }


def compare(old: A, new: A, n: int) -> Dict[str, Any]:
    ctors = set(old.c_self) | set(new.c_self)
    cd = []
    for c in ctors:
        ds = int(new.c_self[c] - old.c_self[c])
        dc = int(new.c_count[c] - old.c_count[c])
        if ds == 0 and dc == 0:
            continue
        cd.append(
            {
                "constructor": c,
                "delta_self_size": ds,
                "delta_count": dc,
                "older_self_size": int(old.c_self[c]),
                "newer_self_size": int(new.c_self[c]),
                "older_count": int(old.c_count[c]),
                "newer_count": int(new.c_count[c]),
            }
        )
    cd.sort(key=lambda x: x["delta_self_size"], reverse=True)
    types = set(old.t_self) | set(new.t_self)
    td = []
    for t in types:
        ds = int(new.t_self[t] - old.t_self[t])
        dc = int(new.t_count[t] - old.t_count[t])
        if ds == 0 and dc == 0:
            continue
        td.append(
            {
                "node_type": t,
                "delta_self_size": ds,
                "delta_count": dc,
                "older_self_size": int(old.t_self[t]),
                "newer_self_size": int(new.t_self[t]),
                "older_count": int(old.t_count[t]),
                "newer_count": int(new.t_count[t]),
            }
        )
    td.sort(key=lambda x: x["delta_self_size"], reverse=True)
    bd: Dict[str, Any] = {}
    for bid, label, _ in BUCKETS:
        ob, nb = old.buckets.get(bid, {}), new.buckets.get(bid, {})
        bd[bid] = {
            "label": label,
            "older_count": int(ob.get("count", 0)),
            "newer_count": int(nb.get("count", 0)),
            "delta_count": int(nb.get("count", 0) - ob.get("count", 0)),
            "older_self_size": int(ob.get("self_size_sum", 0)),
            "newer_self_size": int(nb.get("self_size_sum", 0)),
            "delta_self_size": int(nb.get("self_size_sum", 0) - ob.get("self_size_sum", 0)),
            "older_retained_unique_estimate": int(ob.get("retained_unique_estimate", 0)),
            "newer_retained_unique_estimate": int(nb.get("retained_unique_estimate", 0)),
            "delta_retained_unique_estimate": int(nb.get("retained_unique_estimate", 0) - ob.get("retained_unique_estimate", 0)),
        }
    delta_total_heap = int(sum(new.g.selfs) - sum(old.g.selfs))
    ctor_delta_self_total = int(sum(x["delta_self_size"] for x in cd))
    ctor_delta_count_total = int(sum(x["delta_count"] for x in cd))
    type_delta_self_total = int(sum(x["delta_self_size"] for x in td))
    type_delta_count_total = int(sum(x["delta_count"] for x in td))
    return {
        "older_capture_id": old.cap.id,
        "newer_capture_id": new.cap.id,
        "older_timestamp": old.cap.sort_time.isoformat(),
        "newer_timestamp": new.cap.sort_time.isoformat(),
        "delta_total_heap_self_size": delta_total_heap,
        "delta_extra_native_bytes": int(new.g.extra_native - old.g.extra_native),
        "delta_node_count": int(new.g.n - old.g.n),
        "delta_edge_count": int(new.g.e - old.g.e),
        "constructor_delta_self_total": ctor_delta_self_total,
        "constructor_delta_count_total": ctor_delta_count_total,
        "constructor_delta_self_matches_total_heap": bool(ctor_delta_self_total == delta_total_heap),
        "type_delta_self_total": type_delta_self_total,
        "type_delta_count_total": type_delta_count_total,
        "type_delta_self_matches_total_heap": bool(type_delta_self_total == delta_total_heap),
        "constructor_deltas_top_growth": [x for x in cd if x["delta_self_size"] > 0][:n],
        "constructor_deltas_top_shrink": [x for x in sorted(cd, key=lambda y: y["delta_self_size"]) if x["delta_self_size"] < 0][:n],
        "type_deltas_top_growth": [x for x in td if x["delta_self_size"] > 0][:n],
        "type_deltas_top_shrink": [x for x in sorted(td, key=lambda y: y["delta_self_size"]) if x["delta_self_size"] < 0][:n],
        "bucket_deltas": bd,
    }


def ctor_delta(cmpd: Dict[str, Any], ctor: str) -> Optional[Dict[str, Any]]:
    for x in cmpd["constructor_deltas_top_growth"] + cmpd["constructor_deltas_top_shrink"]:
        if x["constructor"] == ctor:
            return x
    return None


def best_node(a: A, ctor: str, min_oid: Optional[int] = None) -> Optional[int]:
    cands = []
    for i, n in enumerate(a.g.name):
        if n != ctor:
            continue
        if min_oid is not None and a.g.oid[i] <= min_oid:
            continue
        cands.append(i)
    return max(cands, key=lambda i: a.g.selfs[i]) if cands else None


def path_owner_hint(text: str) -> str:
    t = text.lower()
    if "pendingpromises" in t:
        return "pendingPromises map retains unresolved async payload state."
    if "ringbuffer" in t:
        return "Audio ring buffer retains typed-array backing store."
    if "visualizationbuffer" in t:
        return "Visualization buffer retained by long-lived audio object."
    if "performanceobserver" in t or "performanceeventtiming" in t:
        return "PerformanceObserver/event timing chain."
    return "Owner chain present but only partially attributable."


def pending_info(a: A) -> Dict[str, Any]:
    g = a.g
    maps, tables, entries = 0, 0, 0
    max_buf, max_node = 0, None

    def feat_buf(entry: int) -> Tuple[int, Optional[int]]:
        best, node = 0, None
        for et1, en1, n1 in g.out(entry):
            if et1 != "property" or en1 != "features":
                continue
            for et2, en2, n2 in g.out(n1):
                if et2 != "internal" or en2 != "buffer":
                    continue
                for et3, en3, n3 in g.out(n2):
                    if et3 == "internal" and en3 == "backing_store":
                        if g.selfs[n3] > best:
                            best, node = g.selfs[n3], n3
        return best, node

    for owner in range(g.n):
        for et, en, m in g.out(owner):
            if et == "property" and en == "pendingPromises":
                maps += 1
                table = None
                for et2, en2, n2 in g.out(m):
                    if et2 == "internal" and en2 == "table":
                        table = n2
                        break
                if table is None:
                    continue
                tables += 1
                for et3, en3, ent in g.out(table):
                    if et3 != "internal" or en3 == "map":
                        continue
                    if g.typ[ent] == "hidden" and g.name[ent].startswith("system / Map"):
                        continue
                    entries += 1
                    s, n = feat_buf(ent)
                    if s > max_buf:
                        max_buf, max_node = s, n
    return {"map_count": maps, "table_count": tables, "entry_count": entries, "max_feature_buffer_size": int(max_buf), "max_feature_buffer_node": max_node}


def monotonic(comparisons: List[Dict[str, Any]], ctor: str) -> bool:
    if len(comparisons) < 2:
        return False
    vals = []
    for c in comparisons:
        d = ctor_delta(c, ctor)
        vals.append(int(d["delta_self_size"]) if d else 0)
    return all(v > 0 for v in vals)


def conf(clear_path: bool, mono: bool, cap_count: int, browser_amb: bool = False) -> Tuple[str, str]:
    if browser_amb:
        return "low", "Signal likely browser/runtime-internal."
    if cap_count >= 3 and mono and clear_path:
        return "high", "Monotonic multi-interval growth with clear owner path."
    if clear_path:
        return "medium", "Growth in this pair plus plausible owner path; needs repeat confirmation."
    return "low", "Growth signal present but owner ambiguity remains."


def _finding_jsarraybufferdata(analyses: List[A], comparisons: List[Dict[str, Any]], top_n: int) -> Optional[Dict[str, Any]]:
    if len(analyses) < 2:
        return None
    old, new = analyses[0], analyses[-1]
    anchor = compare(old, new, top_n)
    old_max = max(old.g.oid) if old.g.oid else None
    d = ctor_delta(anchor, "system / JSArrayBufferData")
    if not d or d["delta_self_size"] <= 0:
        return None
    node = best_node(new, "system / JSArrayBufferData", old_max) or best_node(new, "system / JSArrayBufferData")
    p = new.hg.path_to(node)
    clear = any(t in p["path_text"].lower() for t in ["ringbuffer", "pendingpromises", "visualizationbuffer", "features"])
    c, cr = conf(clear, monotonic(comparisons, "system / JSArrayBufferData"), len(analyses))
    return {
        "symptom": "Typed-array backing store grew between captures.",
        "suspected_owner": path_owner_hint(p["path_text"]),
        "evidence": {
            "constructor": "system / JSArrayBufferData",
            "delta_self_size": d["delta_self_size"],
            "older_self_size": d["older_self_size"],
            "newer_self_size": d["newer_self_size"],
            "older_count": d["older_count"],
            "newer_count": d["newer_count"],
            "capture_window": {"older": old.cap.id, "newer": new.cap.id},
        },
        "retention_path": p,
        "impact": "Backing-store growth raises long-session memory pressure and GC cost.",
        "impact_bytes": int(d["delta_self_size"]),
        "why_degrades_performance": "Long-lived native backing stores shrink free headroom and increase memory-management overhead.",
        "confidence": c,
        "confidence_reason": cr,
        "false_positive_checks": [
            "If fixed-size warmup/pool behavior, growth should plateau after forced-GC idle.",
            "If intended buffers, constructor count should stabilize during steady state.",
        ],
        "next_validation": [
            "Run forced-GC idle A/B snapshots and check JSArrayBufferData plateau.",
            "Run 10-minute active session then stop/drain and verify post-drain baseline.",
        ],
    }


def _finding_pending_promises(analyses: List[A], comparisons: List[Dict[str, Any]], top_n: int) -> Optional[Dict[str, Any]]:
    if len(analyses) < 2:
        return None
    old, new = analyses[0], analyses[-1]
    po, pn = pending_info(old), pending_info(new)
    if pn["entry_count"] <= po["entry_count"] and pn["max_feature_buffer_size"] <= po["max_feature_buffer_size"]:
        return None
    p = new.hg.path_to(pn["max_feature_buffer_node"])
    c, cr = conf("pendingpromises" in p["path_text"].lower(), False, len(analyses))
    return {
        "symptom": "pendingPromises map retained additional unresolved worker-result state.",
        "suspected_owner": "pendingPromises map on worker client object.",
        "evidence": {
            "older_pending": po,
            "newer_pending": pn,
            "entry_delta": int(pn["entry_count"] - po["entry_count"]),
            "feature_buffer_delta": int(pn["max_feature_buffer_size"] - po["max_feature_buffer_size"]),
            "capture_window": {"older": old.cap.id, "newer": new.cap.id},
        },
        "retention_path": p,
        "impact": "Pending async entries can pin buffers/promises and raise baseline memory.",
        "impact_bytes": int(max(0, pn["max_feature_buffer_size"] - po["max_feature_buffer_size"])),
        "why_degrades_performance": "Pinned async state delays reclamation of large payload objects.",
        "confidence": c,
        "confidence_reason": cr,
        "false_positive_checks": [
            "Transient in-flight work may appear mid-capture.",
            "Confirm behavior after explicit stop and queue drain."
        ],
        "next_validation": [
            "Capture active stream then stop/drain; verify pending entry count returns to zero.",
            "Capture post-drain forced-GC snapshot and compare retained feature buffers.",
        ],
    }


def _finding_detached_dom(analyses: List[A], comparisons: List[Dict[str, Any]], top_n: int) -> Optional[Dict[str, Any]]:
    if len(analyses) < 2:
        return None
    old, new = analyses[0], analyses[-1]
    dd = int(new.detached["detached_node_count"] - old.detached["detached_node_count"])
    dr = int(new.detached["detached_retained_unique_estimate"] - old.detached["detached_retained_unique_estimate"])
    if dd <= 0 and dr <= 0:
        return None
    top = new.detached["top_detached_nodes"][0]["node_index"] if new.detached["top_detached_nodes"] else None
    p = new.hg.path_to(top)
    return {
        "symptom": "Detached DOM node count increased between captures.",
        "suspected_owner": "UI subtree mount/unmount lifecycle.",
        "evidence": {
            "older_detached_count": old.detached["detached_node_count"],
            "newer_detached_count": new.detached["detached_node_count"],
            "delta_detached_count": dd,
            "older_detached_retained_unique_estimate": old.detached["detached_retained_unique_estimate"],
            "newer_detached_retained_unique_estimate": new.detached["detached_retained_unique_estimate"],
            "delta_detached_retained_unique_estimate": dr,
        },
        "retention_path": p,
        "impact": "Detached trees may accumulate UI memory overhead over long sessions.",
        "impact_bytes": int(max(0, dr)),
        "why_degrades_performance": "Detached nodes keep style/layout related objects alive.",
        "confidence": "low",
        "confidence_reason": "Single-pair signal with relatively small retained impact.",
        "false_positive_checks": [
            "Minor detached-node fluctuations can be normal reconciliation noise.",
            "Require repeated post-GC growth for leak confirmation."
        ],
        "next_validation": [
            "Run repeated UI toggle cycles and compare post-GC detached retained deltas.",
            "Capture idle-after-interaction to confirm reclamation."
        ],
    }


def _finding_performance_timing(analyses: List[A], comparisons: List[Dict[str, Any]], top_n: int) -> Optional[Dict[str, Any]]:
    if len(analyses) < 2:
        return None
    old, new = analyses[0], analyses[-1]
    anchor = compare(old, new, top_n)
    pd = ctor_delta(anchor, "PerformanceEventTiming")
    if not pd or pd["delta_self_size"] <= 0:
        return None
    node = best_node(new, "PerformanceEventTiming")
    p = new.hg.path_to(node)
    c, cr = conf(False, False, len(analyses), browser_amb=True)
    return {
        "symptom": "PerformanceEventTiming objects increased across captures.",
        "suspected_owner": path_owner_hint(p["path_text"]),
        "evidence": {"constructor": "PerformanceEventTiming", "delta_self_size": pd["delta_self_size"], "older_count": pd["older_count"], "newer_count": pd["newer_count"]},
        "retention_path": p,
        "impact": "May raise background memory overhead and diagnostics noise.",
        "impact_bytes": int(pd["delta_self_size"]),
        "why_degrades_performance": "Large timing-entry arrays increase retained object graph scanning.",
        "confidence": c,
        "confidence_reason": cr,
        "false_positive_checks": [
            "Browser timing buffers are expected unless app collections retain entries indefinitely.",
            "Need repeated post-GC idling to distinguish bounded vs unbounded accumulation."
        ],
        "next_validation": [
            "Capture post-GC idle snapshots without interaction and verify plateau.",
            "Inspect observer draining behavior in targeted run."
        ],
    }


def _finding_timeline_bursts(analyses: List[A], comparisons: List[Dict[str, Any]], top_n: int) -> Optional[Dict[str, Any]]:
    tls = [a for a in analyses if a.timeline.get("sample_count", 0) > 0]
    if not tls:
        return None
    t = tls[-1].timeline
    bursts = t.get("top_id_growth_bursts", [])
    cps = t.get("survivor_pressure_checkpoints", [])
    mr = float(bursts[0]["id_per_us"]) if bursts else 0.0
    if mr <= 0:
        return None
    r75 = 0.0
    for cp in cps:
        if abs(cp.get("checkpoint", -1) - 0.75) < 1e-9:
            r75 = float(cp.get("survivor_ratio", 0.0))
            break
    c = "medium" if r75 >= 0.30 else "low"
    return {
        "symptom": "Timeline shows bursty allocation and non-trivial survivor baseline.",
        "suspected_owner": "Mixed runtime/app allocation churn during active processing.",
        "evidence": {"capture_id": tls[-1].cap.id, "sample_count": t.get("sample_count", 0), "duration_seconds": t.get("duration_seconds", 0.0), "max_id_growth_rate_per_us": mr, "survivor_ratio_at_75pct": r75},
        "retention_path": {"reachable": False, "path_nodes": [], "path_text": "N/A (aggregate timeline signal)"},
        "impact": "Allocation churn with survivors can increase GC frequency and pause overhead.",
        "impact_bytes": int(cps[-1]["survivor_self_size"] if cps else 0),
        "why_degrades_performance": "Bursty allocation increases mutator interruptions; survivors raise old-generation pressure.",
        "confidence": c,
        "confidence_reason": "Aggregate signal needs repeated runs for leak-level certainty.",
        "false_positive_checks": [
            "Single run may include warmup transients.",
            "Need active-vs-idle repetition to prove persistent churn."
        ],
        "next_validation": [
            "Record timeline during steady-state idle after warmup.",
            "Repeat 10-minute active run and compare burst/survivor profile."
        ],
    }


def findings(analyses: List[A], comparisons: List[Dict[str, Any]], top_n: int) -> List[Dict[str, Any]]:
    if len(analyses) < 2:
        return []
    out: List[Dict[str, Any]] = []
    for detector in [
        _finding_jsarraybufferdata,
        _finding_pending_promises,
        _finding_detached_dom,
        _finding_performance_timing,
        _finding_timeline_bursts,
    ]:
        f = detector(analyses, comparisons, top_n)
        if f:
            out.append(f)

    w = {"high": 3, "medium": 2, "low": 1}
    for f in out:
        c = w.get(f["confidence"], 1)
        f["_score"] = int(f.get("impact_bytes", 0)) * (1 + (0.2 * c)) + (1000 * c)
    out.sort(key=lambda f: f["_score"], reverse=True)
    for i, f in enumerate(out, 1):
        f["rank"] = i
        f["finding_id"] = f"F{i:02d}"
        f.pop("_score", None)
    return out


def report_obj(analyses: List[A], comparisons: List[Dict[str, Any]], findings_list: List[Dict[str, Any]], top_n: int, cmd: str) -> Dict[str, Any]:
    caps = [summary(a, top_n) for a in analyses]
    anchor = comparisons[-1] if comparisons else None
    return {
        "generated_at": now_iso(),
        "analyzer": "metrics/memory/analyze_heap_memory.py",
        "inputs": [str(a.cap.path) for a in analyses],
        "captures": caps,
        "comparisons": comparisons,
        "findings": findings_list,
        "appendix": {
            "top_growing_constructors": (anchor["constructor_deltas_top_growth"][:top_n] if anchor else []),
            "top_growing_types": (anchor["type_deltas_top_growth"][:top_n] if anchor else []),
            "largest_retained_groups": (analyses[-1].top_ret[:top_n] if analyses else []),
            "commands_used": [cmd],
        },
    }


def _md_table(headers: List[str], rows: List[List[str]]) -> List[str]:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    return lines


def _md_top_growing_constructors(rep: Dict[str, Any]) -> List[str]:
    rows = rep["appendix"].get("top_growing_constructors", [])
    if not rows:
        return ["- No constructor growth rows."]
    return _md_table(
        ["Constructor", "Delta Self", "Delta Count"],
        [[f"`{r['constructor']}`", str(r["delta_self_size"]), str(r["delta_count"])] for r in rows],
    )


def report_md(rep: Dict[str, Any], analyses: List[A], cmd: str) -> str:
    ls: List[str] = []
    ls += [
        "# Keet Memory Profiling Report - Pass 1 (Heap-Only)",
        "",
        f"- Generated at: `{rep['generated_at']}`",
        f"- Analyzer: `{rep['analyzer']}`",
        f"- Command: `{cmd}`",
        "",
        "## 1. Executive summary",
        "",
    ]
    if rep["findings"]:
        for f in rep["findings"]:
            ls.append(f"{f['rank']}. `{f['finding_id']}` ({f['confidence']}) - {f['symptom']} Impact signal: `{bfmt(int(f.get('impact_bytes', 0)))}`")
    else:
        ls.append("1. No ranked risks generated from available captures.")
    ls += [
        "",
        "Data sufficiency note: this pass has limited temporal depth (two captures), so findings are provisional until repeated post-GC runs confirm monotonic trends.",
        "",
        "## 2. Method",
        "",
        "### Files analyzed",
        "",
    ]
    for c in rep["captures"]:
        ls.append(f"- `{c['capture_id']}` ({c['kind']}), nodes={c['node_count']}, edges={c['edge_count']}, total_self={bfmt(int(c['total_heap_self_size']))}")
    ls += ["", "### Comparison strategy", ""]
    if rep["comparisons"]:
        for c in rep["comparisons"]:
            ls.append(f"- `{c['older_capture_id']}` -> `{c['newer_capture_id']}` (delta_total_heap_self_size={bfmt(int(c['delta_total_heap_self_size']))})")
    else:
        ls.append("- Single capture only; no deltas.")
    ls += ["", "### Custom tooling/scripts", "", "- `metrics/memory/analyze_heap_memory.py`", "- CLI supports `--inputs`, `--report-md`, `--report-json`, `--top-n`, `--pairwise`, `--strict-validate`", "", "## 3. Findings (ranked)", ""]
    if rep["findings"]:
        for f in rep["findings"]:
            ls += [
                f"### {f['rank']}. {f['finding_id']} - {f['symptom']}",
                "",
                f"- Symptom: {f['symptom']}",
                f"- Evidence: `{json.dumps(f['evidence'], ensure_ascii=True)}`",
                f"- Suspected retention path / owner: {f['suspected_owner']}",
                f"- Retention path: `{f['retention_path']['path_text']}`",
                f"- Why it degrades over time: {f['why_degrades_performance']}",
                f"- Confidence: `{f['confidence']}` ({f['confidence_reason']})",
                f"- False-positive checks: {' | '.join(f['false_positive_checks'])}",
                f"- Next validation run(s): {' | '.join(f['next_validation'])}",
                "",
            ]
    else:
        ls += ["- No findings generated.", ""]
    ls += [
        "## 4. False-positive checks",
        "",
        "- Treat startup/model/audio warmup growth as non-leak unless growth persists after forced-GC idle.",
        "- Treat fixed-size pools/ring buffers as expected when cardinality and bytes plateau.",
        "- Treat browser timing-entry accumulation as provisional unless app-owned containers retain unboundedly.",
        "- Promote to likely leak only with repeated post-GC growth trends.",
        "",
        "## 5. Recommended next validation runs",
        "",
        "1. Idle stabilization: snapshot A after warmup, force GC, 60s idle, snapshot B.",
        "2. Active transcription loop: 10-minute active run with interactions, timeline capture, force GC, snapshot C.",
        "3. Pending-work verification: capture during active stream, stop/drain, snapshot D post-drain.",
        "4. Detached DOM regression: repeat panel/device toggle loop and compare post-GC detached deltas.",
        "",
        "## 6. Appendix",
        "",
        "### Top growing constructors/types",
        "",
    ]
    ls += _md_top_growing_constructors(rep)
    ls += ["", "### Largest retained objects/groups", ""]
    ls += _md_table(
        ["Node", "Constructor", "Type", "Self", "Retained"],
        [[str(r["node_index"]), f"`{r['constructor']}`", f"`{r['node_type']}`", str(r["self_size"]), str(r["retained_size"])] for r in analyses[-1].top_ret[:20]],
    )
    ls += ["", "### CLI commands used", ""]
    for c in rep["appendix"]["commands_used"]:
        ls.append(f"- `{c}`")
    ls.append("")
    return "\n".join(ls)


def args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Analyze Chrome heap captures for memory growth risks.")
    p.add_argument("--inputs", nargs="+", required=True)
    p.add_argument("--report-md", required=True)
    p.add_argument("--report-json", required=True)
    p.add_argument("--top-n", type=int, default=25)
    p.add_argument("--pairwise", action="store_true")
    p.add_argument("--strict-validate", action="store_true")
    return p.parse_args(argv)


def wjson(path: Path, obj: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def wtxt(path: Path, s: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(s, encoding="utf-8")


def main(argv: Optional[Sequence[str]] = None) -> int:
    a = args(argv)
    cmd = "python " + " ".join(shlex.quote(x) for x in sys.argv)
    caps = discover(a.inputs)
    print(f"[analyze] captures={len(caps)}")
    analyses: List[A] = []
    for c in caps:
        print(f"[analyze] load {c.path.name}")
        payload = json.loads(c.path.read_text(encoding="utf-8"))
        analyses.append(analyze_cap(c, payload, a.strict_validate, a.top_n))
    comps: List[Dict[str, Any]] = []
    if len(analyses) >= 2:
        if a.pairwise:
            for i in range(1, len(analyses)):
                comps.append(compare(analyses[i - 1], analyses[i], a.top_n))
        anchor = compare(analyses[0], analyses[-1], a.top_n)
        if not comps or comps[-1]["older_capture_id"] != anchor["older_capture_id"] or comps[-1]["newer_capture_id"] != anchor["newer_capture_id"]:
            comps.append(anchor)
    f = findings(analyses, comps, a.top_n)
    rep = report_obj(analyses, comps, f, a.top_n, cmd)
    md = report_md(rep, analyses, cmd)
    wjson(Path(a.report_json), rep)
    wtxt(Path(a.report_md), md)
    print(f"[analyze] wrote {a.report_json}")
    print(f"[analyze] wrote {a.report_md}")
    print(f"[analyze] findings={len(f)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
