"""Klien SATUSEHAT (hanya dipanggil dari backend; rahasia tidak pernah sampai ke browser)."""
import threading
import time
import uuid
from dataclasses import dataclass, field

import httpx

from app.config import Settings


class TransientError(Exception):
    """Timeout, gangguan jaringan, 5xx: aman diulang."""


@dataclass
class SendResult:
    status_code: int
    body: dict


def parse_entry_ids(response_body: dict) -> list[tuple[str | None, str | None]]:
    """Respons bundle hanya memuat resourceType dan resourceID sesuai urutan kirim."""
    out = []
    for e in response_body.get("entry", []):
        r = e.get("response", {})
        rtype, rid = r.get("resourceType"), r.get("resourceID")
        if not rid and r.get("location"):
            parts = r["location"].split("/")
            rtype, rid = rtype or parts[0], parts[1] if len(parts) > 1 else None
        out.append((rtype, rid))
    return out


def outcome_codes(body: dict) -> tuple[set[str], str]:
    """Ambil nomor aturan dan teks dari OperationOutcome (atau entri bundle yang gagal)."""
    codes, texts = set(), []
    issues = list(body.get("issue", []))
    for e in body.get("entry", []):
        issues += e.get("response", {}).get("outcome", {}).get("issue", [])
    for issue in issues:
        details = issue.get("details", {})
        for c in details.get("coding", []):
            if c.get("code"):
                codes.add(str(c["code"]))
        if issue.get("code"):
            codes.add(str(issue["code"]))
        text = details.get("text") or issue.get("diagnostics") or ""
        if text:
            texts.append(text + (f" [{', '.join(issue['expression'])}]" if issue.get("expression") else ""))
    return codes, " | ".join(texts)[:2000]


class SatusehatClient:
    def __init__(self, settings: Settings):
        self.s = settings
        self._token: str | None = None
        self._token_exp = 0.0
        self._lock = threading.Lock()
        self.http = httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))

    # --- token: diminta sekali, dipakai ulang sampai hampir kedaluwarsa ---
    def _get_token(self, force: bool = False) -> str:
        with self._lock:
            if not force and self._token and time.time() < self._token_exp - 60:
                return self._token
            try:
                r = self.http.post(f"{self.s.satusehat_auth_url}/accesstoken",
                                   params={"grant_type": "client_credentials"},
                                   data={"client_id": self.s.satusehat_client_id,
                                         "client_secret": self.s.satusehat_client_secret})
            except httpx.TransportError as e:
                raise TransientError(f"token: {e}") from e
            if r.status_code >= 500:
                raise TransientError(f"token: HTTP {r.status_code}")
            r.raise_for_status()
            body = r.json()
            self._token = body["access_token"]
            self._token_exp = time.time() + int(body.get("expires_in", 3600))
            return self._token

    def _request(self, method: str, path: str, **kw) -> httpx.Response:
        for attempt in range(2):
            headers = {"Authorization": f"Bearer {self._get_token(force=attempt > 0)}"}
            try:
                r = self.http.request(method, f"{self.s.satusehat_base_url}{path}", headers=headers, **kw)
            except httpx.TransportError as e:
                raise TransientError(str(e)) from e
            if r.status_code == 401 and attempt == 0:
                continue  # token kedaluwarsa: ambil baru sekali
            if r.status_code >= 500 or r.status_code == 429:
                raise TransientError(f"HTTP {r.status_code}")
            return r
        raise TransientError("401 setelah token diperbarui")

    def post_bundle(self, bundle: dict) -> SendResult:
        r = self._request("POST", "", json=bundle)
        return SendResult(r.status_code, r.json() if r.content else {})

    def find_encounter(self, system: str, value: str) -> str | None:
        r = self._request("GET", "/Encounter", params={"identifier": f"{system}|{value}"})
        entries = r.json().get("entry", []) if r.status_code == 200 else []
        return entries[0]["resource"]["id"] if entries else None

    def find_patient_by_nik(self, nik: str) -> str | None:
        """Satu NIK bisa memberi >1 pasien: pilih yang punya nomor IHS dan active=true."""
        r = self._request("GET", "/Patient", params={"identifier": f"https://fhir.kemkes.go.id/id/nik|{nik}"})
        for e in r.json().get("entry", []) if r.status_code == 200 else []:
            res = e["resource"]
            has_ihs = any("ihs-number" in (i.get("system") or "") for i in res.get("identifier", []))
            if res.get("active", True) and has_ihs:
                return res["id"]
        return None


@dataclass
class MockSatusehat:
    """Tiruan sandbox untuk uji tanpa internet. Meniru: atomik, duplikat 20002, rujukan."""
    encounters: dict = field(default_factory=dict)  # identifier -> encounter id
    fail_queue: list = field(default_factory=list)   # "timeout" | "500" | "lost_response"
    calls: int = 0

    def post_bundle(self, bundle: dict) -> SendResult:
        self.calls += 1
        mode = self.fail_queue.pop(0) if self.fail_queue else None
        if mode in ("timeout", "500"):
            raise TransientError(mode)
        urls = {e["fullUrl"] for e in bundle["entry"]}
        enc = bundle["entry"][0]["resource"]
        ident = enc["identifier"][0]["value"]
        if ident in self.encounters:
            return SendResult(400, {"resourceType": "OperationOutcome", "issue": [{
                "severity": "error", "code": "duplicate",
                "details": {"coding": [{"code": "20002"}], "text": "Found duplicate: Encounter"}}]})
        for e in bundle["entry"]:
            for ref in _refs(e["resource"]):
                if ref.startswith("urn:uuid:") and ref not in urls:
                    return SendResult(400, {"resourceType": "OperationOutcome", "issue": [{
                        "severity": "error", "code": "not-found",
                        "details": {"text": f"reference_not_found: {ref}"}}]})
        ids = [str(uuid.uuid4()) for _ in bundle["entry"]]
        self.encounters[ident] = ids[0]
        body = {"resourceType": "Bundle", "type": "transaction-response", "entry": [
            {"response": {"status": "201 Created", "resourceType": e["resource"]["resourceType"],
                          "resourceID": rid}} for e, rid in zip(bundle["entry"], ids)]}
        if mode == "lost_response":
            raise TransientError("timeout setelah server menyimpan data")
        return SendResult(200, body)

    def find_encounter(self, system: str, value: str) -> str | None:
        return self.encounters.get(value)

    def find_patient_by_nik(self, nik: str) -> str | None:
        return None


def _refs(node):
    if isinstance(node, dict):
        if isinstance(node.get("reference"), str):
            yield node["reference"]
        for v in node.values():
            yield from _refs(v)
    elif isinstance(node, list):
        for v in node:
            yield from _refs(v)


_client = None


def get_client(settings: Settings):
    global _client
    if _client is None:
        _client = MockSatusehat() if settings.satusehat_mode == "mock" else SatusehatClient(settings)
    return _client
