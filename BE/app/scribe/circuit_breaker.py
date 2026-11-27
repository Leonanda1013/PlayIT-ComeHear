"""Thread-safe circuit breaker per (provider, model) dan level auth provider."""
import threading
import time
from dataclasses import dataclass
from typing import Callable, Literal

CircuitState = Literal["closed", "open", "half_open"]


@dataclass
class _BreakerSlot:
    state: CircuitState = "closed"
    consecutive_failures: int = 0
    open_until: float = 0.0
    probe_in_flight: bool = False


class CircuitBreaker:
    """Melindungi model LLM dari request beruntun saat overload, rate limit, atau auth gagal."""

    def __init__(self, clock: Callable[[], float] | None = None):
        self._clock = clock or time.monotonic
        self._lock = threading.Lock()
        self._slots: dict[tuple[str, str], _BreakerSlot] = {}
        self._provider_auth_until: dict[str, float] = {}

    def _slot(self, provider: str, model: str) -> _BreakerSlot:
        key = (provider, model)
        slot = self._slots.get(key)
        if slot is None:
            slot = _BreakerSlot()
            self._slots[key] = slot
        return slot

    def allow_request(self, provider: str, model: str) -> tuple[bool, str]:
        """Izinkan request bila auth sehat dan circuit CLOSED atau HALF_OPEN (1 probe)."""
        now = self._clock()
        with self._lock:
            auth_until = self._provider_auth_until.get(provider, 0.0)
            if auth_until > now:
                return False, "auth_disabled"
            if auth_until and auth_until <= now:
                self._provider_auth_until.pop(provider, None)

            slot = self._slot(provider, model)
            if slot.state == "closed":
                return True, "closed"
            if slot.state == "open":
                if now < slot.open_until:
                    return False, "open"
                slot.state = "half_open"
                slot.probe_in_flight = True
                return True, "half_open_probe"
            if slot.probe_in_flight:
                return False, "half_open_busy"
            slot.probe_in_flight = True
            return True, "half_open_probe"

    def record_success(self, provider: str, model: str) -> None:
        with self._lock:
            slot = self._slot(provider, model)
            slot.state = "closed"
            slot.consecutive_failures = 0
            slot.open_until = 0.0
            slot.probe_in_flight = False

    def record_availability_failure(
        self,
        provider: str,
        model: str,
        *,
        threshold: int = 2,
        cooldown_s: float = 60.0,
        retry_after_s: float | None = None,
    ) -> CircuitState:
        """Catat gangguan ketersediaan (429/529/5xx/timeout/koneksi); buka circuit jika melewati ambang."""
        now = self._clock()
        wait_s = max(cooldown_s, retry_after_s or 0.0)
        with self._lock:
            slot = self._slot(provider, model)
            slot.probe_in_flight = False
            if slot.state == "half_open":
                slot.state = "open"
                slot.open_until = now + wait_s
                return slot.state
            slot.consecutive_failures += 1
            if slot.consecutive_failures >= max(1, threshold):
                slot.state = "open"
                slot.open_until = now + wait_s
            return slot.state

    def record_probe_neutral(self, provider: str, model: str) -> None:
        """Lepaskan kunci half-open tanpa membuka circuit bila respons diterima (mis. output invalid)."""
        with self._lock:
            slot = self._slot(provider, model)
            if slot.state == "half_open":
                slot.state = "closed"
                slot.consecutive_failures = 0
                slot.open_until = 0.0
            slot.probe_in_flight = False

    def record_auth_failure(self, provider: str, cooldown_s: float = 300.0) -> None:
        """Tandai seluruh provider bermasalah pada 401/403 agar tidak diulang terus."""
        now = self._clock()
        with self._lock:
            self._provider_auth_until[provider] = now + max(1.0, cooldown_s)
            for (prov, _), slot in self._slots.items():
                if prov == provider:
                    slot.probe_in_flight = False

    def snapshot(self) -> dict[str, dict]:
        now = self._clock()
        with self._lock:
            models = {}
            for (prov, model), slot in self._slots.items():
                remaining = max(0.0, round(slot.open_until - now, 2)) if slot.state == "open" else 0.0
                models[f"{prov}:{model}"] = {
                    "state": slot.state,
                    "consecutive_failures": slot.consecutive_failures,
                    "open_remaining_s": remaining,
                    "probe_in_flight": slot.probe_in_flight,
                }
            auth_disabled = {
                prov: round(until - now, 2)
                for prov, until in self._provider_auth_until.items()
                if until > now
            }
            return {"models": models, "auth_disabled": auth_disabled}

    def reset(self) -> None:
        with self._lock:
            self._slots.clear()
            self._provider_auth_until.clear()


DEFAULT_BREAKER = CircuitBreaker()
