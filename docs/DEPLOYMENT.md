# Deployment — Dakshin Marg

## One-command (Docker)
```bash
docker compose up --build
# frontend :4173  backend :8200  python :8100  mongo :27017  redis :6379
```

## Manual (3 terminals)
```bash
cd python-services && python -m uvicorn env_data.api:app --host 0.0.0.0 --port 8100
cd backend && npm run start   # :8200
cd frontend && npm run dev    # :5173  (or npm run build && npm run preview → :4173)
```

## Windows
Double-click `START-DAKSHIN-MARG.bat`; it installs deps, builds, and opens http://localhost:4173.

## Health Checks
- `curl :8100/env/health`
- `curl :8200/api/health`
- `curl :8200/api/system/health`
- Frontend TopBar shows LIVE/DEGRADED/FAILED.

## Seeding
```bash
python -m env_data.ingest            # refresh normalized datasets (optional — ships with offline data)
python -m env_data.iceberg_ingest    # refresh BYU tracks
# missions seed is automatic (file fallback creates data/missions/missions.json)
```

## Environment
Copy `.env.example` → `.env`; no secrets required for demo (all sources open).
