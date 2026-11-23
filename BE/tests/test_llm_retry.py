import pytest

from app.scribe.llm import GeminiProvider, LLMError


class TemporaryFailure(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__("overloaded")


class BadRequest(Exception):
    code = 400


def provider(monkeypatch):
    p = object.__new__(GeminiProvider)
    p.models = ["first", "second", "last"]
    monkeypatch.setattr(GeminiProvider, "_busy_until", {})
    monkeypatch.setattr("app.scribe.llm.time.sleep", lambda _: None)
    return p


@pytest.mark.parametrize("code", [503, 504])
def test_gemini_retries_once_after_trying_other_models(monkeypatch, code):
    p = provider(monkeypatch)
    calls = []

    def request(model, system, prompt, schema):
        calls.append(model)
        if len(calls) < 4:
            raise TemporaryFailure(code)
        return "ok"

    monkeypatch.setattr(p, "_generate_with_model", request)
    result = p.generate("system", "prompt", str)
    assert (result.data, result.model) == ("ok", "gemini:last")
    assert len(result.attempts) == 4
    assert calls == ["first", "second", "last", "last"]
    assert "last" not in p._busy_until


def test_gemini_uses_next_model_without_waiting_for_retry(monkeypatch):
    p = provider(monkeypatch)
    calls = []

    def request(model, system, prompt, schema):
        calls.append(model)
        if model == "first":
            raise TemporaryFailure(503)
        return "ok"

    monkeypatch.setattr(p, "_generate_with_model", request)
    result = p.generate("system", "prompt", str)
    assert (result.data, result.model) == ("ok", "gemini:second")
    assert len(result.attempts) == 2
    assert calls == ["first", "second"]


def test_gemini_does_not_retry_permanent_errors(monkeypatch):
    p = provider(monkeypatch)
    calls = []

    def request(model, system, prompt, schema):
        calls.append(model)
        raise BadRequest("invalid")

    monkeypatch.setattr(p, "_generate_with_model", request)
    with pytest.raises(LLMError, match="semua model Gemini gagal"):
        p.generate("system", "prompt", str)
    assert calls == ["first", "second", "last"]


def test_gemini_busy_model_moves_to_end_until_cooldown_expires(monkeypatch):
    p = provider(monkeypatch)
    p._busy_until["first"] = 120.0
    monkeypatch.setattr("app.scribe.llm.time.time", lambda: 100.0)
    assert p._ordered_models() == ["second", "last", "first"]
    monkeypatch.setattr("app.scribe.llm.time.time", lambda: 121.0)
    assert p._ordered_models() == ["first", "second", "last"]
