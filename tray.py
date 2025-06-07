from pystray import Icon, MenuItem, Menu
from PIL import Image

class TrayIcon:
    def __init__(self, settings_callback, quit_callback):
        self.settings_callback = settings_callback
        self.quit_callback = quit_callback
        
        self.icon = self._create_icon()
        print("Tray icon initialized.")

    def _on_settings_clicked(self):
        """Handler for the 'Settings' menu item."""
        if self.settings_callback:
            print("Settings clicked, calling callback.")
            self.settings_callback()

    def _on_quit_clicked(self):
        """Handler for the 'Quit' menu item."""
        print("Quit clicked, calling callback.")
        if self.quit_callback:
            self.quit_callback()
        self.icon.stop()

    def _create_icon(self):
        """Creates and configures the pystray.Icon object by loading from a file."""
        image = Image.open("icon.ico")
        menu = Menu(
            MenuItem("Settings", lambda: self._on_settings_clicked()),
            MenuItem("Quit", lambda: self._on_quit_clicked())
        )
        return Icon("WAPresence", image, "WAPresence", menu)

    def show(self):
        """Displays the tray icon."""
        self.icon.run_detached()

    def stop(self):
        """Stops the tray icon."""
        self.icon.stop()