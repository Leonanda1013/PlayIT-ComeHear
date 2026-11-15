from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    secret_key: str = "dev-only-secret"
    demo_password: str = "demo"
    database_url: str = f"sqlite:///{BASE_DIR / 'comehear.db'}"
    timezone: str = "Asia/Jakarta"
    audio_dir: Path = BASE_DIR / "data" / "audio"
    icd10_csv: Path = BASE_DIR / "data" / "icd10_satusehat.csv"
    icd10_seed_csv: Path = BASE_DIR / "data" / "icd10_seed.csv"

    satusehat_mode: str = "mock"  # mock | sandbox
    satusehat_auth_url: str = "https://api-satusehat-stg.dto.kemkes.go.id/oauth2/v1"
    satusehat_base_url: str = "https://api-satusehat-stg.dto.kemkes.go.id/fhir-r4/v1"
    satusehat_client_id: str = ""
    satusehat_client_secret: str = ""
    satusehat_org_id: str = "647ba346-c21f-4328-86f2-c6ce268cde97"

    asr_model: str = "small"
    asr_device: str = "cpu"
    asr_compute_type: str = "int8"

    llm_providers: str = "gemini,anthropic"
    gemini_api_key: str = ""
    gemini_models: str = "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-5-5"

    worker_interval_s: float = 3.0
    max_send_attempts: int = 6

    @property
    def provider_list(self) -> list[str]:
        return [p.strip() for p in self.llm_providers.split(",") if p.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
