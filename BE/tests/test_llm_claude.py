import json
import sys
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from app.config import Settings
from app.scribe.llm_claude import ClaudeProvider
from app.scribe.llm_types import LLMError


class Answer(BaseModel):
    value: str


def settings(**kwargs):
    return Settings(_env_file=None, database_url="sqlite://", anthropic_api_key="test-key", **kwargs)


def response(parsed=None, stop="end_turn", usage=True):
    return SimpleNamespace(parsed_output=parsed, stop_reason=stop, usage=SimpleNamespace(
        input_tokens=20, output_tokens=5, cache_read_input_tokens=4, cache_creation_input_tokens=2,
    ) if usage else None)


def fake_provider(monkeypatch, events, **kwargs):
    calls, init = [], []

    def parse(**params):
        calls.append(params)
        event = events.pop(0)
        if isinstance(event, Exception):
            raise event
        return event

    def client(**params):
        init.append(params)
        return SimpleNamespace(messages=SimpleNamespace(parse=parse))

    monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=client))
    monkeypatch.setattr("app.scribe.llm_claude.time.sleep", lambda _: None)
    return ClaudeProvider(settings(**kwargs)), calls, init


def test_structured_output_parameters_and_usage(monkeypatch):
    p, calls, init = fake_provider(monkeypatch, [response(Answer(value="ok"))])
    result = p.generate("system unchanged", "prompt unchanged", Answer)
    assert result.data == Answer(value="ok")
    assert result.model == "claude:claude-sonnet-5-5"
    assert init[0]["max_retries"] == 0
    assert init[0]["timeout"] == 45.0
    assert calls[0]["output_format"] is Answer
    assert calls[0]["system"] == "system unchanged"
    assert calls[0]["messages"] == [{"role": "user", "content": "prompt unchanged"}]
    assert not {"temperature", "thinking", "output_config"} & calls[0].keys()
    assert result.attempts[0].usage.cache_read_tokens == 4
    assert result.attempts[0].usage.cache_creation_tokens == 2


@pytest.mark.parametrize("stop,parsed", [
    ("refusal", None), ("max_tokens", Answer(value="partial")),
    ("end_turn", None), ("end_turn", {"unexpected": "private text"}),
])
def test_invalid_or_incomplete_output_is_not_retried(monkeypatch, stop, parsed):
    p, calls, _ = fake_provider(monkeypatch, [response(parsed, stop)])
    with pytest.raises(LLMError) as failed:
        p.generate("s", "p", Answer)
    assert failed.value.kind == "invalid_output"
    assert len(calls) == 1
    assert failed.value.attempts[0].usage.output_tokens == 5
    assert "private" not in str(failed.value)


@pytest.mark.parametrize("status,kind,expected", [
    (429, "transient", 2), (503, "transient", 2), (401, "configuration", 1),
    (403, "configuration", 1), (400, "permanent", 1),
])
def test_retry_bound_and_safe_errors(monkeypatch, status, kind, expected):
    class ApiFailure(Exception):
        status_code = status
    p, calls, _ = fake_provider(monkeypatch, [ApiFailure("SECRET private transcript")] * expected)
    with pytest.raises(LLMError) as failed:
        p.generate("s", "p", Answer)
    assert failed.value.kind == kind
    assert len(calls) == expected
    assert len(failed.value.attempts) == expected
    assert all(a.usage.input_tokens is None for a in failed.value.attempts)
    assert "SECRET" not in str(failed.value)


def test_retry_success_and_unknown_usage(monkeypatch):
    p, calls, _ = fake_provider(monkeypatch, [TimeoutError(), response(Answer(value="ok"), usage=False)])
    result = p.generate("s", "p", Answer)
    assert len(calls) == 2
    assert [a.status for a in result.attempts] == ["error", "ok"]
    assert result.attempts[-1].usage.input_tokens is None


def test_zero_retries(monkeypatch):
    p, calls, _ = fake_provider(monkeypatch, [TimeoutError()], llm_max_retries=0)
    with pytest.raises(LLMError):
        p.generate("s", "p", Answer)
    assert len(calls) == 1


def test_real_sdk_serializes_pydantic_schema_without_network(monkeypatch):
    # Verifikasi kontrak SDK yang terpasang, bukan hanya fake method dengan nama sama.
    anthropic = pytest.importorskip("anthropic")
    import httpx2

    requests = []

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx2.Response(200, json={
            "id": "msg_test", "type": "message", "role": "assistant",
            "model": "claude-sonnet-5-5", "stop_reason": "end_turn", "stop_sequence": None,
            "content": [{"type": "text", "text": '{"value":"ok"}'}],
            "usage": {"input_tokens": 3, "output_tokens": 2},
        })

    with httpx2.Client(transport=httpx2.MockTransport(handle)) as http:
        client = anthropic.Anthropic(api_key="test-key", max_retries=0, http_client=http)
        monkeypatch.setattr(anthropic, "Anthropic", lambda **kwargs: client)
        result = ClaudeProvider(settings()).generate("s", "p", Answer)
    assert result.data.value == "ok"
    assert requests[0]["output_config"]["format"]["type"] == "json_schema"
    assert result.attempts[0].usage.input_tokens == 3
