"""FastAPI server for the Vitaline Order Dashboard."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from exporter.export import ExportError, export_workbook

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
STATIC_DIR = ROOT / "split"
SEED_DIR = STATIC_DIR
UPLOAD_CHUNK_SIZE = 1024 * 1024

_export_pool = ThreadPoolExecutor(max_workers=1)


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


async def _save_upload_to_path(upload: UploadFile, dest: Path) -> None:
    with dest.open("wb") as out:
        while True:
            chunk = await upload.read(UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            out.write(chunk)


@asynccontextmanager
async def lifespan(_: FastAPI):
    _seed_data_if_empty()
    yield
    _export_pool.shutdown(wait=False)


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
    fd, tmp_name = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        await _save_upload_to_path(file, tmp_path)
        if tmp_path.stat().st_size == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        loop = asyncio.get_running_loop()
        try:
            summary = await loop.run_in_executor(
                _export_pool, export_workbook, tmp_path, DATA_DIR
            )
        except ExportError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    return {"ok": True, **summary}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
