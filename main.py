import json
import os
import subprocess
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "power-shift"

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

    async def apply_gamescope_settings(self, fps_limit: int, refresh_hz: int):
        """
        Directly enforces Gamescope FPS limit and refresh rate on the X11 root window.
        """
        try:
            env = dict(os.environ, DISPLAY=":0")
            fps = int(fps_limit)
            hz = int(refresh_hz)
            subprocess.run(
                ["xprop", "-root", "-f", "GAMESCOPE_FPS_LIMIT", "32c", "-set", "GAMESCOPE_FPS_LIMIT", str(fps)],
                env=env,
                capture_output=True,
                check=False
            )
            if hz > 0:
                subprocess.run(
                    ["xprop", "-root", "-f", "GAMESCOPE_DYNAMIC_REFRESH", "32c", "-set", "GAMESCOPE_DYNAMIC_REFRESH", str(hz)],
                    env=env,
                    capture_output=True,
                    check=False
                )
            return True
        except Exception:
            return False

    async def get_profile(self, app_id: str, mode: str):
        """
        Retrieves profile for a target key ('default' or numeric game app_id) and mode ('battery' | 'plugged').
        Returns exists: True/False so the frontend can snapshot current QAM values if missing.
        """
        mode_file = f"{mode}.json"
        if app_id and app_id != "default" and app_id != "769":
            game_file = CONFIG_DIR / "games" / str(app_id) / mode_file
            if game_file.exists():
                try:
                    with open(game_file, "r", encoding="utf-8") as f:
                        return {"exists": True, "profile": json.load(f)}
                except Exception:
                    pass

        # Check default profile file
        default_file = CONFIG_DIR / "default" / mode_file
        if default_file.exists():
            try:
                with open(default_file, "r", encoding="utf-8") as f:
                    return {"exists": True, "profile": json.load(f)}
            except Exception:
                pass

        return {"exists": False, "profile": None}

    async def save_profile(self, app_id: str, mode: str, profile: dict):
        """
        Saves profile data directly to games/<app_id>/<mode>.json or default/<mode>.json.
        """
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
