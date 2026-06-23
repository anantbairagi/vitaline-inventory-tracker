"""FastAPI server for the Vitaline Order Dashboard."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from exporter.export import ExportError, export_workbook

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
STATIC_DIR = ROOT / "split"
SEED_DIR = STATIC_DIR


def _seed_data_if_empty() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    snap_dir = DATA_DIR / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)

    target = DATA_DIR / "dashboard-data.json"
    if target.exists():
        return

    seed_data = SEED_DIR / "dashboard-data.json"
    if seed_data.exists():
        shutil.copy2(seed_data, target)

    seed_snap = SEED_DIR / "snapshots"
    if seed_snap.is_dir():
        for item in seed_snap.iterdir():
            dest = snap_dir / item.name
            if item.is_file() and not dest.exists():
                shutil.copy2(item, dest)


def _read_json(path: Path) -> dict:
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Not found: {path.name}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Invalid JSON on disk") from exc


@asynccontextmanager
async def lifespan(_: FastAPI):
    _seed_data_if_empty()
    yield


app = FastAPI(title="Vitaline Inventory Tracker", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/dashboard-data")
def get_dashboard_data() -> JSONResponse:
    data = _read_json(DATA_DIR / "dashboard-data.json")
    return JSONResponse(content=data, headers={"Cache-Control": "no-store"})


@app.get("/api/snapshots/manifest.json")
def get_manifest() -> JSONResponse:
    data = _read_json(DATA_DIR / "snapshots" / "manifest.json")
    return JSONResponse(content=data, headers={"Cache-Control": "no-store"})


@app.get("/api/snapshots/{week}.json")
def get_snapshot(week: str) -> JSONResponse:
    if not week.replace("-", "").isdigit() or len(week) != 10:
        raise HTTPException(status_code=400, detail="Invalid week format")
    data = _read_json(DATA_DIR / "snapshots" / f"{week}.json")
    return JSONResponse(content=data, headers={"Cache-Control": "no-store"})


@app.post("/api/upload-workbook")
async def upload_workbook(file: UploadFile = File(...)) -> dict:
    filename = (file.filename or "").lower()
    if not filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx workbooks are accepted")

    suffix = Path(filename).suffix or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = Path(tmp.name)
        try:
            content = await file.read()
            if not content:
                raise HTTPException(status_code=400, detail="Uploaded file is empty")
            tmp.write(content)

            try:
                summary = export_workbook(tmp_path, DATA_DIR)
            except ExportError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            tmp_path.unlink(missing_ok=True)

    return {"ok": True, **summary}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
