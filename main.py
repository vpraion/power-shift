import json
from pathlib import Path

CONFIG_DIR = Path.home() / ".config" / "power-shift"

DEFAULT_CONFIG = {
    "show_notifications": True
}


def _ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def _unpack_args(args):
    if len(args) == 1 and isinstance(args[0], (list, tuple)):
        return list(args[0])
    return list(args)


class Device:
    """Base generic device representation."""
    name: str = "Generic Device"

    def is_ac_online(self) -> bool:
        """Universal sysfs discovery across any available Mains or USB power supply."""
        base = Path("/sys/class/power_supply")
        if base.exists():
            try:
                for entry in base.iterdir():
                    type_file = entry / "type"
                    online_file = entry / "online"
                    if online_file.exists() and type_file.exists():
                        if type_file.read_text().strip() in ("Mains", "USB"):
                            if online_file.read_text().strip() == "1":
                                return True
            except Exception:
                pass
            return False
        return True

    def is_external_display_connected(self) -> bool:
        """Base fallback: unknown devices do not assume DRM display topologies."""
        return False

    def get_power_mode(self) -> str:
        """Self-aware power mode resolution."""
        if not self.is_ac_online():
            return "battery"
        if self.is_external_display_connected():
            return "docked"
        return "plugged"


class SteamDeck(Device):
    """Steam Deck family device representation."""
    name: str = "Steam Deck"

    def is_external_display_connected(self) -> bool:
        """
        On Steam Deck hardware (Van Gogh APU), external display outputs (USB-C DP Alt-mode / Dock)
        are routed through the physical DP connector (card0-DP-*).
        """
        drm_base = Path("/sys/class/drm")
        if not drm_base.exists():
            return False
        try:
            for entry in drm_base.glob("card*-DP-*"):
                status_file = entry / "status"
                if status_file.exists():
                    if status_file.read_text().strip().lower() == "connected":
                        return True
        except Exception:
            pass
        return False


class SteamDeckOLED(SteamDeck):
    """Steam Deck OLED (Galileo)."""
    name: str = "Steam Deck OLED"


class SteamDeckLCD(SteamDeck):
    """Steam Deck LCD (Jupiter)."""
    name: str = "Steam Deck LCD"


def resolve_device() -> Device:
    """Resolves and returns the current hardware device instance via DMI sysfs."""
    dmi_path = Path("/sys/class/dmi/id")
    vendor = ""
    product = ""
    board = ""
    if dmi_path.exists():
        try:
            vendor = (dmi_path / "sys_vendor").read_text().strip().lower()
            product = (dmi_path / "product_name").read_text().strip().lower()
            board = (dmi_path / "board_name").read_text().strip().lower()
        except Exception:
            pass

    if vendor == "valve":
        if "galileo" in product or "galileo" in board:
            return SteamDeckOLED()
        if "jupiter" in product or "jupiter" in board:
            return SteamDeckLCD()
        return SteamDeck()

    return Device()


class Plugin:
    def __init__(self):
        self.device = resolve_device()

    async def _main(self):
        _ensure_dir(CONFIG_DIR / "default")
        _ensure_dir(CONFIG_DIR / "games")

        cfg_file = CONFIG_DIR / "config.json"
        if not cfg_file.exists():
            with open(cfg_file, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CONFIG, f, indent=2)

    async def _unload(self):
        pass

    async def get_device_info(self, *args, **kwargs):
        """Returns hardware device information resolved polymorphically."""
        return {
            "name": self.device.name,
        }

    async def get_config(self, *args, **kwargs):
        cfg_file = CONFIG_DIR / "config.json"
        if cfg_file.exists():
            try:
                with open(cfg_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return DEFAULT_CONFIG

    async def set_config(self, *args, **kwargs):
        unpacked = _unpack_args(args)
        config = unpacked[0] if len(unpacked) > 0 else kwargs.get("config", {})
        cfg_file = CONFIG_DIR / "config.json"
        _ensure_dir(CONFIG_DIR)
        try:
            with open(cfg_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
            return True
        except Exception:
            return False

    async def get_power_mode(self, *args, **kwargs):
        """
        Direct hardware query via self-aware device instance.
        Resolves to 'battery', 'plugged', or 'docked'.
        """
        return self.device.get_power_mode()

    async def get_profile(self, *args, **kwargs):
        """
        Retrieves profile for a target key ('default' or numeric game app_id) and mode ('battery' | 'plugged' | 'docked').
        Returns exists: True/False so the frontend can snapshot current QAM values if missing.
        """
        unpacked = _unpack_args(args)
        app_id = str(unpacked[0]) if len(unpacked) > 0 else str(kwargs.get("app_id", "default"))
        mode = str(unpacked[1]) if len(unpacked) > 1 else str(kwargs.get("mode", "battery"))
        mode_file = f"{mode}.json"
        if app_id and app_id != "default" and app_id != "769":
            game_file = CONFIG_DIR / "games" / str(app_id) / mode_file
            if game_file.exists():
                try:
                    with open(game_file, "r", encoding="utf-8") as f:
                        return {"exists": True, "profile": json.load(f)}
                except Exception:
                    pass
        default_file = CONFIG_DIR / "default" / mode_file
        if default_file.exists():
            try:
                with open(default_file, "r", encoding="utf-8") as f:
                    return {"exists": True, "profile": json.load(f)}
            except Exception:
                pass
        return {"exists": False, "profile": None}

    async def save_profile(self, *args, **kwargs):
        """
        Persists profile dictionary for a target key ('default' or numeric game app_id) and mode.
        """
        unpacked = _unpack_args(args)
        app_id = str(unpacked[0]) if len(unpacked) > 0 else str(kwargs.get("app_id", "default"))
        mode = str(unpacked[1]) if len(unpacked) > 1 else str(kwargs.get("mode", "battery"))
        profile = unpacked[2] if len(unpacked) > 2 else kwargs.get("profile", {})

        mode_file = f"{mode}.json"
        target_dir = (CONFIG_DIR / "games" / str(app_id)) if (app_id and app_id != "default" and app_id != "769") else (CONFIG_DIR / "default")
        _ensure_dir(target_dir)

        file_path = target_dir / mode_file
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(profile, f, indent=2)
            return True
        except Exception:
            return False
