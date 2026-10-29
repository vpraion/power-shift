from pathlib import Path


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
