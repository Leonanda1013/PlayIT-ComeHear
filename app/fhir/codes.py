"""Tabel kode yang dipakai pembentuk FHIR.

proven=True berarti kode itu sudah dikirim dan diterima sandbox SATUSEHAT
(lihat Paket Serah Terima 1B, bagian 7). Sisanya dari sampel/pengetahuan umum: verifikasi dulu.
"""

LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
SNOMED = "http://snomed.info/sct"
ICD10 = "http://hl7.org/fhir/sid/icd-10"
KFA = "http://sys-ids.kemkes.go.id/kfa"

VITALS = {
    # key: (LOINC, display, UCUM unit, label Indonesia, proven)
    "body_temperature": ("8310-5", "Body temperature", "Cel", "Suhu (°C)", True),
    "body_weight": ("29463-7", "Body weight", "kg", "Berat badan (kg)", True),
    "body_height": ("8302-2", "Body height", "cm", "Tinggi badan (cm)", True),
    "systolic": ("8480-6", "Systolic blood pressure", "mm[Hg]", "Sistolik (mmHg)", True),
    "diastolic": ("8462-4", "Diastolic blood pressure", "mm[Hg]", "Diastolik (mmHg)", True),
    "heart_rate": ("8867-4", "Heart rate", "{beats}/min", "Nadi (x/menit)", True),
    "respiratory_rate": ("9279-1", "Respiratory rate", "/min", "Laju napas (x/menit)", True),
    "oxygen_saturation": ("59408-5", "Oxygen saturation in Arterial blood by Pulse oximetry", "%", "SpO2 (%)", True),
}

# Katalog obat minimal untuk MVP poli anak. Hanya baris proven yang sudah diterima sandbox.
DRUGS = {
    "93001926": {
        "display": "Paracetamol 120 mg/5 mL Sirup (CASETAMOL)",
        "form_code": "BS055", "form_display": "Sirup",
        "ingredient_kfa": "91000101", "ingredient_display": "Paracetamol",
        "strength": {"num": 120, "num_unit": "mg", "den": 5, "den_unit": "mL"},
        "dose_unit": "mL",
        "quantity_unit": {"system": SNOMED, "code": "419672006", "display": "Bottle - unit of product usage"},
        "proven": True,
    },
}

ROUTES = {"oral": ("O", "Oral")}
