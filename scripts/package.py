#!/usr/bin/env python3
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = ROOT / "out"
ZIP_PATH = ROOT / "PowerShift.zip"

def main():
    if not (DIST / "index.js").exists():
        raise SystemExit("[error] dist/index.js not found. Please run 'pnpm run build' first.")

    if OUT.exists():
        shutil.rmtree(OUT)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()

    plugin_dir = OUT / "PowerShift"
    plugin_dir.mkdir(parents=True)

    # 1. dist/
    shutil.copytree(DIST, plugin_dir / "dist")

    # 2. Release files
    files_to_copy = [
        "main.py",
        "package.json",
        "plugin.json",
        "README.md",
        "LICENSE",
    ]
    for name in files_to_copy:
        src = ROOT / name
        if src.exists():
            shutil.copy2(src, plugin_dir / name)

    # 3. Create zip archive with PowerShift/ root
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in plugin_dir.rglob("*"):
            if file.is_file():
                arcname = file.relative_to(OUT)
                zf.write(file, arcname)

    print(f"Archive successfully created: {ZIP_PATH.name}")
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        for info in zf.infolist():
            print(f"  {info.filename} ({info.file_size} bytes)")

if __name__ == "__main__":
    main()
