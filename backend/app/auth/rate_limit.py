"""Small in-memory login limiter for the single-process demo API."""

import math
import time
from collections import deque
from collections.abc import Callable
from threading import Lock


class FailedLoginLimiter:
    def __init__(
        self,
        max_failures: int = 5,
        window_seconds: int = 15 * 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.clock = clock
        self._failures: dict[tuple[str, str], deque[float]] = {}
        self._lock = Lock()

    def _prune(self, failures: deque[float], now: float) -> None:
        while failures and failures[0] <= now - self.window_seconds:
            failures.popleft()

    def retry_after(self, email: str, ip_address: str) -> int | None:
        """Seconds until another attempt is allowed, if this pair is blocked."""
        key = (email, ip_address)
        with self._lock:
            now = self.clock()
            failures = self._failures.get(key)
            if failures is None:
                return None
            self._prune(failures, now)
            if not failures:
                del self._failures[key]
                return None
            if len(failures) < self.max_failures:
                return None
            return max(1, math.ceil(failures[0] + self.window_seconds - now))

    def record_failure(self, email: str, ip_address: str) -> None:
        key = (email, ip_address)
        with self._lock:
            now = self.clock()
            failures = self._failures.setdefault(key, deque())
            self._prune(failures, now)
            failures.append(now)

    def clear(self, email: str, ip_address: str) -> None:
        with self._lock:
            self._failures.pop((email, ip_address), None)

    def reset(self) -> None:
        """Clear demo state; used by isolated API tests."""
        with self._lock:
            self._failures.clear()


login_limiter = FailedLoginLimiter()
