#!/usr/bin/env python3
"""
export_dashboard_data.py  (v2 - multi-week)
===========================================
CLI wrapper around exporter.export.export_workbook.

USAGE
-----
    python export_dashboard_data.py WORKBOOK.xlsx [OUTPUT_DIR]

REQUIREMENTS:  pip install openpyxl
"""

import sys
from pathlib import Path

from exporter.export import ExportError, export_workbook


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    in_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data")

    try:
        summary = export_workbook(in_path, out_dir)
    except ExportError as exc:
        sys.exit(str(exc))

    print(f"Exported week {summary['week']}")
    print(f"  rows:            {summary['rows']}")
    print(f"  offices:         {summary['offices']} ({summary['active_offices']} active)")
    print(f"  wrote:           dashboard-data.json, snapshots/{summary['week']}.json")
    print(f"  manifest weeks:  {summary['manifest_weeks']}")


if __name__ == "__main__":
    main()
