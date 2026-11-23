from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    secret_key: str = "dev-only-secret"
    demo_password: str = "demo"
    # Wajib diisi lewat BE/.env atau environment proses; jangan diam-diam memakai SQLite.
    database_url: str
    timezone: str = "Asia/Jakarta"
    session_ttl_minutes: int = 480
    secure_cookies: bool = False
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    enable_demo_seed: bool = False
    audio_dir: Path = BASE_DIR / "data" / "audio"
    icd10_csv: Path = BASE_DIR / "data" / "icd10_satusehat.csv"

    satusehat_mode: str = "mock"  # mock | sandbox
    satusehat_auth_url: str = "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1"
    satusehat_base_url: str = "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1"
    satusehat_client_id: str = ""
    satusehat_client_secret: str = ""
    satusehat_org_id: str = "647ba346-c21f-4328-86f2-c6ce268cde97"

    clinic_name: str = "KLINIK BUNGA MELATI"
    clinic_service_type: str = "PELAYANAN KESEHATAN RAWAT JALAN & REKAM MEDIS ELEKTRONIK"
    clinic_address: str = "Jl. Melati Raya No. 12, Kebayoran Baru, Jakarta Selatan 12160"
    clinic_phone: str = "(021) 720-1845"
    clinic_email: str = "info@klinikbungamelati.id"
    clinic_license: str = "445/018/K-PRATAMA/DPMPTSP/2023"
    clinic_faskes_code: str = "317101234"

    asr_model: str = "large-v3-turbo"
    asr_device: str = "cpu"
    asr_compute_type: str = "int8"
    asr_prompt: str = "dewasa"  # dewasa | anak | none (prompt awal Whisper)
    # Thread CPU untuk Whisper. 0 = bawaan CTranslate2 (hanya sebagian inti); 8 terukur ±1,5x lebih cepat
    # di i5-12450H (12 thread logis). Sisakan beberapa inti untuk server web dan OS.
    asr_cpu_threads: int = 8
    # Skema dua model: ASR_MODEL dipakai saat rekaman berjalan (transkrip live, harus cepat);
    # ASR_FINAL_MODEL mentranskrip ulang seluruh audio setelah "Selesai" dan hasilnya yang dikirim ke LLM.
    # Kosong = sama dengan ASR_MODEL (tanpa transkripsi ulang).
    asr_final_model: str = ""

    llm_providers: str = "claude"
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-5-5"
    claude_max_tokens: int = Field(default=8192, ge=1, le=65536)
    llm_timeout_s: float = Field(default=45.0, gt=0, le=300)
    llm_max_retries: int = Field(default=1, ge=0, le=2)
    # Kontrak konfigurasi adapter OpenAI milik Kemal. Registry memuatnya secara lazy.
    openai_api_key: str = ""
    openai_model: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    gemini_api_key: str = ""
    gemini_models: str = "gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.5-flash"

    worker_interval_s: float = 3.0
    max_send_attempts: int = 6

    @property
    def provider_list(self) -> list[str]:
        return [p.strip() for p in self.llm_providers.split(",") if p.strip()]

    @property
    def final_asr_model(self) -> str:
        return self.asr_final_model.strip() or self.asr_model

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]

    def validate_runtime(self) -> None:
        if self.satusehat_mode not in ("mock", "sandbox"):
            raise RuntimeError("SATUSEHAT_MODE harus mock atau sandbox.")
        if self.session_ttl_minutes <= 0:
            raise RuntimeError("SESSION_TTL_MINUTES harus lebih dari nol.")
        if self.satusehat_mode == "sandbox":
            if self.secret_key == "dev-only-secret" or len(self.secret_key) < 32:
                raise RuntimeError("SECRET_KEY sandbox harus berupa nilai acak minimal 32 karakter.")
            if self.demo_password == "demo" or len(self.demo_password) < 10:
                raise RuntimeError("DEMO_PASSWORD sandbox harus diganti dengan nilai minimal 10 karakter.")
            if not self.satusehat_client_id or not self.satusehat_client_secret:
                raise RuntimeError("Kredensial SATUSEHAT sandbox belum lengkap.")
            if self.enable_demo_seed:
                raise RuntimeError("ENABLE_DEMO_SEED harus false pada mode sandbox.")
            if any(origin == "*" for origin in self.allowed_origins):
                raise RuntimeError("CORS_ORIGINS sandbox tidak boleh memakai wildcard.")


@lru_cache
def get_settings() -> Settings:
    return Settings()
