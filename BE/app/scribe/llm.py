"""Facade LLM: generate() tetap mengembalikan (model Pydantic, nama model).

Provider baru mengembalikan ProviderResult dari llm_types; usage_report() memberikan
salinan metadata per instance/job tanpa prompt atau respons klinis.
"""
import logging
import time
from collections.abc import Callable
from importlib import import_module

from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.scribe.llm_claude import ClaudeProvider
from app.scribe.llm_types import Attempt, LLMError, ProviderResult, T, TokenUsage, error_kind, token_count

log = logging.getLogger("comehear.llm")


class GeminiProvider:
    name = "gemini"
    RETRY_DELAY_S = 2.0

    def __init__(self, s: Settings):
        if not s.gemini_api_key:
            raise LLMError("GEMINI_API_KEY kosong", kind="configuration")
        from google import genai
        self.genai = genai
        from google.genai import types
        # Batas waktu per panggilan: lebih baik pindah ke model cadangan daripada menunggu >1 menit.
        self.client = genai.Client(api_key=s.gemini_api_key, http_options=types.HttpOptions(timeout=45_000))
        self.models = [m.strip() for m in s.gemini_models.split(",") if m.strip()]
        if not self.models:
            raise LLMError("GEMINI_MODELS kosong", kind="configuration")

    # Model yang baru saja 503 dipindah ke belakang antrean selama COOLDOWN_S, supaya satu sesi
    # (pembicara -> S -> ICD) tidak membuang waktu mencoba model penuh yang sama tiga kali.
    COOLDOWN_S = 120
    _busy_until: dict[str, float] = {}

    def _ordered_models(self) -> list[str]:
        now = time.time()
        return sorted(self.models, key=lambda m: self._busy_until.get(m, 0) > now)

    @staticmethod
    def _retryable(error: Exception) -> bool:
        return getattr(error, "code", None) in (429, 500, 502, 503, 504) or isinstance(
            error, (TimeoutError, ConnectionError))

    def _generate_with_model(self, model: str, system: str, prompt: str, schema: type[T]) -> T:
        from google.genai import types
        res = self.client.models.generate_content(
            model=model, contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system, response_mime_type="application/json",
                response_schema=schema, temperature=0.0,
                # Ekstraksi terstruktur tidak butuh penalaran panjang.
                thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)))
        usage = getattr(res, "usage_metadata", None)
        self._attempt_usage = TokenUsage(
            input_tokens=token_count(usage, "prompt_token_count"),
            output_tokens=token_count(usage, "candidates_token_count"),
            cache_read_tokens=token_count(usage, "cached_content_token_count"),
            thinking_tokens=token_count(usage, "thoughts_token_count"),
        )
        return schema.model_validate_json(res.text)

    def generate(self, system: str, prompt: str, schema: type[T]) -> ProviderResult[T]:
        last = None
        retry_model = None
        attempts = []

        def request(model: str) -> T:
            start = time.perf_counter()
            self._attempt_usage = TokenUsage()
            try:
                result = self._generate_with_model(model, system, prompt, schema)
            except Exception as exc:
                attempts.append(Attempt(self.name, model, round(time.perf_counter() - start, 4),
                                        "error", self._attempt_usage, error_kind(exc)))
                raise
            attempts.append(Attempt(self.name, model, round(time.perf_counter() - start, 4),
                                    "ok", self._attempt_usage))
            return result

        for model in self._ordered_models():
            try:
                result = request(model)
                self._busy_until.pop(model, None)
                return ProviderResult(result, f"gemini:{model}", tuple(attempts))
            except Exception as e:  # model lain dicoba sebelum menunggu model yang sedang sibuk
                last = e
                if self._retryable(e):
                    self._busy_until[model] = time.time() + self.COOLDOWN_S
                    retry_model = model
                log.warning("Gemini %s gagal (%s)", model, error_kind(e))
        # Satu retry dengan jeda setelah semua model gagal. Batasnya satu panggilan tambahan.
        if retry_model:
            time.sleep(self.RETRY_DELAY_S)
            try:
                result = request(retry_model)
                self._busy_until.pop(retry_model, None)
                return ProviderResult(result, f"gemini:{retry_model}", tuple(attempts))
            except Exception as e:
                last = e
                log.warning("Retry Gemini %s gagal (%s)", retry_model, error_kind(e))
        raise LLMError("semua model Gemini gagal", kind=error_kind(last) if last else "configuration",
                       attempts=tuple(attempts)) from None


def _openai_provider(settings: Settings):
    """Titik integrasi B1 Kemal: file/class ini belum perlu ada pada PR A1-A5."""
    try:
        module = import_module("app.scribe.llm_openai")
    except ModuleNotFoundError as exc:
        if exc.name == "app.scribe.llm_openai":
            raise LLMError("Adapter OpenAI belum tersedia (task B1 Kemal)", kind="configuration") from None
        raise LLMError("Dependensi adapter OpenAI belum terpasang", kind="configuration") from None
    return module.OpenAIProvider(settings)


PROVIDERS: dict[str, Callable] = {
    "claude": ClaudeProvider,
    "gemini": GeminiProvider,
    "openai": _openai_provider,
}


class LLM:
    def __init__(self, s: Settings, mock: Callable[[str, type[T]], T] | None = None):
        self.providers = []
        self.mock = mock
        self._calls: list[dict] = []
        self._configuration_errors: list[str] = []
        names = s.provider_list
        if any(name not in (*PROVIDERS, "mock") for name in names):
            raise LLMError("penyedia LLM tidak didukung", kind="configuration")
        if "mock" in names and (names[-1] != "mock" or names.count("mock") != 1):
            raise LLMError("mock hanya boleh muncul sekali di akhir LLM_PROVIDERS", kind="configuration")
        for name in dict.fromkeys(names):
            if name == "mock":
                continue
            try:
                self.providers.append(PROVIDERS[name](s))
            except Exception as exc:
                # Hanya konfigurasi provider yang boleh dilewati, bukan bug adapter.
                if not isinstance(exc, (LLMError, ImportError)):
                    raise LLMError(f"Inisialisasi provider {name} gagal", kind="configuration") from None
                if isinstance(exc, LLMError) and exc.kind != "configuration":
                    raise
                self._configuration_errors.append(name)
                log.warning("penyedia %s dilewati (configuration)", name)
        self.use_mock = "mock" in names

    def _record(self, schema: type[BaseModel], attempts: tuple[Attempt, ...]) -> None:
        self._calls.append({"task": schema.__name__, "attempts": [a.to_dict() for a in attempts]})

    def usage_report(self) -> dict:
        """Snapshot JSON metadata; totals hanya jumlah token yang diketahui.

        Cache/thinking tetap terpisah, karena arti input/output berbeda antarprovider.
        complete=False berarti total ini bukan total seluruh token/biaya yang ditagih.
        """
        from copy import deepcopy

        calls = deepcopy(self._calls)
        attempts = [a for call in calls for a in call["attempts"]]
        keys = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "thinking_tokens")
        totals = {}
        for key in keys:
            known = [a["usage"][key] for a in attempts if a["usage"][key] is not None]
            totals[key] = sum(known) if known else None
        return {"version": 1, "calls": calls, "totals": totals,
                "unknown_usage_attempts": sum(a["usage"]["input_tokens"] is None or
                                              a["usage"]["output_tokens"] is None for a in attempts),
                "complete": bool(attempts) and all(a["usage"]["input_tokens"] is not None and
                                                  a["usage"]["output_tokens"] is not None for a in attempts),
                "skipped_providers": list(self._configuration_errors)}

    def generate(self, system: str, prompt: str, schema: type[T]) -> tuple[T, str]:
        errors = []
        for p in self.providers:
            try:
                result = p.generate(system, prompt, schema)
            except LLMError as e:
                attempts = e.attempts or (Attempt(p.name, "unknown", 0.0, "error", error_kind=e.kind),)
                self._record(schema, attempts)
                errors.append(e.kind)
                continue
            try:
                data = schema.model_validate(result.data)
            except ValidationError:
                # Defensif terhadap adapter yang melanggar kontrak; usage tetap tercatat.
                self._record(schema, result.attempts + (
                    Attempt(p.name, result.model, 0.0, "error", error_kind="invalid_output"),))
                errors.append("invalid_output")
                continue
            self._record(schema, result.attempts or (Attempt(p.name, result.model, 0.0, "ok"),))
            return data, result.model
        if self.use_mock and self.mock:
            start = time.perf_counter()
            try:
                data = schema.model_validate(self.mock(prompt, schema))
            except Exception:
                self._record(schema, (Attempt("mock", "mock", round(time.perf_counter() - start, 4),
                                              "error", TokenUsage(0, 0), "invalid_output"),))
                raise LLMError("Mock tidak mendukung schema/output ini", kind="invalid_output") from None
            self._record(schema, (Attempt("mock", "mock", round(time.perf_counter() - start, 4),
                                          "ok", TokenUsage(0, 0)),))
            return data, "mock"
        kind = errors[-1] if errors else "configuration"
        raise LLMError("semua penyedia LLM gagal" if errors else
                       "tidak ada penyedia LLM yang aktif (periksa provider, SDK, dan API key)", kind=kind)
