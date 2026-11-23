"""Kontrak adapter. Adapter Kemal cukup mengimplementasikan Provider.generate().

Import dari modul ini, bukan llm.py, agar adapter tidak mengimpor registry balik.
Error/pesan metadata harus aman: jangan menyertakan prompt, respons, atau kredensial.
"""
from dataclasses import asdict, dataclass, field
from typing import Generic, Literal, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)
ErrorKind = Literal["configuration", "transient", "invalid_output", "permanent"]


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

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class ProviderResult(Generic[T]):
    data: T
    model: str  # Identitas publik, misalnya claude:claude-sonnet-5-5.
    attempts: tuple[Attempt, ...] = ()


class LLMError(Exception):
    def __init__(self, message: str, *, kind: ErrorKind = "permanent",
                 attempts: tuple[Attempt, ...] = ()):
        super().__init__(message)
        self.kind = kind
        self.attempts = attempts


class Provider(Protocol):
    name: str

    def generate(self, system: str, prompt: str, schema: type[T]) -> ProviderResult[T]: ...


def error_kind(error: Exception) -> ErrorKind:
    """Klasifikasi tanpa memasukkan pesan mentah SDK ke catatan klinis/log."""
    if isinstance(error, LLMError):
        return error.kind
    if isinstance(error, (ValidationError, ValueError)):
        return "invalid_output"
    code = getattr(error, "status_code", None) or getattr(error, "code", None)
    if code in (401, 403):
        return "configuration"
    if code in (408, 409, 429, 500, 502, 503, 504, 529) or (isinstance(code, int) and code >= 500):
        return "transient"
    if isinstance(error, (TimeoutError, ConnectionError)) or type(error).__name__ in (
            "APITimeoutError", "APIConnectionError"):
        return "transient"
    return "permanent"


def token_count(usage, name: str) -> int | None:
    value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
