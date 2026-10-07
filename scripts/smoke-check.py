"""Check local HTTP integration without Docker or a running database.

Run using backend/.venv/Scripts/python.exe scripts/smoke-check.py from the root.
Requires frontend npm ci. Temporary services are stopped after the check.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def wait_for(url: str, process: subprocess.Popen) -> bytes:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Temporary development server exited before readiness")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return response.read()
        except (OSError, TimeoutError):
            time.sleep(0.2)
    raise RuntimeError(f"Server did not respond: {url}")


def main() -> None:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    processes = []
    with tempfile.TemporaryFile() as output:
        try:
            backend = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "18100",
                ],
                cwd=ROOT / "backend",
                stdout=output,
                stderr=output,
            )
            processes.append(backend)
            data = wait_for("http://127.0.0.1:18100/api/v1/health/live", backend)
            if json.loads(data)["status"] != "ok":
                raise RuntimeError("Backend health failed")
            env = dict(os.environ, API_PROXY_TARGET="http://127.0.0.1:18100")
            frontend = subprocess.Popen(
                [
                    node,
                    "node_modules/vite/bin/vite.js",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "15173",
                ],
                cwd=ROOT / "frontend",
                env=env,
                stdout=output,
                stderr=output,
            )
            processes.append(frontend)
            page = wait_for("http://127.0.0.1:15173", frontend)
            if b"Campus Incident Management" not in page:
                raise RuntimeError("Frontend document failed")
            proxy = wait_for("http://127.0.0.1:15173/api/v1/health/live", frontend)
            if json.loads(proxy)["service"] != "campus-incident-management-api":
                raise RuntimeError("Vite API proxy failed")
            print(
                "PASS: backend HTTP health, frontend document, frontend-to-backend proxy"
            )
        finally:
            for process in reversed(processes):
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
