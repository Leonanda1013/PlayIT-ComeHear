import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel, ValidationError

import app.scribe.llm as layer
from app.config import Settings
from app.scribe.llm_types import Attempt, LLMError, ProviderResult, TokenUsage


class Answer(BaseModel):
    value: str


def config(names="claude", **kwargs):
    return Settings(_env_file=None, database_url="sqlite://", llm_providers=names, **kwargs)


def adapter(name, behavior, calls):
    class Fake:
        def __init__(self, settings):
            self.name = name

        def generate(self, system, prompt, schema):
            calls.append(name)
            if isinstance(behavior, Exception):
                raise behavior
            return ProviderResult(schema(value=name), f"{name}:test", (
                Attempt(name, "test", 0.1, "ok", behavior),))
    return Fake


def test_only_claude_public_tuple_and_usage_isolation(monkeypatch):
    calls = []
    monkeypatch.setitem(layer.PROVIDERS, "claude", adapter("claude", TokenUsage(10, 3), calls))
    monkeypatch.setitem(layer.PROVIDERS, "gemini", lambda _: pytest.fail("Gemini must stay inactive"))
    first, second = layer.LLM(config()), layer.LLM(config())
    assert first.generate("private system", "private transcript", Answer) == (Answer(value="claude"), "claude:test")
    report = first.usage_report()
    assert report["totals"]["input_tokens"] == 10
    assert report["complete"] is True
    assert second.usage_report()["totals"]["input_tokens"] is None
    report["calls"].clear()
    assert len(first.usage_report()["calls"]) == 1
    assert "private" not in str(first.usage_report())


def test_explicit_fallback_accounts_for_failed_attempt(monkeypatch):
    calls = []
    failed = LLMError("safe", kind="transient", attempts=(
        Attempt("claude", "test", 0.2, "error", error_kind="transient"),))
    monkeypatch.setitem(layer.PROVIDERS, "claude", adapter("claude", failed, calls))
    monkeypatch.setitem(layer.PROVIDERS, "gemini", adapter("gemini", TokenUsage(12, 2), calls))
    llm = layer.LLM(config("claude,gemini"))
    assert llm.generate("s", "p", Answer)[1] == "gemini:test"
    assert calls == ["claude", "gemini"]
    report = llm.usage_report()
    assert report["totals"]["input_tokens"] == 12
    assert report["unknown_usage_attempts"] == 1
    assert report["complete"] is False


def test_fallback_respects_configured_order(monkeypatch):
    calls = []
    for name in ("claude", "gemini"):
        monkeypatch.setitem(layer.PROVIDERS, name, adapter(name, TokenUsage(), calls))
    llm = layer.LLM(config("gemini,claude"))
    assert llm.generate("s", "p", Answer)[1] == "gemini:test"
    assert calls == ["gemini"]


def test_all_explicit_providers_fail_without_silent_success(monkeypatch):
    calls = []
    for name in ("claude", "gemini"):
        monkeypatch.setitem(layer.PROVIDERS, name, adapter(
            name, LLMError("safe", kind="transient"), calls))
    llm = layer.LLM(config("claude,gemini"))
    with pytest.raises(LLMError, match="semua penyedia"):
        llm.generate("s", "p", Answer)
    assert calls == ["claude", "gemini"]
    assert llm.usage_report()["unknown_usage_attempts"] == 2


def test_claude_failure_does_not_use_supplied_mock(monkeypatch):
    calls = []
    monkeypatch.setitem(layer.PROVIDERS, "claude", adapter(
        "claude", LLMError("safe", kind="transient"), calls))
    llm = layer.LLM(config(), mock=lambda *_: pytest.fail("Mock was not configured"))
    with pytest.raises(LLMError) as failed:
        llm.generate("s", "p", Answer)
    assert failed.value.kind == "transient"
    assert llm.usage_report()["unknown_usage_attempts"] == 1


def test_unknown_provider_rejected_before_initialization(monkeypatch):
    monkeypatch.setitem(layer.PROVIDERS, "claude", lambda _: pytest.fail("Invalid list must fail first"))
    with pytest.raises(LLMError) as failed:
        layer.LLM(config("claude,typo"))
    assert failed.value.kind == "configuration"


def test_missing_key_skipped_only_for_explicit_fallback(monkeypatch):
    calls = []
    monkeypatch.setitem(layer.PROVIDERS, "gemini", adapter("gemini", TokenUsage(), calls))
    llm = layer.LLM(config("claude,gemini"))
    assert llm.usage_report()["skipped_providers"] == ["claude"]
    assert llm.generate("s", "p", Answer)[1] == "gemini:test"
    with pytest.raises(LLMError, match="tidak ada penyedia"):
        layer.LLM(config()).generate("s", "p", Answer)


def test_mock_legacy_attributes_and_zero_usage():
    llm = layer.LLM(config("mock"), mock=lambda prompt, schema: schema(value="mock"))
    assert llm.providers == [] and llm.use_mock
    assert llm.generate("s", "p", Answer) == (Answer(value="mock"), "mock")
    assert llm.usage_report()["totals"]["input_tokens"] == 0
    assert llm.usage_report()["complete"]
    with pytest.raises(LLMError, match="akhir"):
        layer.LLM(config("mock,claude"))


def test_openai_contract_can_be_integrated_without_editing_registry(monkeypatch):
    calls = []
    fake = SimpleNamespace(OpenAIProvider=adapter("openai", TokenUsage(1, 2), calls))
    monkeypatch.setattr(layer, "import_module", lambda name: fake)
    llm = layer.LLM(config("openai"))
    assert llm.generate("s", "p", Answer)[1] == "openai:test"


def test_openai_missing_adapter_fails_clearly(monkeypatch):
    def missing(name):
        raise ModuleNotFoundError(name=name)
    monkeypatch.setattr(layer, "import_module", missing)
    with pytest.raises(LLMError, match="B1 Kemal"):
        layer.PROVIDERS["openai"](config("openai"))


def test_settings_defaults_and_retry_bounds(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDERS", raising=False)
    settings = Settings(_env_file=None, database_url="sqlite://")
    assert settings.llm_providers == "claude"
    assert settings.openai_base_url == "https://api.openai.com/v1"
    for kwargs in ({"llm_timeout_s": 0}, {"llm_max_retries": 100}, {"claude_max_tokens": 0}):
        with pytest.raises(ValidationError):
            config(**kwargs)


def test_gemini_records_usage_even_when_json_is_invalid(settings):
    p = object.__new__(layer.GeminiProvider)
    p.models = ["test"]
    p.client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(
        text="invalid JSON private transcript", usage_metadata=SimpleNamespace(
            prompt_token_count=8, candidates_token_count=4, thoughts_token_count=2))))
    with pytest.raises(LLMError) as failed:
        p.generate("s", "p", Answer)
    assert failed.value.kind == "invalid_output"
    assert failed.value.attempts[0].usage.input_tokens == 8
    assert failed.value.attempts[0].usage.thinking_tokens == 2
    assert "private" not in str(failed.value)


def test_pipeline_persists_usage_without_changing_clinical_contract(session_factory, db, visit_with_note, settings):
    from app.models import ScribeSession
    from app.scribe.pipeline import run_session

    session = ScribeSession(visit_id=visit_with_note.id, status="queued")
    db.add(session)
    db.commit()
    run_session(session_factory, session.id, settings, text_transcript=(
        "Dokter: Apa keluhannya?\nPasien: Saya demam sejak kemarin Dok."))
    with session_factory() as check:
        result = check.get(ScribeSession, session.id)
        assert result.status == "done", result.error
        assert result.model_info["llm_usage"]["complete"]
        assert result.model_info["llm_usage"]["totals"]["input_tokens"] == 0
        assert len(result.model_info["llm_usage"]["calls"]) >= 2
        assert "keluhan_utama" in result.extraction


def test_pipeline_failure_preserves_unknown_usage(monkeypatch, session_factory, db, visit_with_note, settings):
    from app.models import ScribeSession
    from app.scribe.pipeline import run_session

    monkeypatch.setitem(layer.PROVIDERS, "claude", adapter(
        "claude", LLMError("safe", kind="transient"), []))
    session = ScribeSession(visit_id=visit_with_note.id, status="queued")
    db.add(session)
    db.commit()
    run_session(session_factory, session.id, settings.model_copy(update={"llm_providers": "claude"}),
                text_transcript="Pasien: Saya demam sejak kemarin Dok.")
    with session_factory() as check:
        result = check.get(ScribeSession, session.id)
        assert result.status == "failed"
        usage = result.model_info["llm_usage"]
        assert usage["totals"]["input_tokens"] is None
        assert usage["unknown_usage_attempts"] == 1
        assert usage["complete"] is False


@pytest.mark.parametrize("outcome", ["empty", "failed", "ok"])
def test_background_usage_is_append_only_per_job(monkeypatch, session_factory, db, visit_with_note, settings, outcome):
    from sqlalchemy import select
    from app.models import AuditLog, ScribeSession
    import app.scribe.pipeline as pipeline
    from app.scribe.schemas import IcdKeywords

    session = ScribeSession(visit_id=visit_with_note.id, status="done", model_info={"llm_usage": {"sentinel": True}})
    db.add(session)
    db.commit()

    def suggest(subj, rows, llm, objective=None):
        llm.generate("s", "demam", IcdKeywords)
        if outcome == "failed":
            raise LLMError("safe failure", kind="transient")
        return {"utama": [{"code": "R50.9"}] if outcome == "ok" else []}, {}

    monkeypatch.setattr(pipeline, "suggest_icd", suggest)
    for _ in range(2):
        pipeline.run_suggest_icd(session_factory, visit_with_note.id, settings, subjective={"keluhan_utama": "demam"})
    with session_factory() as check:
        rows = check.scalars(select(AuditLog).where(AuditLog.action == "llm_usage_icd")).all()
        reports = [json.loads(row.summary) for row in rows]
        assert len(reports) == 2 and reports[0]["job_id"] != reports[1]["job_id"]
        assert all(r["usage"]["totals"]["input_tokens"] == 0 for r in reports)
        assert check.get(ScribeSession, session.id).model_info["llm_usage"] == {"sentinel": True}
