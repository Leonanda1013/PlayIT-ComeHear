import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_smoke_e2e(tmp_path):
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{tmp_path / 'smoke.db'}", "LLM_PROVIDERS": "mock",
           "SATUSEHAT_MODE": "mock", "DEMO_PASSWORD": "pw", "WORKER_INTERVAL_S": "0.2",
           "AUDIO_DIR": str(tmp_path / "audio"), "ASR_MODEL": "", "ENABLE_DEMO_SEED": "true"}
    r = subprocess.run([sys.executable, "scripts/smoke_e2e.py"], cwd=ROOT, env=env,
                       capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-4000:]
    assert "terkirim" in r.stdout
