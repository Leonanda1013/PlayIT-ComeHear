"""Claude structured outputs. Tidak mengubah prompt/schema klinis pemanggil.

SDK: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
Retry SDK dinonaktifkan: paling banyak dua request, masing-masing timeout 45 detik
secara default. Tidak ada fallback model/provider tersembunyi.
"""
import time

from pydantic import BaseModel

from app.config import Settings
from app.scribe.llm_types import Attempt, LLMError, ProviderResult, T, TokenUsage, error_kind, token_count


class ClaudeProvider:
    name = "claude"
    RETRY_DELAY_S = 1.0

    def __init__(self, s: Settings):
        if not s.anthropic_api_key.strip():
            raise LLMError("ANTHROPIC_API_KEY kosong", kind="configuration")
        if not s.claude_model.strip():
            raise LLMError("CLAUDE_MODEL kosong", kind="configuration")
        try:
            from anthropic import Anthropic
        except ImportError:
            raise LLMError("SDK anthropic belum terpasang", kind="configuration") from None
        self.model = s.claude_model.strip()
        self.max_tokens = s.claude_max_tokens
        self.timeout_s = s.llm_timeout_s
        self.max_retries = s.llm_max_retries
        self.client = Anthropic(api_key=s.anthropic_api_key, timeout=self.timeout_s, max_retries=0)

    def generate(self, system: str, prompt: str, schema: type[T]) -> ProviderResult[T]:
        attempts = []
        for n in range(self.max_retries + 1):
            start = time.perf_counter()
            usage = TokenUsage()
            try:
                response = self.client.messages.parse(
                    model=self.model, max_tokens=self.max_tokens, system=system,
                    messages=[{"role": "user", "content": prompt}], output_format=schema,
                    timeout=self.timeout_s,
                )
                raw_usage = getattr(response, "usage", None)
                usage = TokenUsage(
                    input_tokens=token_count(raw_usage, "input_tokens"),
                    output_tokens=token_count(raw_usage, "output_tokens"),
                    cache_read_tokens=token_count(raw_usage, "cache_read_input_tokens"),
                    cache_creation_tokens=token_count(raw_usage, "cache_creation_input_tokens"),
                )
                if response.stop_reason != "end_turn" or response.parsed_output is None:
                    raise LLMError("Claude menolak atau belum menyelesaikan output terstruktur",
                                   kind="invalid_output")
                parsed = response.parsed_output
                # Validasi ulang tipe asli, termasuk bila SDK mengembalikan model lain.
                data = schema.model_validate(parsed.model_dump() if isinstance(parsed, BaseModel) else parsed)
            except Exception as exc:
                kind = error_kind(exc)
                attempts.append(Attempt(self.name, self.model, round(time.perf_counter() - start, 4),
                                        "error", usage, kind))
                if kind == "transient" and n < self.max_retries:
                    time.sleep(self.RETRY_DELAY_S)
                    continue
                raise LLMError(f"Claude gagal ({kind}); periksa konfigurasi atau coba lagi",
                               kind=kind, attempts=tuple(attempts)) from None
            attempts.append(Attempt(self.name, self.model, round(time.perf_counter() - start, 4), "ok", usage))
            return ProviderResult(data, f"claude:{self.model}", tuple(attempts))
        raise AssertionError("batas retry tidak valid")
