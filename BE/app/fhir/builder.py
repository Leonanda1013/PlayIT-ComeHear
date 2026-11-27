"""Penyusun Bundle transaction SATUSEHAT dari snapshot catatan yang sudah disetujui dokter.

Bentuk resource mengikuti mini-bundle yang terbukti 201 di sandbox
(mini_bundle_poli_anak.json): Encounter finished + statusHistory + diagnosis(rank),
Condition (ICD-10), Observation tanda vital, ClinicalImpression, MedicationRequest
dengan Medication di-contained. Rujukan antar-resource memakai urn:uuid dan satu arah
(ClinicalImpression -> Condition; Condition tidak menunjuk balik) agar tidak melingkar.
"""
import re
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from app.fhir.codes import DRUGS, ICD10, KFA, LOINC, ROUTES, SNOMED, UCUM, VITALS, match_allergen


def fhir_time(value: str | datetime) -> str:
    dt = datetime.fromisoformat(value) if isinstance(value, str) else value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _urn(new_uuid: Callable[[], str]) -> str:
    return f"urn:uuid:{new_uuid()}"


def _entry(full_url: str, resource: dict) -> dict:
    return {"fullUrl": full_url, "resource": resource,
            "request": {"method": "POST", "url": resource["resourceType"]}}


def build_bundle(snap: dict, org_id: str, new_uuid: Callable[[], str] | None = None) -> dict:
    """snap: snapshot beku (lihat app.services.notes.make_snapshot)."""
    new_uuid = new_uuid or (lambda: str(uuid.uuid4()))
    v, pat, prac, loc = snap["visit"], snap["patient"], snap["practitioner"], snap["location"]
    patient_ref = {"reference": f"Patient/{pat['ihs_number']}"}
    prac_ref = f"Practitioner/{prac['satusehat_id']}"

    arrived = datetime.fromisoformat(v["arrived_at"])
    started = datetime.fromisoformat(v["started_at"] or v["arrived_at"])
    ended = datetime.fromisoformat(v["ended_at"] or snap["approved_at"])
    finished = max(datetime.fromisoformat(snap["approved_at"]), ended)

    enc_url = _urn(new_uuid)
    enc_ref = {"reference": enc_url}
    entries: list[dict] = []

    # --- Condition: diagnosis yang dikonfirmasi dokter ---
    cond_urls = []
    for dx in sorted(snap["diagnoses"], key=lambda d: d["rank"]):
        url = _urn(new_uuid)
        cond_urls.append((url, dx))
        coding = [{"system": ICD10, "code": dx["code"], "display": dx["display"]}]
        if dx.get("snomed_code"):
            coding.append({"system": SNOMED, "code": dx["snomed_code"], "display": dx.get("snomed_display", "")})
        entries.append(_entry(url, {
            "resourceType": "Condition",
            "clinicalStatus": {"coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                "code": "active", "display": "Active"}]},
            "category": [{"coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/condition-category",
                "code": "encounter-diagnosis", "display": "Encounter Diagnosis"}]}],
            "code": {"coding": coding,
                     "text": f"Diagnosis {'primer' if dx['rank'] == 1 else 'sekunder'} {dx['display']}"},
            "subject": patient_ref,
            "encounter": enc_ref,
            "onsetDateTime": fhir_time(ended),
            "recordedDate": fhir_time(ended),
        }))

    # --- Observation: tanda vital yang diisi perawat/dokter ---
    obs_urls = []
    measured = fhir_time(started)
    for key, value in snap["vitals"].items():
        if value in (None, ""):
            continue
        loinc, display, unit, _, _ = VITALS[key]
        url = _urn(new_uuid)
        obs_urls.append(url)
        entries.append(_entry(url, {
            "resourceType": "Observation",
            "status": "final",
            "category": [{"coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                "code": "vital-signs", "display": "Vital Signs"}]}],
            "code": {"coding": [{"system": LOINC, "code": loinc, "display": display}]},
            "subject": patient_ref,
            "encounter": enc_ref,
            "effectiveDateTime": measured,
            "issued": measured,
            "performer": [{"reference": prac_ref}],
            "valueQuantity": {"value": float(value), "unit": unit, "system": UCUM, "code": unit},
        }))

    # --- AllergyIntolerance: hanya alergen yang dilaporkan ADA oleh AI, juga tertulis di riwayat alergi
    # yang disetujui dokter, dan dikenal tabel SNOMED. Sisanya tetap sebagai teks catatan.
    for n, allergy in enumerate(allergies_to_send(snap), start=1):
        entries.append(_entry(_urn(new_uuid), {
            "resourceType": "AllergyIntolerance",
            "identifier": [{"system": f"http://sys-ids.kemkes.go.id/allergy/{org_id}", "use": "official",
                            "value": f"{v['code']}-ALG-{n}"}],
            "clinicalStatus": {"coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
                "code": "active", "display": "Active"}]},
            "verificationStatus": {"coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                "code": allergy["verification"], "display": allergy["verification"].capitalize()}]},
            "category": [allergy["category"]],
            "code": {"coding": [{"system": SNOMED, "code": allergy["code"], "display": allergy["display"]}],
                     "text": allergy["text"]},
            "patient": patient_ref,
            "encounter": enc_ref,
            "recordedDate": fhir_time(ended),
            "recorder": {"reference": prac_ref},
            **({"note": [{"text": f"Reaksi: {allergy['reaction']}"}]} if allergy["reaction"] else {}),
        }))

    # --- ClinicalImpression: anamnesis (S) + rasional klinis dokter ---
    summary = (snap.get("assessment") or "").strip()
    impression = {
        "resourceType": "ClinicalImpression",
        "status": "completed",
        "code": {"coding": [{"system": "http://terminology.kemkes.go.id",
                             "code": "TK000056", "display": "Rasional Klinis"}]},
        "subject": patient_ref,
        "encounter": enc_ref,
        "effectiveDateTime": fhir_time(ended),
        "date": fhir_time(ended),
        "assessor": {"reference": prac_ref},
        "description": (snap.get("subjective_summary") or "").strip() or None,
        "summary": summary or None,
    }
    if obs_urls:
        impression["investigation"] = [{
            "code": {"coding": [{"system": SNOMED, "code": "271336007", "display": "Examination / signs"}]},
            "item": [{"reference": u} for u in obs_urls]}]
    if cond_urls:
        impression["problem"] = [{"reference": u} for u, _ in cond_urls]
    entries.append(_entry(_urn(new_uuid), {k: v for k, v in impression.items() if v is not None}))

    # --- MedicationRequest: resep dokter (Medication di-contained) ---
    primary_cond = cond_urls[0][0] if cond_urls else None
    for n, rx in enumerate(snap.get("prescriptions", []), start=1):
        entries.append(_entry(_urn(new_uuid), _medication_request(
            rx, n, v["code"], org_id, patient_ref, enc_ref, prac_ref, primary_cond, fhir_time(ended))))

    # --- Encounter (entri pertama) ---
    encounter = {
        "resourceType": "Encounter",
        "identifier": [{"system": f"http://sys-ids.kemkes.go.id/encounter/{org_id}", "value": v["code"]}],
        "status": "finished",
        "statusHistory": [
            {"status": "arrived", "period": {"start": fhir_time(arrived), "end": fhir_time(started)}},
            {"status": "in-progress", "period": {"start": fhir_time(started), "end": fhir_time(ended)}},
            {"status": "finished", "period": {"start": fhir_time(ended), "end": fhir_time(finished)}},
        ],
        "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
                  "code": "AMB", "display": "ambulatory"},
        "serviceType": {"coding": [{"system": SNOMED, "code": loc["service_type_code"],
                                    "display": loc["service_type_display"]}]},
        "subject": patient_ref,
        "participant": [{
            "type": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                  "code": "ATND", "display": "attender"}]}],
            "individual": {"reference": prac_ref}}],
        "period": {"start": fhir_time(arrived), "end": fhir_time(finished)},
        "diagnosis": [{
            "condition": {"reference": url},
            "use": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/diagnosis-role",
                                "code": "DD", "display": "Discharge diagnosis"}]},
            "rank": dx["rank"]} for url, dx in cond_urls],
        "hospitalization": {"dischargeDisposition": {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/discharge-disposition",
                        "code": "home", "display": "Home"}], "text": "Pulang"}},
        "location": [{"location": {"reference": f"Location/{loc['satusehat_id']}", "display": loc["name"]},
                      "period": {"start": fhir_time(arrived), "end": fhir_time(finished)}}],
        "serviceProvider": {"reference": f"Organization/{org_id}"},
    }
    entries.insert(0, _entry(enc_url, encounter))
    return {"resourceType": "Bundle", "type": "transaction", "entry": entries}


def _medication_request(rx: dict, n: int, visit_code: str, org_id: str, patient_ref: dict,
                        enc_ref: dict, prac_ref: str, reason_url: str | None, authored: str) -> dict:
    drug = DRUGS[rx["kfa_code"]]
    route_code, route_display = ROUTES[rx.get("route", "oral")]
    rx_no = f"{visit_code}-RX"
    authored_dt = datetime.fromisoformat(authored)
    duration = int(rx.get("duration_days") or 1)
    timing = {"frequency": int(rx.get("frequency") or 1), "period": float(rx["period"]),
              "periodUnit": rx.get("period_unit", "h")}
    if rx.get("period_max"):
        timing["periodMax"] = float(rx["period_max"])
    dosage = {
        "sequence": 1,
        "patientInstruction": rx.get("patient_instruction", ""),
        "timing": {"repeat": timing},
        "route": {"coding": [{"system": "http://www.whocc.no/atc", "code": route_code, "display": route_display}]},
        "doseAndRate": [{
            "type": {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/dose-rate-type",
                                 "code": "ordered", "display": "Ordered"}]},
            "doseQuantity": {"value": float(rx["dose_value"]), "unit": drug["dose_unit"],
                             "system": drug.get("dose_system", UCUM), "code": drug["dose_unit"]}}],
    }
    if rx.get("as_needed_text"):
        dosage["asNeededCodeableConcept"] = {
            "coding": [{"system": SNOMED, "code": "386661006", "display": "Fever"}],
            "text": rx["as_needed_text"]} if rx.get("as_needed_fever") else {"text": rx["as_needed_text"]}
    resource = {
        "resourceType": "MedicationRequest",
        "identifier": [
            {"use": "official", "system": f"http://sys-ids.kemkes.go.id/prescription/{org_id}", "value": rx_no},
            {"use": "official", "system": f"http://sys-ids.kemkes.go.id/prescription-item/{org_id}",
             "value": f"{rx_no}-{n}"}],
        "status": "completed",
        "intent": "order",
        "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/medicationrequest-category",
                                  "code": "outpatient", "display": "Outpatient"}]}],
        "priority": "routine",
        "contained": [{
            "resourceType": "Medication", "id": "med1",
            "meta": {"profile": ["https://fhir.kemkes.go.id/r4/StructureDefinition/Medication"]},
            "extension": [{"url": "https://fhir.kemkes.go.id/r4/StructureDefinition/MedicationType",
                           "valueCodeableConcept": {"coding": [{
                               "system": "http://terminology.kemkes.go.id/CodeSystem/medication-type",
                               "code": "NC", "display": "Non-compound"}]}}],
            "identifier": [{"use": "official", "system": f"http://sys-ids.kemkes.go.id/medication/{org_id}",
                            "value": f"{rx_no}-MED-{n}"}],
            "code": {"coding": [{"system": KFA, "code": rx["kfa_code"], "display": drug["display"]}]},
            "status": "active",
            "manufacturer": {"reference": f"Organization/{org_id}"},
            "form": {"coding": [{"system": "http://terminology.kemkes.go.id/CodeSystem/medication-form",
                                 "code": drug["form_code"], "display": drug["form_display"]}]},
            # Obat kombinasi (mis. Antasida) mengirim setiap zat aktif sesuai KFA.
            "ingredient": [{
                "itemCodeableConcept": {"coding": [{"system": KFA, "code": ing["kfa"], "display": ing["display"]}]},
                "isActive": True,
                "strength": {"numerator": {"value": ing["num"], "system": UCUM, "code": ing["num_unit"]},
                             "denominator": {"value": ing["den"], "system": ing.get("den_system", UCUM),
                                             "code": ing["den_unit"]}}}
                for ing in drug["ingredients"]],
        }],
        "medicationReference": {"reference": "#med1", "display": drug["display"]},
        "subject": patient_ref,
        "encounter": enc_ref,
        "authoredOn": authored,
        "requester": {"reference": prac_ref},
        "dosageInstruction": [dosage],
        "dispenseRequest": {
            "dispenseInterval": {"value": 1, "unit": "days", "system": UCUM, "code": "d"},
            "validityPeriod": {"start": authored,
                               "end": fhir_time(authored_dt + timedelta(days=duration))},
            "numberOfRepeatsAllowed": 0,
            "quantity": {"value": rx.get("quantity", 1), **{
                "unit": drug["quantity_unit"]["display"], "system": drug["quantity_unit"]["system"],
                "code": drug["quantity_unit"]["code"]}},
            "expectedSupplyDuration": {"value": duration, "unit": "days", "system": UCUM, "code": "d"},
            "performer": {"reference": f"Organization/{org_id}"},
        },
    }
    if reason_url:
        resource["reasonReference"] = [{"reference": reason_url}]
    return resource


NEGASI_ALERGI = re.compile(r"\b(tidak|tak|nggak|ngga|gak|enggak|disangkal|negatif|bukan|tanpa|belum pernah)\b")
RAGU_ALERGI = re.compile(r"\b(diduga|mungkin|curiga|kayaknya|sepertinya|kemungkinan)\b|\?")


def allergies_to_send(snap: dict) -> list[dict]:
    """Alergen dari teks Riwayat alergi yang disetujui dokter (sumber utama, juga untuk pencatatan manual).

    Teks dipecah per kalimat/koma; bagian yang mengandung penyangkalan dilewati. Daftar alergi AI
    hanya melengkapi reaksi dan kepastian, tidak pernah menambah alergen yang tidak ditulis dokter.
    """
    doctor_text = str((snap.get("subjective") or {}).get("riwayat_alergi") or "")
    ai = {}
    for a in snap.get("allergies") or []:
        hit = match_allergen(str(a.get("zat") or ""))
        if hit:
            ai.setdefault(hit["code"], a)
    out, seen = [], set()
    for part in re.split(r"[,;.\n/&]|\bdan\b|\batau\b", doctor_text, flags=re.IGNORECASE):
        seg = part.strip()
        low = seg.lower()
        if not seg or NEGASI_ALERGI.search(low):
            continue
        hit = match_allergen(low)
        # Alergen di luar tabel tidak dikirim: sandbox mewajibkan category dan code.coding
        # (teks saja ditolak, RuleNumber 10075/10078). Teksnya tetap ada di anamnesis.
        if hit is None or hit["code"] in seen:
            continue
        seen.add(hit["code"])
        src = ai.get(hit["code"]) or {}
        if src.get("kepastian") in ("confirmed", "unconfirmed") and not RAGU_ALERGI.search(low):
            verification = src["kepastian"]
        else:
            verification = "unconfirmed" if RAGU_ALERGI.search(low) else "confirmed"
        paren = re.search(r"\(([^)]+)\)", seg)
        reaction = str(src.get("reaksi") or (paren.group(1) if paren else "")).strip()
        out.append({**hit, "text": hit.get("name") or re.sub(r"\s*\([^)]*\)", "", seg).strip(),
                    "verification": verification, "reaction": reaction})
    return out
