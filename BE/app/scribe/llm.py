"""Lapisan LLM Gemini dengan fallback antar-model.

LLM_PROVIDERS="gemini" memakai API; "mock" untuk uji tanpa API.
"mock" dipakai untuk uji tanpa API (mengembalikan hasil heuristik deterministik).
Catatan UU PDP Pasal 56: API luar negeri berarti data transkrip keluar Indonesia;
selama kompetisi hanya data sintetis/role-play yang dikirim.
"""
import logging
import time
from collections.abc import Callable
from typing import TypeVar

from pydantic import BaseModel

from app.config import Settings

log = logging.getLogger("comehear.llm")
T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    pass


class GeminiProvider:
    name = "gemini"
    RETRY_DELAY_S = 2.0

    def __init__(self, s: Settings):
        if not s.gemini_api_key:
            raise LLMError("GEMINI_API_KEY kosong")
        from google import genai
        self.genai = genai
        from google.genai import types
        # Batas waktu per panggilan: lebih baik pindah ke model cadangan daripada menunggu >1 menit.
        self.client = genai.Client(api_key=s.gemini_api_key, http_options=types.HttpOptions(timeout=45_000))
        self.models = [m.strip() for m in s.gemini_models.split(",") if m.strip()]

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
        return schema.model_validate_json(res.text)

    def generate(self, system: str, prompt: str, schema: type[T]) -> tuple[T, str]:
        last = None
        retry_model = None
        for model in self._ordered_models():
            try:
                result = self._generate_with_model(model, system, prompt, schema)
                self._busy_until.pop(model, None)
                return result, f"gemini:{model}"
            except Exception as e:  # model lain dicoba sebelum menunggu model yang sedang sibuk
                last = e
                if self._retryable(e):
                    self._busy_until[model] = time.time() + self.COOLDOWN_S
                    retry_model = model
                log.warning("Gemini %s gagal: %s", model, str(e)[:120])
        # Satu retry dengan jeda setelah semua model gagal. Batasnya satu panggilan tambahan.
        if retry_model:
            time.sleep(self.RETRY_DELAY_S)
            try:
                result = self._generate_with_model(retry_model, system, prompt, schema)
                self._busy_until.pop(retry_model, None)
                return result, f"gemini:{retry_model}"
            except Exception as e:
                last = e
                log.warning("Retry Gemini %s gagal: %s", retry_model, str(e)[:120])
        raise LLMError(f"semua model Gemini gagal: {last}")


class LLM:
    def __init__(self, s: Settings, mock: Callable[[str, type[T]], T] | None = None):
        self.providers = []
        self.mock = mock
        for name in s.provider_list:
            if name == "gemini":
                try:
                    self.providers.append(GeminiProvider(s))
                except Exception as e:  # key kosong / SDK tidak siap
                    log.warning("penyedia Gemini dilewati: %s", e)
            elif name != "mock":
                raise LLMError(f"penyedia LLM tidak didukung: {name}")
        self.use_mock = "mock" in s.provider_list

    def generate(self, system: str, prompt: str, schema: type[T]) -> tuple[T, str]:
        errors = []
        for p in self.providers:
            try:
                return p.generate(system, prompt, schema)
            except LLMError as e:
                errors.append(str(e))
        if self.use_mock and self.mock:
            return self.mock(prompt, schema), "mock"
        raise LLMError(" | ".join(errors) or "tidak ada penyedia LLM yang aktif (isi API key di .env)")
