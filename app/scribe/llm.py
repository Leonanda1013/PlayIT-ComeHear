"""Lapisan penyedia LLM yang bisa diganti-ganti.

LLM_PROVIDERS="gemini,anthropic" -> coba Gemini (beberapa model), jika gagal pindah ke Claude.
"mock" dipakai untuk uji tanpa API (mengembalikan hasil heuristik deterministik).
Catatan UU PDP Pasal 56: API luar negeri berarti data transkrip keluar Indonesia;
selama kompetisi hanya data sintetis/role-play yang dikirim.
"""
import logging
import time
from collections.abc import Callable
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.config import Settings

log = logging.getLogger("comehear.llm")
T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    pass


class GeminiProvider:
    name = "gemini"

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

    def generate(self, system: str, prompt: str, schema: type[T]) -> tuple[T, str]:
        from google.genai import types
        from google.genai.errors import ClientError
        last = None
        for model in self._ordered_models():
            try:
                res = self.client.models.generate_content(
                    model=model, contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system, response_mime_type="application/json",
                        response_schema=schema, temperature=0.0,
                        # Ekstraksi terstruktur tidak butuh penalaran panjang; thinking bawaan
                        # membuat satu panggilan ~2 menit.
                        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)))
                return schema.model_validate_json(res.text), f"gemini:{model}"
            except Exception as e:  # 5xx, 429, batas waktu, JSON tidak valid -> model berikutnya
                last = e
                if not isinstance(e, (ClientError, ValidationError)) or getattr(e, "code", None) == 429:
                    self._busy_until[model] = time.time() + self.COOLDOWN_S
                log.warning("Gemini %s gagal: %s", model, str(e)[:120])
        raise LLMError(f"semua model Gemini gagal: {last}")


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, s: Settings):
        import anthropic
        self.anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=s.anthropic_api_key or None)
        self.model = s.anthropic_model

    def generate(self, system: str, prompt: str, schema: type[T]) -> tuple[T, str]:
        a = self.anthropic
        try:
            # Fallback sisi server: bila penolakan klasifikasi keamanan, server mengalihkan model.
            res = self.client.beta.messages.parse(
                model=self.model, max_tokens=16000, system=system,
                messages=[{"role": "user", "content": prompt}],
                output_format=schema,
                betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        except (a.RateLimitError, a.APIConnectionError, a.InternalServerError, a.BadRequestError,
                a.AuthenticationError) as e:
            raise LLMError(f"Claude gagal: {e}") from e
        if res.stop_reason == "refusal":
            raise LLMError("Claude menolak permintaan (refusal)")
        if res.parsed_output is None:
            raise LLMError(f"Claude tidak mengembalikan JSON valid (stop_reason={res.stop_reason})")
        return res.parsed_output, f"anthropic:{res.model}"


class LLM:
    def __init__(self, s: Settings, mock: Callable[[str, type[T]], T] | None = None):
        self.providers = []
        self.mock = mock
        for name in s.provider_list:
            try:
                if name == "gemini":
                    self.providers.append(GeminiProvider(s))
                elif name == "anthropic":
                    self.providers.append(AnthropicProvider(s))
            except Exception as e:  # key kosong / SDK tidak siap: lewati penyedia ini
                log.warning("penyedia %s dilewati: %s", name, e)
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
