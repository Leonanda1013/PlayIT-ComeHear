"""Tabel kode yang dipakai pembentuk FHIR.

proven=True berarti kode itu sudah dikirim dan diterima sandbox SATUSEHAT
(lihat Paket Serah Terima 1B, bagian 7). Sisanya dari sampel/pengetahuan umum: verifikasi dulu.
"""
import re

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
# Kode produk, bentuk sediaan, zat aktif, dan kekuatan dicocokkan dengan API KFA sandbox
# (kfa-v2/products?identifier=kfa) pada 27 Nov 2026. proven=True berarti obat itu sudah pernah
# dikirim dalam MedicationRequest dan diterima sandbox SATUSEHAT (201).
# Oralit (KFA 93011966) belum dimasukkan: kode SNOMED satuan sachet belum terverifikasi.
TABLET_UNIT = {"system": SNOMED, "code": "732936001", "display": "Tablet - unit of product usage"}
# Satuan tablet bukan kode UCUM: sandbox menolak '{tbl}'/'tablet' di system UCUM (RuleNumber 10028/10349).
# Pakai bentuk sediaan HL7 untuk penyebut kekuatan dan dosis tablet; sirup tetap UCUM 'mL'.
DRUG_FORM = "http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm"


def _ing(kfa: str, display: str, num: float, num_unit: str, den: float = 1, den_unit: str = "TAB",
         den_system: str = DRUG_FORM) -> dict:
    return {"kfa": kfa, "display": display, "num": num, "num_unit": num_unit,
            "den": den, "den_unit": den_unit, "den_system": den_system}


DRUGS = {
    "93001926": {
        "display": "Paracetamol 120 mg/5 mL Sirup (CASETAMOL)",
        "form_code": "BS055", "form_display": "Sirup",
        "ingredients": [_ing("91000101", "Paracetamol", 120, "mg", 5, "mL", UCUM)],
        "dose_unit": "mL", "dose_system": UCUM,
        "quantity_unit": {"system": SNOMED, "code": "419672006", "display": "Bottle - unit of product usage"},
        "proven": True,
    },
    "93020442": {
        "display": "Paracetamol 500 mg Tablet (PHAPROS)",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredients": [_ing("91000101", "Paracetamol", 500, "mg")],
        "dose_unit": "TAB", "dose_system": DRUG_FORM, "quantity_unit": TABLET_UNIT, "proven": False,
    },
    "93002402": {
        "display": "Amoxicillin Trihydrate 500 mg Tablet (HOLI PHARMA)",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredients": [_ing("91000237", "Amoxicillin", 500, "mg")],
        "dose_unit": "TAB", "dose_system": DRUG_FORM, "quantity_unit": TABLET_UNIT, "proven": True,
    },
    "93027377": {
        "display": "Ibuprofen 200 mg Tablet (TRIFA RAYA LABORATORIES)",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredients": [_ing("91000107", "Ibuprofen", 200, "mg")],
        "dose_unit": "TAB", "dose_system": DRUG_FORM, "quantity_unit": TABLET_UNIT, "proven": False,
    },
    "93023925": {
        "display": "Cetirizine Hydrochloride 10 mg Tablet (YEKATRIA FARMA)",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredients": [_ing("91001105", "Cetirizine Hydrochloride", 10, "mg")],
        "dose_unit": "TAB", "dose_system": DRUG_FORM, "quantity_unit": TABLET_UNIT, "proven": True,
    },
    "93006056": {
        "display": "Aluminium Hydroxide 200 mg / Magnesium Hydroxide 200 mg Tablet Kunyah (ANTASIDA DOEN)",
        "form_code": "BS069", "form_display": "Tablet Kunyah",
        "ingredients": [_ing("91000607", "Aluminum Hydroxide", 200, "mg", 1, "CHEWTAB"),
                        _ing("91000716", "Magnesium Hydroxide", 200, "mg", 1, "CHEWTAB")],
        "dose_unit": "CHEWTAB", "dose_system": DRUG_FORM, "quantity_unit": TABLET_UNIT, "proven": True,
    },
    "93010095": {
        "display": "Dexamethasone 0,5 mg Tablet (KIMIA FARMA)",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredients": [_ing("91000292", "Dexamethasone", 0.5, "mg")],
        "dose_unit": "TAB", "dose_system": DRUG_FORM, "quantity_unit": TABLET_UNIT, "proven": False,
    },
    "93020736": {
        "display": "Salbutamol Sulfate 2 mg Tablet (PHAPROS)",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredients": [_ing("91000326", "Salbutamol", 2, "mg")],
        "dose_unit": "TAB", "dose_system": DRUG_FORM, "quantity_unit": TABLET_UNIT, "proven": False,
    },
    "93015405": {
        "display": "Ascorbic Acid (Vitamin C) 50 mg Tablet (VITAMIN C 50)",
        "form_code": "BS066", "form_display": "Tablet",
        "ingredients": [_ing("91000133", "Ascorbic Acid", 50, "mg")],
        "dose_unit": "TAB", "dose_system": DRUG_FORM, "quantity_unit": TABLET_UNIT, "proven": False,
    },
}

ROUTES = {"oral": ("O", "Oral")}

# Alergen umum poli umum -> SNOMED CT (substance). Ke-58 kode dicek ke tx.fhir.org pada 27 Nov 2026:
# $lookup (ada, aktif, nama resmi) dan $subsumes terhadap 105590001 |Substance|, lalu semuanya dikirim
# ke sandbox SATUSEHAT dalam kunjungan uji 37 (58 AllergyIntolerance, semua 201 Created).
# Urutan penting: kata kunci spesifik (kepiting, susu kedelai, kacang mete) diperiksa sebelum yang umum.
# (kata kunci Indonesia/Inggris, kategori FHIR, kode SNOMED, display SNOMED)
ALLERGENS = [
    # --- makanan ---
    (("udang", "prawn", "shrimp"), "food", "227151004", "Prawns"),
    (("kepiting", "rajungan", "crab"), "food", "736159005", "Crab"),
    (("cumi", "sotong", "squid"), "food", "735006003", "Squid"),
    (("kerang", "lobster", "shellfish"), "food", "735029006", "Shellfish"),
    (("seafood", "makanan laut", "hasil laut"), "food", "44027008", "Seafood"),
    (("ikan", "fish"), "food", "735971005", "Fish"),
    (("telur", "egg"), "food", "102263004", "Eggs (edible)"),
    (("kedelai", "soy"), "food", "256355007", "Soyabean"),
    (("keju", "cheese"), "food", "102264005", "Cheese"),
    (("susu", "milk"), "food", "70813002", "Milk"),
    (("kacang mete", "kacang mede", "mete", "mede", "cashew"), "food", "227493005", "Cashew nut"),
    (("kenari", "walnut"), "food", "256352005", "Walnut - nut"),
    (("almond",), "food", "256350002", "Almond"),
    (("kacang tanah", "kacang", "peanut"), "food", "762952008", "Peanut"),
    (("gluten",), "food", "89811004", "Gluten"),
    (("gandum", "terigu", "wheat"), "food", "412071004", "Wheat"),
    (("wijen", "sesame"), "food", "260167008", "Sesame seed"),
    (("cokelat", "coklat", "chocolate"), "food", "102262009", "Chocolate"),
    (("stroberi", "strawberry"), "food", "102261002", "Strawberry"),
    (("pisang", "banana"), "food", "256307007", "Banana"),
    (("mangga", "mango"), "food", "260179008", "Mango fruit"),
    (("nanas", "nenas", "pineapple"), "food", "256313003", "Pineapple"),
    (("daging ayam", "ayam", "chicken"), "food", "226955001", "Chicken - meat"),
    (("micin", "vetsin", "msg", "monosodium glutamat"), "food", "75665004", "Monosodium glutamate"),
    # --- lingkungan ---
    (("tungau", "dust mite"), "environment", "720687003", "Dust mite protein"),
    (("debu", "dust"), "environment", "128488006", "House dust"),
    (("serbuk sari", "pollen"), "environment", "256259004", "Pollen"),
    (("bulu kucing", "bulu anjing", "bulu hewan", "dander"), "environment", "264287008", "Animal dander"),
    (("sengatan lebah", "lebah", "tawon", "bee venom"), "environment", "288328004", "Bee venom"),
    (("lateks", "latex", "sarung tangan karet"), "environment", "111088007", "Latex"),
    (("nikel", "nickel"), "environment", "33396006", "Nickel"),
    (("udara dingin", "dingin", "cold air"), "environment", "256234008", "Cold air"),
    # --- obat ---
    (("amoksisilin", "amoxicillin", "amoxilin", "amoxsan"), "medication", "372687004", "Amoxicillin"),
    (("ampisilin", "ampicillin"), "medication", "387170002", "Ampicillin"),
    (("penisilin", "penicillin"), "medication", "764146007", "Penicillin"),
    (("seftriakson", "ceftriaxone"), "medication", "372670001", "Ceftriaxone"),
    (("sefadroksil", "cefadroxil"), "medication", "372651006", "Cefadroxil"),
    (("sefalosporin", "cephalosporin"), "medication", "764147003", "Cephalosporin"),
    (("kotrimoksazol", "cotrimoxazole", "co-trimoxazole", "sulfametoksazol", "sulfamethoxazole", "bactrim"),
     "medication", "363528007", "Sulfamethoxazole"),
    (("sulfa", "sulfonamid"), "medication", "372788003", "Sulfonamide antibacterial"),
    (("siprofloksasin", "ciprofloxacin", "cipro"), "medication", "372840008", "Ciprofloxacin"),
    (("tetrasiklin", "tetracycline"), "medication", "372809001", "Tetracycline"),
    (("eritromisin", "erythromycin"), "medication", "372694001", "Erythromycin"),
    (("kloramfenikol", "chloramphenicol"), "medication", "372777009", "Chloramphenicol"),
    (("metronidazol", "metronidazole"), "medication", "372602008", "Metronidazole"),
    (("aspirin", "asetosal", "asam asetilsalisilat"), "medication", "387458008", "Aspirin"),
    (("parasetamol", "paracetamol", "acetaminophen"), "medication", "387517004", "Acetaminophen"),
    (("ibuprofen",), "medication", "387207008", "Ibuprofen"),
    (("asam mefenamat", "mefenamat", "mefenamic", "ponstan"), "medication", "387185008", "Mefenamic acid"),
    (("diklofenak", "diclofenac", "voltaren"), "medication", "7034005", "Diclofenac"),
    (("ketorolak", "ketorolac"), "medication", "372501008", "Ketorolac"),
    (("metamizol", "metamizole", "antalgin", "metampiron", "dipiron", "dipyrone"), "medication", "780831000", "Metamizole"),
    (("tramadol",), "medication", "386858008", "Tramadol"),
    (("kodein", "codeine"), "medication", "387494007", "Codeine"),
    (("alopurinol", "allopurinol"), "medication", "387135004", "Allopurinol"),
    (("karbamazepin", "carbamazepine"), "medication", "387222003", "Carbamazepine"),
    (("fenitoin", "phenytoin"), "medication", "387220006", "Phenytoin"),
    (("zat kontras", "kontras", "contrast"), "medication", "426722004", "Iodinated contrast media"),
]


def match_allergen(text: str):
    """Cari alergen pertama yang kata kuncinya muncul di AWAL kata pada teks; None bila tidak dikenal.

    Batas awal kata mencegah salah cocok seperti 'bayam' -> 'ayam' atau 'industri' -> 'dust'.
    """
    t = (text or "").lower()
    for keywords, category, code, display in ALLERGENS:
        for k in keywords:
            if re.search(r"(?<![a-z])" + re.escape(k), t):
                return {"keyword": k, "category": category, "code": code, "display": display}
    return None
