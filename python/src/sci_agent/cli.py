"""Run the bundled Sci-Agent npm package with the local Node.js runtime."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from . import __version__

BUNDLE_NAME = f"sci-agent-{__version__}.tgz"
MIN_NODE_MAJOR = 20


def _cache_root() -> Path:
    override = os.environ.get("SCI_AGENT_CACHE_DIR")
    if override:
        return Path(override).expanduser()
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA")
        if base:
            return Path(base) / "sci-agent"
    base = os.environ.get("XDG_CACHE_HOME")
    if base:
        return Path(base) / "sci-agent"
    return Path.home() / ".cache" / "sci-agent"


def _find_node() -> str | None:
    override = os.environ.get("SCI_AGENT_NODE")
    if override:
        return override
    return shutil.which("node")


def _check_node(node: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            [node, "--version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except OSError as exc:
        return False, f"could not run {node!r}: {exc}"
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        return False, f"{node!r} exited with status {result.returncode}: {detail}"
    raw = result.stdout.strip().lstrip("v")
    major = raw.split(".", 1)[0]
    if not major.isdigit() or int(major) < MIN_NODE_MAJOR:
        return False, f"Node.js {MIN_NODE_MAJOR} or newer is required (found {result.stdout.strip()})."
    return True, result.stdout.strip()


def _safe_extract(archive: Path, destination: Path) -> None:
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            name = member.name
            parts = Path(name).parts
            if name.startswith("/") or ".." in parts:
                raise RuntimeError(f"unsafe path in bundled archive: {name}")
            if name != "package" and not name.startswith("package/"):
                raise RuntimeError(f"unexpected path in bundled archive: {name}")
        if hasattr(tarfile, "data_filter"):
            tar.extractall(destination, filter="data")
        else:
            tar.extractall(destination)


def _ensure_bundle() -> Path:
    bundle = Path(__file__).resolve().parent / "_bundle" / BUNDLE_NAME
    if not bundle.is_file():
        raise RuntimeError(f"bundled npm package is missing: {bundle}")

    target = _cache_root() / __version__
    cli_js = target / "package" / "packages" / "cli" / "bin" / "sci-agent.js"
    if cli_js.is_file():
        return cli_js

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{__version__}-", dir=str(target.parent)))
    try:
        _safe_extract(bundle, temporary)
        if not (temporary / "package" / "package.json").is_file():
            raise RuntimeError("bundled npm package is incomplete")
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        try:
            os.replace(temporary, target)
        except OSError:
            if not cli_js.is_file():
                raise
            shutil.rmtree(temporary, ignore_errors=True)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return cli_js


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)

    node = _find_node()
    if not node:
        print(
            "Sci-Agent: Node.js 20 or newer is required but `node` was not found on PATH.",
            file=sys.stderr,
        )
        print(
            "Install Node.js from https://nodejs.org/ or set SCI_AGENT_NODE to the executable.",
            file=sys.stderr,
        )
        return 1

    ok, detail = _check_node(node)
    if not ok:
        print(f"Sci-Agent: {detail}", file=sys.stderr)
        return 1

    try:
        cli_js = _ensure_bundle()
    except Exception as exc:
        print(f"Sci-Agent: could not prepare the bundled CLI: {exc}", file=sys.stderr)
        return 1

    try:
        completed = subprocess.run([node, str(cli_js), *args], check=False)
    except KeyboardInterrupt:
        return 130
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
