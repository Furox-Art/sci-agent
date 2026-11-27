#!/usr/bin/env python3
"""lesson-gate: a deterministic mistake ledger.

A lesson is not learned because it was written down. It is learned only when
an executable check proves it: the positive command exits 0 and the negative
fixture exits non-zero.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
VERSION = "0.1.0"

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_ERROR = 2

TRIGGERS = ("correction", "command_failure", "ci_failure", "self_audit")
SCOPE_KINDS = ("user", "project", "repo")
CATEGORIES = (
    "unverified_claim",
    "overwrite",
    "guessed_value",
    "ignored_instruction",
    "broken_output",
    "missing_test",
    "scope_creep",
    "other",
)
STATUS_ORDER = {"open": 0, "promoted": 1, "verified": 2}


class LedgerError(Exception):
    pass


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def normalize_text(text: str) -> str:
    return " ".join(str(text).split())


def compute_id(scope_kind: str, scope_value: str, category: str, expected: str, actual: str) -> str:
    payload = {
        "schema_version": SCHEMA_VERSION,
        "scope": {"kind": scope_kind, "value": scope_value},
        "category": category,
        "expected": normalize_text(expected),
        "actual": normalize_text(actual),
    }
    return hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()


def compute_signature(category: str, expected: str) -> str:
    material = category + "\n" + normalize_text(expected)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def resolve_store(store_arg: str | None) -> Path:
    if store_arg:
        return Path(store_arg).expanduser()
    env = os.environ.get("LESSON_GATE_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".qoder" / "lesson-gate"


def events_path(store: Path) -> Path:
    return store / "events.jsonl"


def append_event(store: Path, event: dict, dry_run: bool) -> None:
    if dry_run:
        print(f"dry-run: would append to {events_path(store)}: {canonical(event)}")
        return
    store.mkdir(parents=True, exist_ok=True)
    with open(events_path(store), "a", encoding="utf-8", newline="\n") as handle:
        handle.write(canonical(event) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def load_events(store: Path) -> list[dict]:
    path = events_path(store)
    if not path.exists():
        return []
    events: list[dict] = []
    with open(path, "r", encoding="utf-8") as handle:
        for number, raw in enumerate(handle, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                event = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise LedgerError(f"corrupt ledger at line {number}: {exc}") from exc
            if not isinstance(event, dict) or not isinstance(event.get("kind"), str):
                raise LedgerError(f"corrupt ledger at line {number}: missing kind")
            events.append(event)
    return events


def fold(events: list[dict]) -> dict[str, dict]:
    lessons: dict[str, dict] = {}
    repeats: Counter[str] = Counter()
    checks: dict[str, tuple[int, dict]] = {}
    proofs: dict[str, tuple[int, dict]] = {}
    for index, event in enumerate(events):
        kind = event.get("kind")
        lesson_id = event.get("id")
        if kind == "lesson" and isinstance(lesson_id, str):
            lessons.setdefault(lesson_id, event)
        elif kind == "repeat" and isinstance(lesson_id, str):
            repeats[lesson_id] += 1
        elif kind == "check" and isinstance(lesson_id, str):
            checks[lesson_id] = (index, event)
        elif kind == "proof" and isinstance(lesson_id, str):
            proofs[lesson_id] = (index, event)

    rows: dict[str, dict] = {}
    for lesson_id, lesson in lessons.items():
        check_entry = checks.get(lesson_id)
        proof_entry = proofs.get(lesson_id)
        if check_entry is None:
            status = "open"
        elif (
            proof_entry is not None
            and proof_entry[0] > check_entry[0]
            and proof_entry[1].get("ok") is True
        ):
            status = "verified"
        else:
            status = "promoted"
        rows[lesson_id] = {
            "lesson": lesson,
            "check": check_entry[1] if check_entry else None,
            "proof": proof_entry[1] if proof_entry else None,
            "status": status,
            "repeats": repeats[lesson_id],
        }
    return rows


def parse_scope(text: str) -> tuple[str, str]:
    if ":" not in text:
        raise LedgerError("scope must be kind:value, e.g. user:global or repo:owner/name")
    kind, value = text.split(":", 1)
    kind = kind.strip()
    value = value.strip()
    if kind not in SCOPE_KINDS:
        raise LedgerError(f"unknown scope kind {kind!r}; use one of {', '.join(SCOPE_KINDS)}")
    if not value:
        raise LedgerError("scope value must not be empty")
    return kind, value


def split_command(command: str) -> list[str]:
    try:
        parts = shlex.split(command, posix=True)
    except ValueError as exc:
        raise LedgerError(f"cannot parse command {command!r}: {exc}") from exc
    if not parts:
        raise LedgerError("command must not be empty")
    return parts


def run_command(command: str, cwd: str | None, timeout: int) -> tuple[int | None, str]:
    parts = split_command(command)
    try:
        completed = subprocess.run(
            parts,
            cwd=cwd,
            timeout=timeout,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, str(exc)
    return completed.returncode, ""


def keyword_tokens(text: str) -> set[str]:
    return {token.casefold() for token in re.findall(r"[\w-]+", text, re.UNICODE)}


def cmd_add(args: argparse.Namespace) -> int:
    scope_kind, scope_value = parse_scope(args.scope)
    expected = normalize_text(args.expected)
    actual = normalize_text(args.actual)
    if not expected:
        raise LedgerError("--expected must not be empty")
    if not actual:
        raise LedgerError("--actual must not be empty")
    keywords = [item.strip().casefold() for item in args.keywords.split(",") if item.strip()]
    lesson_id = compute_id(scope_kind, scope_value, args.category, expected, actual)
    store = resolve_store(args.store)
    rows = fold(load_events(store))
    if lesson_id in rows:
        append_event(
            store,
            {"v": SCHEMA_VERSION, "kind": "repeat", "at": now_utc(), "id": lesson_id},
            args.dry_run,
        )
        print(f"repeat id={lesson_id} count={rows[lesson_id]['repeats'] + 1}")
        return EXIT_OK
    event = {
        "v": SCHEMA_VERSION,
        "kind": "lesson",
        "at": now_utc(),
        "id": lesson_id,
        "signature": compute_signature(args.category, expected),
        "scope": {"kind": scope_kind, "value": scope_value},
        "trigger": args.trigger,
        "category": args.category,
        "expected": expected,
        "actual": actual,
        "evidence": args.evidence,
        "keywords": keywords,
    }
    append_event(store, event, args.dry_run)
    print(f"add id={lesson_id} status=open")
    return EXIT_OK


def cmd_promote(args: argparse.Namespace) -> int:
    store = resolve_store(args.store)
    rows = fold(load_events(store))
    if args.id not in rows:
        raise LedgerError(f"unknown lesson id: {args.id}")
    split_command(args.positive)
    split_command(args.negative)
    cwd = None
    if args.cwd:
        cwd_path = Path(args.cwd).expanduser().resolve()
        if not cwd_path.is_dir():
            raise LedgerError(f"--cwd is not a directory: {cwd_path}")
        cwd = str(cwd_path)
    event = {
        "v": SCHEMA_VERSION,
        "kind": "check",
        "at": now_utc(),
        "id": args.id,
        "positive": args.positive,
        "negative": args.negative,
        "cwd": cwd,
    }
    append_event(store, event, args.dry_run)
    print(f"promote id={args.id} status=promoted")
    return EXIT_OK


def cmd_verify(args: argparse.Namespace) -> int:
    store = resolve_store(args.store)
    rows = fold(load_events(store))
    checks = sorted(
        ((lesson_id, row) for lesson_id, row in rows.items() if row["check"] is not None),
        key=lambda item: item[0],
    )
    if not checks:
        print("verify: no checks registered")
        return EXIT_OK
    if args.dry_run:
        for lesson_id, row in checks:
            check = row["check"]
            print(
                f"dry-run: would verify id={lesson_id} "
                f"positive={check['positive']!r} negative={check['negative']!r}"
            )
        print("dry-run: no commands executed, no proof written")
        return EXIT_OK

    results: list[tuple[str, int | None, int | None, bool]] = []
    failures = 0
    for lesson_id, row in checks:
        check = row["check"]
        positive_exit, positive_error = run_command(check["positive"], check.get("cwd"), args.timeout)
        negative_exit, negative_error = run_command(check["negative"], check.get("cwd"), args.timeout)
        ok = positive_exit == 0 and negative_exit is not None and negative_exit != 0
        if not ok:
            failures += 1
        reason = positive_error or negative_error
        suffix = f" reason={reason}" if reason else ""
        print(
            f"{'PASS' if ok else 'FAIL'} id={lesson_id} "
            f"positive={positive_exit} negative={negative_exit}{suffix}"
        )
        results.append((lesson_id, positive_exit, negative_exit, ok))

    if args.record:
        for lesson_id, positive_exit, negative_exit, ok in results:
            append_event(
                store,
                {
                    "v": SCHEMA_VERSION,
                    "kind": "proof",
                    "at": now_utc(),
                    "id": lesson_id,
                    "positive_exit": positive_exit,
                    "negative_exit": negative_exit,
                    "ok": ok,
                },
                False,
            )
    return EXIT_FAIL if failures else EXIT_OK


def cmd_preflight(args: argparse.Namespace) -> int:
    store = resolve_store(args.store)
    rows = fold(load_events(store))
    requested = parse_scope(args.scope) if args.scope else None
    tokens = keyword_tokens(args.text or "")
    matched: list[tuple[str, dict]] = []
    for lesson_id, row in rows.items():
        lesson = row["lesson"]
        scope = lesson.get("scope") or {}
        scope_kind = scope.get("kind")
        scope_value = scope.get("value")
        if requested is not None and scope_kind != "user" and (scope_kind, scope_value) != requested:
            continue
        keywords = [str(item).casefold() for item in lesson.get("keywords") or []]
        if tokens and keywords and not any(item in tokens for item in keywords):
            continue
        matched.append((lesson_id, row))

    matched.sort(
        key=lambda item: (
            STATUS_ORDER[item[1]["status"]],
            str(item[1]["lesson"].get("category", "")),
            item[0],
        )
    )
    limit = args.limit
    shown = matched if limit == 0 else matched[:limit]
    for lesson_id, row in shown:
        lesson = row["lesson"]
        scope = lesson.get("scope") or {}
        print(
            f"[{row['status'].upper()}] id={lesson_id[:12]} "
            f"category={lesson.get('category')} scope={scope.get('kind')}:{scope.get('value')} "
            f"repeats={row['repeats']}"
        )
        print(f"  expected: {lesson.get('expected')}")
        check = row["check"]
        if check is None:
            print("  check: none")
        else:
            print(f"  check+: {check['positive']}")
            print(f"  check-: {check['negative']}")
    if limit and len(matched) > limit:
        print(f"... {len(matched) - limit} more matched; use --limit 0")
    unverified = [item for item in matched if item[1]["status"] != "verified"]
    if unverified and not args.allow_unverified:
        print(f"preflight: {len(unverified)} matched lesson(s) are not verified")
        return EXIT_FAIL
    return EXIT_OK


def cmd_stats(args: argparse.Namespace) -> int:
    store = resolve_store(args.store)
    rows = fold(load_events(store))
    by_status = Counter(row["status"] for row in rows.values())
    by_category = Counter(str(row["lesson"].get("category")) for row in rows.values())
    signature_counts: Counter[str] = Counter()
    for row in rows.values():
        signature = str(row["lesson"].get("signature", ""))
        signature_counts[signature] += 1 + row["repeats"]
    top = sorted(signature_counts.items(), key=lambda item: (-item[1], item[0]))[:10]
    payload = {
        "lessons": len(rows),
        "by_status": {key: by_status[key] for key in sorted(by_status)},
        "by_category": {key: by_category[key] for key in sorted(by_category)},
        "repeat_events": sum(row["repeats"] for row in rows.values()),
        "top_signatures": [{"signature": key, "count": value} for key, value in top],
        "open_ids": sorted(lesson_id for lesson_id, row in rows.items() if row["status"] == "open"),
    }
    if args.as_json:
        print(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")))
    else:
        status_text = " ".join(f"{key}={payload['by_status'][key]}" for key in payload["by_status"])
        print(f"lessons={payload['lessons']} {status_text} repeats={payload['repeat_events']}")
        for key in payload["by_category"]:
            print(f"category {key}={payload['by_category'][key]}")
        for item in payload["top_signatures"]:
            print(f"signature {item['signature'][:12]} count={item['count']}")
    return EXIT_OK


def cmd_export(args: argparse.Namespace) -> int:
    store = resolve_store(args.store)
    rows = fold(load_events(store))
    selected = [
        (lesson_id, row)
        for lesson_id, row in rows.items()
        if row["status"] == "verified" or (args.include_open and row["status"] != "verified")
    ]
    selected.sort(key=lambda item: (str(item[1]["lesson"].get("category", "")), item[0]))
    print("## lesson-gate rules")
    if not selected:
        print("")
        print("No lessons exported.")
        return EXIT_OK
    for lesson_id, row in selected:
        lesson = row["lesson"]
        print(
            f"- [{lesson.get('category')}] {lesson.get('expected')} "
            f"(id {lesson_id[:12]}, {row['status']})"
        )
        check = row["check"]
        if check is not None:
            print(f"  - check+: {check['positive']}")
            print(f"  - check-: {check['negative']}")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--store",
        default=None,
        help="ledger directory (default: ~/.qoder/lesson-gate)",
    )

    parser = argparse.ArgumentParser(prog="lesson-gate", description=__doc__)
    parser.add_argument("--version", action="version", version=f"lesson-gate {VERSION}")
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", parents=[common], help="record a lesson or a repeat")
    add.add_argument("--scope", required=True, help="kind:value, e.g. user:global or repo:owner/name")
    add.add_argument("--trigger", required=True, choices=TRIGGERS)
    add.add_argument("--category", required=True, choices=CATEGORIES)
    add.add_argument("--expected", required=True)
    add.add_argument("--actual", required=True)
    add.add_argument("--evidence", default="")
    add.add_argument("--keywords", default="", help="comma-separated match tokens")
    add.add_argument("--dry-run", action="store_true")
    add.set_defaults(func=cmd_add)

    promote = sub.add_parser("promote", parents=[common], help="attach an executable check")
    promote.add_argument("id")
    promote.add_argument("--positive", required=True, help="command that must exit 0 on the fixed state")
    promote.add_argument("--negative", required=True, help="command that must exit non-zero on the bad state")
    promote.add_argument("--cwd", default=None)
    promote.add_argument("--dry-run", action="store_true")
    promote.set_defaults(func=cmd_promote)

    verify = sub.add_parser("verify", parents=[common], help="run every check fail-closed")
    verify.add_argument("--record", action="store_true", help="append proof events")
    verify.add_argument("--dry-run", action="store_true", help="print planned work, run nothing")
    verify.add_argument("--timeout", type=int, default=120)
    verify.set_defaults(func=cmd_verify)

    preflight = sub.add_parser("preflight", parents=[common], help="load applicable rules")
    preflight.add_argument("--text", default="")
    preflight.add_argument("--scope", default=None)
    preflight.add_argument("--limit", type=int, default=20)
    preflight.add_argument("--allow-unverified", action="store_true")
    preflight.set_defaults(func=cmd_preflight)

    stats = sub.add_parser("stats", parents=[common], help="show counts and recurrence")
    stats.add_argument("--json", dest="as_json", action="store_true")
    stats.set_defaults(func=cmd_stats)

    export = sub.add_parser("export", parents=[common], help="print verified rules")
    export.add_argument("--format", choices=("agents",), default="agents")
    export.add_argument("--include-open", action="store_true")
    export.set_defaults(func=cmd_export)

    return parser


def main(argv: list[str] | None = None) -> int:
    if sys.version_info < (3, 11):
        print("error: lesson-gate requires Python 3.11 or newer", file=sys.stderr)
        return EXIT_ERROR
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except LedgerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_ERROR
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
