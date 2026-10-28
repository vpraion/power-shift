import os
import json
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "power-shift"

DEFAULT_PLUGGED_PROFILE = {
    "is_fps_limit_enabled": False,
    "fps_limit": 90,
    "display_refresh_manual_hz": 90,
    "is_tdp_limit_enabled": False,
    "tdp_limit": 15,
    "is_manual_gpu_clock_enabled": False,
    "manual_gpu_clock_hz": 1600,
}

DEFAULT_BATTERY_PROFILE = {
    "is_fps_limit_enabled": True,
    "fps_limit": 45,
    "display_refresh_manual_hz": 90,
    "is_tdp_limit_enabled": True,
    "tdp_limit": 11,
    "is_manual_gpu_clock_enabled": False,
    "manual_gpu_clock_hz": 1200,
}

DEFAULT_CONFIG = {
    "show_notifications": True
}


def _ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


class Plugin:
    async def _main(self):
        _ensure_dir(CONFIG_DIR / "default")
        _ensure_dir(CONFIG_DIR / "games")

        cfg_file = CONFIG_DIR / "config.json"
        if not cfg_file.exists():
            with open(cfg_file, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CONFIG, f, indent=2)

        # Create sensible initial default profiles if missing
        plugged_file = CONFIG_DIR / "default" / "plugged.json"
        if not plugged_file.exists():
            with open(plugged_file, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_PLUGGED_PROFILE, f, indent=2)

        battery_file = CONFIG_DIR / "default" / "battery.json"
        if not battery_file.exists():
            with open(battery_file, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_BATTERY_PROFILE, f, indent=2)

    async def _unload(self):
        pass

    async def get_config(self):
        cfg_file = CONFIG_DIR / "config.json"
        if cfg_file.exists():
            try:
                with open(cfg_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return DEFAULT_CONFIG

    async def set_config(self, config: dict):
        cfg_file = CONFIG_DIR / "config.json"
        _ensure_dir(CONFIG_DIR)
        try:
            with open(cfg_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
            return True
        except Exception:
            return False

    async def get_profile(self, app_id: str, mode: str):
        mode_file = f"{mode}.json"
        fallback = DEFAULT_PLUGGED_PROFILE if mode == "plugged" else DEFAULT_BATTERY_PROFILE

        if app_id and app_id != "default" and app_id != "769":
            game_file = CONFIG_DIR / "games" / str(app_id) / mode_file
            if game_file.exists():
                try:
                    with open(game_file, "r", encoding="utf-8") as f:
                        return {"profile": json.load(f), "is_custom_game_profile": True}
                except Exception:
                    pass

        default_file = CONFIG_DIR / "default" / mode_file
        if default_file.exists():
            try:
                with open(default_file, "r", encoding="utf-8") as f:
                    return {"profile": json.load(f), "is_custom_game_profile": False}
            except Exception:
                pass

        return {"profile": fallback.copy(), "is_custom_game_profile": False}

    async def save_profile(self, app_id: str, mode: str, profile: dict):
        mode_file = f"{mode}.json"
        if app_id and app_id != "default" and app_id != "769":
            target_dir = CONFIG_DIR / "games" / str(app_id)
        else:
            target_dir = CONFIG_DIR / "default"

        _ensure_dir(target_dir)
        target_file = target_dir / mode_file
        try:
            with open(target_file, "w", encoding="utf-8") as f:
                json.dump(profile, f, indent=2)
            return True
        except Exception:
            return False
