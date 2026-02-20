# Issue Triage Policy

This document defines minimum issue quality and triage consistency for `keet`.

## Label Policy

- Keep one primary type label: `bug`, `enhancement`, or `performance`.
- Add domain labels only when useful for routing (for example: `transcription`, `audio`, `ui`).
- Do not remove/re-add labels in bulk unless there is a documented taxonomy change.
- If taxonomy changes, post one tracking comment linking the new mapping.

## Minimum Issue Quality

Every new issue should include:

- Problem statement
- Reproduction steps
- Environment details (browser, OS, device, build/ref)
- Expected behavior
- Actual behavior
- Acceptance criteria (measurable when possible)

For `performance` issues, also include:

- Trace/profile source and capture date
- Metric baseline (for example p95 latency, GC time, dropped frames)
- Target metric after fix

## Duplicate and Superseded Issues

- Use: `Closed as duplicate of #<issue-number>.`
- Use: `Superseded by PR #<pr-number>.`
- Include one short reason sentence when closing.

## Request-for-Info Template

Use this when an issue is salvageable but incomplete:

```markdown
Thanks for the report. To move this forward, please add:

1. Reproduction steps (exact sequence)
2. Environment details (browser/version, OS, device)
3. Current commit/branch or release version
4. Expected vs actual behavior
5. Acceptance criteria for a fix

For performance reports, also add:
6. Trace/profile file or screenshots
7. Baseline numbers and target numbers
```

## Verification Before Closing

- Confirm the closing PR/commit actually addresses the acceptance criteria.
- Link the exact PR and commit SHA in the closing comment.
- If unresolved edge cases remain, keep the issue open and narrow scope instead of closing.
