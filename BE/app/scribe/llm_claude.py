"""Claude structured outputs dengan fallback multi-model, smart retry, dan circuit breaker.

SDK: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
Retry SDK dinonaktifkan (max_retries=0); kendali retry, Retry-After, circuit breaker,
dan batas waktu keseluruhan dikelola eksplisit di sini.
"""
import time

from pydantic import BaseModel

from app.config import Settings
from app.scribe.circuit_breaker import CircuitBreaker, DEFAULT_BREAKER
from app.scribe.llm_types import (
    Attempt,
    LLMError,
    ProviderResult,
    T,
    TokenUsage,
    classify_error,
    is_availability_failure,
    token_count,
)


class ClaudeProvider:
    name = "claude"
    RETRY_DELAY_S = 1.0
    SCHEMA_MAX_TOKENS: dict[str, int] = {
        "IcdKeywords": 512,
        "SpeakerLabels": 1024,
        "IcdPicks": 1280,
        "IcdRerankResult": 1536,
    }

    def __init__(self, s: Settings, *, breaker: CircuitBreaker | None = None):
        if not s.anthropic_api_key.strip():
            raise LLMError("ANTHROPIC_API_KEY kosong", kind="configuration", reason="auth")
        models = s.claude_model_list
        if not models:
            raise LLMError("CLAUDE_MODEL / CLAUDE_MODELS kosong", kind="configuration")
        try:
            from anthropic import Anthropic
        except ImportError:
            raise LLMError("SDK anthropic belum terpasang", kind="configuration") from None

        self.models = models
        self.model = models[0]
        self.max_tokens = s.claude_max_tokens
        self.prompt_cache = s.claude_prompt_cache
        self.prompt_cache_min_chars = s.claude_prompt_cache_min_chars
        self.thinking_disabled = s.claude_thinking_disabled
        self.effort = s.claude_effort.strip().lower()
        self.timeout_s = s.llm_timeout_s
        self.total_timeout_s = s.llm_total_timeout_s
        self.max_retries = s.llm_max_retries
        self.cb_failure_threshold = s.llm_cb_failure_threshold
        self.cb_cooldown_s = s.llm_cb_cooldown_s
        self.retry_after_max_s = s.llm_retry_after_max_s
        self.breaker = breaker or DEFAULT_BREAKER
        self.client = Anthropic(api_key=s.anthropic_api_key, timeout=self.timeout_s, max_retries=0)

    def _max_tokens_for(self, schema: type[T]) -> int:
        cap = self.SCHEMA_MAX_TOKENS.get(getattr(schema, "__name__", ""), self.max_tokens)
        return min(self.max_tokens, cap)

    def _system_payload(self, system: str):
        if self.prompt_cache and system and len(system) >= self.prompt_cache_min_chars:
            return [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        return system

    def _call_with_usage(
        self,
        model: str,
        system: str,
        prompt: str,
        schema: type[T],
        timeout_s: float,
    ) -> tuple[T | None, TokenUsage, Exception | None]:
        """Wrapper yang memastikan usage tetap terbaca bila validasi schema gagal sesudah respons diterima."""
        usage = TokenUsage()
        kwargs: dict = {
            "model": model,
            "max_tokens": self._max_tokens_for(schema),
            "system": self._system_payload(system),
            "messages": [{"role": "user", "content": prompt}],
            "output_format": schema,
            "timeout": timeout_s,
        }
        if self.thinking_disabled:
            kwargs["thinking"] = {"type": "disabled"}
        if self.effort in ("low", "medium", "high"):
            kwargs["output_config"] = {"effort": self.effort}
        try:
            response = self.client.messages.parse(**kwargs)
        except Exception as exc:
            return None, usage, exc

        raw_usage = getattr(response, "usage", None)
        usage = TokenUsage(
            input_tokens=token_count(raw_usage, "input_tokens"),
            output_tokens=token_count(raw_usage, "output_tokens"),
            cache_read_tokens=token_count(raw_usage, "cache_read_input_tokens"),
            cache_creation_tokens=token_count(raw_usage, "cache_creation_input_tokens"),
        )
        stop_reason = getattr(response, "stop_reason", None)
        if stop_reason == "refusal":
            return None, usage, LLMError("Claude menolak output terstruktur", kind="invalid_output", reason="refusal")
        if stop_reason == "max_tokens":
            return None, usage, LLMError("Output Claude terpotong batas max_tokens", kind="invalid_output", reason="truncated")
        if stop_reason != "end_turn" or response.parsed_output is None:
            return None, usage, LLMError("Claude belum menyelesaikan output terstruktur", kind="invalid_output", reason="empty_output")

        parsed = response.parsed_output
        try:
            data = schema.model_validate(parsed.model_dump() if isinstance(parsed, BaseModel) else parsed)
        except Exception as exc:
            kind, reason, status_code, _ = classify_error(exc)
            return None, usage, LLMError(
                "Output Claude gagal validasi schema", kind=kind, reason=reason, status_code=status_code
            )
        return data, usage, None

    def generate(
        self,
        system: str,
        prompt: str,
        schema: type[T],
        *,
        deadline: float | None = None,
    ) -> ProviderResult[T]:
        overall_deadline = deadline if deadline is not None else (time.monotonic() + self.total_timeout_s)
        attempts: list[Attempt] = []
        max_attempts_per_model = self.max_retries + 1
        model_attempts = {m: 0 for m in self.models}
        retry_eligible = {m: True for m in self.models}
        retry_earliest = {m: 0.0 for m in self.models}
        last_kind = "transient"
        last_reason = "unknown"
        last_status: int | None = None
        last_retry_after: float | None = None

        for round_idx in range(max_attempts_per_model):
            progressed = False
            for model in self.models:
                if model_attempts[model] >= max_attempts_per_model or not retry_eligible[model]:
                    continue

                now = time.monotonic()
                remaining = overall_deadline - now
                if remaining <= 0:
                    last_kind, last_reason = "transient", "deadline_exceeded"
                    attempts.append(Attempt(self.name, model, 0.0, "error", TokenUsage(), "transient", "deadline_exceeded"))
                    raise LLMError(
                        "Batas waktu total pemanggilan Claude terlampaui",
                        kind="transient",
                        reason="deadline_exceeded",
                        attempts=tuple(attempts),
                    )

                allowed, cb_status = self.breaker.allow_request(self.name, model)
                if not allowed:
                    retry_eligible[model] = False
                    if cb_status == "auth_disabled":
                        last_kind, last_reason, last_status = "configuration", "auth", 401
                        attempts.append(Attempt(self.name, model, 0.0, "error", TokenUsage(), "configuration", "auth", 401))
                        raise LLMError(
                            "Claude dinonaktifkan sementara karena autentikasi gagal",
                            kind="configuration",
                            reason="auth",
                            status_code=401,
                            attempts=tuple(attempts),
                        )
                    attempts.append(Attempt(self.name, model, 0.0, "error", TokenUsage(), "transient", "circuit_open"))
                    last_kind, last_reason = "transient", "circuit_open"
                    continue

                if round_idx > 0:
                    delay_s = retry_earliest[model] - now
                    if delay_s > 0:
                        if delay_s >= remaining:
                            self.breaker.record_probe_neutral(self.name, model)
                            retry_eligible[model] = False
                            attempts.append(Attempt(self.name, model, 0.0, "error", TokenUsage(), "transient", "deadline_exceeded"))
                            last_kind, last_reason = "transient", "deadline_exceeded"
                            continue
                        time.sleep(delay_s)
                        remaining = overall_deadline - time.monotonic()
                        if remaining <= 0:
                            self.breaker.record_probe_neutral(self.name, model)
                            attempts.append(Attempt(self.name, model, 0.0, "error", TokenUsage(), "transient", "deadline_exceeded"))
                            raise LLMError(
                                "Batas waktu total pemanggilan Claude terlampaui",
                                kind="transient",
                                reason="deadline_exceeded",
                                attempts=tuple(attempts),
                            )

                progressed = True
                model_attempts[model] += 1
                req_timeout = min(self.timeout_s, max(0.05, remaining))
                start = time.perf_counter()
                data, usage, exc = self._call_with_usage(model, system, prompt, schema, req_timeout)
                duration_s = round(time.perf_counter() - start, 4)

                if exc is None and data is not None:
                    self.breaker.record_success(self.name, model)
                    attempts.append(Attempt(self.name, model, duration_s, "ok", usage))
                    return ProviderResult(data, f"{self.name}:{model}", tuple(attempts))

                assert exc is not None
                kind, reason, status_code, retry_after_s = classify_error(exc)
                last_kind, last_reason, last_status, last_retry_after = kind, reason, status_code, retry_after_s
                attempts.append(Attempt(self.name, model, duration_s, "error", usage, kind, reason, status_code))

                if reason == "auth":
                    self.breaker.record_auth_failure(self.name, cooldown_s=max(self.cb_cooldown_s, 300.0))
                    raise LLMError(
                        "Autentikasi Claude gagal; periksa API key atau izin",
                        kind="configuration",
                        reason="auth",
                        status_code=status_code,
                        attempts=tuple(attempts),
                    ) from None

                if is_availability_failure(kind, reason):
                    cb_state = self.breaker.record_availability_failure(
                        self.name,
                        model,
                        threshold=self.cb_failure_threshold,
                        cooldown_s=self.cb_cooldown_s,
                        retry_after_s=retry_after_s,
                    )
                    if cb_state == "open":
                        retry_eligible[model] = False
                    elif reason == "rate_limit" and retry_after_s is not None:
                        if retry_after_s > self.retry_after_max_s or (time.monotonic() + retry_after_s >= overall_deadline):
                            retry_eligible[model] = False
                        else:
                            retry_earliest[model] = time.monotonic() + retry_after_s
                    else:
                        retry_earliest[model] = time.monotonic() + self.RETRY_DELAY_S
                else:
                    self.breaker.record_probe_neutral(self.name, model)
                    # Retry terkontrol 1x hanya untuk invalid JSON / validation error; refusal/truncated/4xx langsung fallback.
                    retry_eligible[model] = reason in ("invalid_json", "validation_error")
                    retry_earliest[model] = time.monotonic()

            if not progressed:
                break

        raise LLMError(
            f"Claude gagal ({last_kind}:{last_reason}); periksa konfigurasi atau coba lagi",
            kind=last_kind,
            reason=last_reason,
            status_code=last_status,
            retry_after_s=last_retry_after,
            attempts=tuple(attempts),
        )
