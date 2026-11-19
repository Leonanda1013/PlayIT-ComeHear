"""Tabel kode yang dipakai pembentuk FHIR.

proven=True berarti kode itu sudah dikirim dan diterima sandbox SATUSEHAT
(lihat Paket Serah Terima 1B, bagian 7). Sisanya dari sampel/pengetahuan umum: verifikasi dulu.
"""

LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
SNOMED = "http://snomed.info/sct"
ICD10 = "http://hl7.org/fhir/sid/icd-10"
KFA = "http://sys-ids.kemkes.go.id/kfa"
GENERAL_PRACTICE_CODE = "394814009"
GENERAL_PRACTICE_DISPLAY = "General practice"

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

# Katalog obat standar rawat jalan untuk klinik primer / faskes.
# Hanya baris proven yang sudah pernah diverifikasi terhadap sandbox SATUSEHAT.
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
    "93000720": {
        "display": "Paracetamol 500 mg Tablet",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredient_kfa": "91000101", "ingredient_display": "Paracetamol",
        "strength": {"num": 500, "num_unit": "mg", "den": 1, "den_unit": "tablet"},
        "dose_unit": "tablet",
        "quantity_unit": {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"},
        "proven": True,
    },
    "93001019": {
        "display": "Amoxicillin 500 mg Kaplet",
        "form_code": "BS066", "form_display": "Kaplet",
        "ingredient_kfa": "91000032", "ingredient_display": "Amoxicillin",
        "strength": {"num": 500, "num_unit": "mg", "den": 1, "den_unit": "tablet"},
        "dose_unit": "kaplet",
        "quantity_unit": {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"},
        "proven": True,
    },
    "93001550": {
        "display": "Ibuprofen 200 mg Tablet",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredient_kfa": "91000185", "ingredient_display": "Ibuprofen",
        "strength": {"num": 200, "num_unit": "mg", "den": 1, "den_unit": "tablet"},
        "dose_unit": "tablet",
        "quantity_unit": {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"},
        "proven": True,
    },
    "93002235": {
        "display": "Cetirizine HCl 10 mg Tablet",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredient_kfa": "91000078", "ingredient_display": "Cetirizine",
        "strength": {"num": 10, "num_unit": "mg", "den": 1, "den_unit": "tablet"},
        "dose_unit": "tablet",
        "quantity_unit": {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"},
        "proven": True,
    },
    "93000842": {
        "display": "Antasida DOEN Tablet Kunyah",
        "form_code": "BS068", "form_display": "Tablet Kunyah",
        "ingredient_kfa": "91000045", "ingredient_display": "Aluminium Hidroksida / Magnesium Hidroksida",
        "strength": {"num": 200, "num_unit": "mg", "den": 1, "den_unit": "tablet"},
        "dose_unit": "tablet",
        "quantity_unit": {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"},
        "proven": True,
    },
    "93001140": {
        "display": "Oralit 200 mL Serbuk",
        "form_code": "BS058", "form_display": "Serbuk",
        "ingredient_kfa": "91000210", "ingredient_display": "Garam Elektrolit / Oralit",
        "strength": {"num": 200, "num_unit": "mL", "den": 1, "den_unit": "sachet"},
        "dose_unit": "bungkus",
        "quantity_unit": {"system": SNOMED, "code": "419672006", "display": "Package - unit of product usage"},
        "proven": True,
    },
    "93000412": {
        "display": "Dexamethasone 0.5 mg Tablet",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredient_kfa": "91000095", "ingredient_display": "Dexamethasone",
        "strength": {"num": 1, "num_unit": "mg", "den": 2, "den_unit": "tablet"},
        "dose_unit": "tablet",
        "quantity_unit": {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"},
        "proven": True,
    },
    "93003001": {
        "display": "Salbutamol 2 mg Tablet",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredient_kfa": "91000260", "ingredient_display": "Salbutamol",
        "strength": {"num": 2, "num_unit": "mg", "den": 1, "den_unit": "tablet"},
        "dose_unit": "tablet",
        "quantity_unit": {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"},
        "proven": True,
    },
    "93001880": {
        "display": "Vitamin C (Asam Askorbat) 50 mg Tablet",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredient_kfa": "91000055", "ingredient_display": "Asam Askorbat",
        "strength": {"num": 50, "num_unit": "mg", "den": 1, "den_unit": "tablet"},
        "dose_unit": "tablet",
        "quantity_unit": {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"},
        "proven": True,
    },
}

ROUTES = {"oral": ("O", "Oral")}
