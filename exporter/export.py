"""Shared workbook-to-dashboard JSON export logic."""

from __future__ import annotations

import datetime
import json
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

SHEET_PAR = "PAR_Output"
SHEET_ACTIVATION = "Office_Activation"
SHEET_CONTROLS = "Live_Controls"
REQUIRED_SHEETS = (SHEET_PAR, SHEET_ACTIVATION, SHEET_CONTROLS)
ROLLING_WEEKS = 12

PAR_COLS = {
    "office": 1,
    "include": 2,
    "vendor": 3,
    "item": 4,
    "unit_basis": 7,
    "units_per_pack": 8,
    "price_per_pack": 10,
    "par_target": 21,
    "rop": 22,
    "on_hand": 23,
    "order_packs": 25,
    "order_units": 26,
    "order_cost": 27,
    "status": 29,
}
ACTIVATION_FIRST_ROW, ACTIVATION_LAST_ROW = 5, 23
CTL_BOOKING_START, CTL_BOOKING_END = "B2", "B3"
CTL_DEMAND_BASIS, CTL_SNAPSHOT = "B7", "B8"

ROW_FIELD_ORDER = [
    "office",
    "vendor",
    "item",
    "unit_basis",
    "units_per_pack",
    "price_per_pack",
    "on_hand",
    "par_target",
    "rop",
    "order_packs",
    "order_units",
    "order_cost",
    "status",
]


class ExportError(Exception):
    """Raised when a workbook cannot be exported."""


def fmt_date(v: Any) -> str:
    if isinstance(v, datetime.datetime):
        return f"{v.month}/{v.day}/{str(v.year)[2:]}"
    if isinstance(v, (int, float)):
        d = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(v))
        return f"{d.month}/{d.day}/{str(d.year)[2:]}"
    return "" if v is None else str(v)


def snapshot_iso(v: Any) -> str:
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, (int, float)):
        d = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(v))
        return d.strftime("%Y-%m-%d")
    return datetime.date.today().strftime("%Y-%m-%d")


def num(v: Any) -> float:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0


def build_payload(wb) -> tuple[dict, dict, list]:
    par = wb[SHEET_PAR]
    act = wb[SHEET_ACTIVATION]
    ctl = wb[SHEET_CONTROLS]
    controls = {
        "booking_start": fmt_date(ctl[CTL_BOOKING_START].value),
        "booking_end": fmt_date(ctl[CTL_BOOKING_END].value),
        "snapshot": fmt_date(ctl[CTL_SNAPSHOT].value),
        "demand_basis": str(ctl[CTL_DEMAND_BASIS].value or ""),
    }
    activation: dict[str, str] = {}
    for r in range(ACTIVATION_FIRST_ROW, ACTIVATION_LAST_ROW + 1):
        office = act.cell(r, 1).value
        if office not in (None, ""):
            activation[str(office)] = str(act.cell(r, 2).value or "Y")
    rows: list[list] = []
    for r in range(2, par.max_row + 1):
        office = par.cell(r, PAR_COLS["office"]).value
        if office in (None, ""):
            continue
        if str(par.cell(r, PAR_COLS["include"]).value) != "Y":
            continue
        rec = {
            "office": str(office),
            "vendor": str(par.cell(r, PAR_COLS["vendor"]).value or ""),
            "item": str(par.cell(r, PAR_COLS["item"]).value or ""),
            "unit_basis": str(par.cell(r, PAR_COLS["unit_basis"]).value or ""),
            "units_per_pack": num(par.cell(r, PAR_COLS["units_per_pack"]).value),
            "price_per_pack": num(par.cell(r, PAR_COLS["price_per_pack"]).value),
            "on_hand": num(par.cell(r, PAR_COLS["on_hand"]).value),
            "par_target": num(par.cell(r, PAR_COLS["par_target"]).value),
            "rop": num(par.cell(r, PAR_COLS["rop"]).value),
            "order_packs": num(par.cell(r, PAR_COLS["order_packs"]).value),
            "order_units": num(par.cell(r, PAR_COLS["order_units"]).value),
            "order_cost": num(par.cell(r, PAR_COLS["order_cost"]).value),
            "status": str(par.cell(r, PAR_COLS["status"]).value or ""),
        }
        rows.append([rec[f] for f in ROW_FIELD_ORDER])
    return controls, activation, rows


def _validate_workbook(wb) -> None:
    missing = [sheet for sheet in REQUIRED_SHEETS if sheet not in wb.sheetnames]
    if missing:
        found = ", ".join(wb.sheetnames)
        raise ExportError(
            f"Expected sheet(s) {', '.join(missing)} not found. Found: {found}"
        )


def export_workbook(in_path: Path, out_dir: Path) -> dict[str, Any]:
    """Export workbook to dashboard JSON files. Returns a summary dict."""
    in_path = Path(in_path)
    out_dir = Path(out_dir)
    if not in_path.exists():
        raise ExportError(f"Workbook not found: {in_path}")

    snap_dir = out_dir / "snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)

    wb = load_workbook(in_path, data_only=True)
    _validate_workbook(wb)

    controls, activation, rows = build_payload(wb)
    snap_key = snapshot_iso(wb[SHEET_CONTROLS][CTL_SNAPSHOT].value)
    generated = datetime.datetime.now().isoformat(timespec="seconds")

    payload = {
        "generated": generated,
        "week": snap_key,
        "controls": controls,
        "activation": activation,
        "rows": rows,
    }
    compact = json.dumps(payload, separators=(",", ":"))

    (out_dir / "dashboard-data.json").write_text(compact, encoding="utf-8")
    (snap_dir / f"{snap_key}.json").write_text(compact, encoding="utf-8")

    weeks: list[dict[str, str]] = []
    for f in snap_dir.glob("*.json"):
        if f.name == "manifest.json":
            continue
        key = f.stem
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            label = d.get("controls", {}).get("snapshot", key)
        except Exception:
            label = key
        weeks.append({"week": key, "label": label, "file": f"snapshots/{f.name}"})
    weeks.sort(key=lambda w: w["week"], reverse=True)
    rolling = weeks[:ROLLING_WEEKS]

    manifest = {"generated": generated, "current": snap_key, "weeks": rolling}
    (snap_dir / "manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":")), encoding="utf-8"
    )

    active = sum(1 for v in activation.values() if v == "Y")
    return {
        "week": snap_key,
        "generated": generated,
        "rows": len(rows),
        "offices": len(activation),
        "active_offices": active,
        "manifest_weeks": len(rolling),
        "snapshot_label": controls.get("snapshot", snap_key),
    }
