"""Kontrak adapter. Adapter Kemal cukup mengimplementasikan Provider.generate().

Import dari modul ini, bukan llm.py, agar adapter tidak mengimpor registry balik.
Error/pesan metadata harus aman: jangan menyertakan prompt, respons, atau kredensial.
"""
import json
from dataclasses import asdict, dataclass, field
from typing import Generic, Literal, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)
ErrorKind = Literal["configuration", "transient", "invalid_output", "permanent"]
ErrorReason = Literal[
    "auth",
    "rate_limit",
    "overloaded",
    "server_error",
    "timeout",
    "connection",
    "invalid_json",
    "validation_error",
    "refusal",
    "truncated",
    "empty_output",
    "circuit_open",
    "deadline_exceeded",
    "bad_request",
    "unknown",
]


@dataclass(frozen=True)
class TokenUsage:
    # Nilai mentah provider; token cache dipisahkan, bukan estimasi biaya.
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_creation_tokens: int | None = None
    thinking_tokens: int | None = None


@dataclass(frozen=True)
class Attempt:
    provider: str
    model: str
    duration_s: float
    status: Literal["ok", "error"]
    usage: TokenUsage = field(default_factory=TokenUsage)
    error_kind: ErrorKind | None = None
    error_reason: str | None = None
    status_code: int | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class ProviderResult(Generic[T]):
    data: T
    model: str  # Identitas publik, misalnya claude:claude-sonnet-5-5.
    attempts: tuple[Attempt, ...] = ()


class LLMError(Exception):
    def __init__(
        self,
        message: str,
        *,
        kind: ErrorKind = "permanent",
        reason: str | None = None,
        status_code: int | None = None,
        retry_after_s: float | None = None,
        attempts: tuple[Attempt, ...] = (),
    ):
        super().__init__(message)
        self.kind = kind
        self.reason = reason
        self.status_code = status_code
        self.retry_after_s = retry_after_s
        self.attempts = attempts


class Provider(Protocol):
    name: str

    def generate(self, system: str, prompt: str, schema: type[T]) -> ProviderResult[T]: ...


def _extract_retry_after(error: Exception) -> float | None:
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None) if response is not None else getattr(error, "headers", None)
    if not headers or not hasattr(headers, "get"):
        return None
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if raw is None:
        return None
    try:
        val = float(str(raw).strip())
        return max(0.0, val)
    except ValueError:
        return None


def classify_error(error: Exception) -> tuple[ErrorKind, str, int | None, float | None]:
    """Klasifikasi aman tanpa memasukkan pesan mentah SDK ke catatan klinis/log."""
    if isinstance(error, LLMError):
        return error.kind, error.reason or "unknown", error.status_code, error.retry_after_s

    code = getattr(error, "status_code", None) or getattr(error, "code", None)
    status_code = int(code) if isinstance(code, int) and not isinstance(code, bool) else None
    retry_after = _extract_retry_after(error)

    if isinstance(error, json.JSONDecodeError):
        return "invalid_output", "invalid_json", status_code, None
    if isinstance(error, ValidationError):
        # Anthropic / Pydantic membungkus JSON invalid atau ketidakcocokan schema sebagai ValidationError.
        msg = str(error).lower()
        reason = "invalid_json" if "json_invalid" in msg or "invalid json" in msg else "validation_error"
        return "invalid_output", reason, status_code, None
    if isinstance(error, ValueError):
        return "invalid_output", "invalid_json", status_code, None

    if status_code in (401, 403):
        return "configuration", "auth", status_code, None
    if status_code == 429:
        return "transient", "rate_limit", status_code, retry_after
    if status_code == 529:
        return "transient", "overloaded", status_code, retry_after
    if status_code in (500, 502, 503, 504) or (status_code is not None and status_code >= 500):
        return "transient", "server_error", status_code, retry_after
    if status_code in (408, 409):
        return "transient", "timeout" if status_code == 408 else "server_error", status_code, retry_after

    err_name = type(error).__name__
    if isinstance(error, TimeoutError) or err_name in ("APITimeoutError", "ReadTimeout", "ConnectTimeout"):
        return "transient", "timeout", status_code, None
    if isinstance(error, ConnectionError) or err_name in ("APIConnectionError", "ConnectError"):
        return "transient", "connection", status_code, None

    if status_code is not None and 400 <= status_code < 500:
        return "permanent", "bad_request", status_code, None
    return "permanent", "unknown", status_code, None


def error_kind(error: Exception) -> ErrorKind:
    """Klasifikasi singkat untuk kompatibilitas pemanggil lama."""
    return classify_error(error)[0]


def is_availability_failure(kind: ErrorKind, reason: str | None) -> bool:
    """Hanya gangguan ketersediaan (429/529/5xx/timeout/koneksi) yang memicu circuit breaker model."""
    return kind == "transient" and reason not in ("circuit_open", "deadline_exceeded")


def token_count(usage, name: str) -> int | None:
    value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
