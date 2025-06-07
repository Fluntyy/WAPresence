import os
import time
import threading
import tempfile
from configparser import ConfigParser
from selenium.webdriver.common.by import By
from PyQt5 import QtWidgets, QtGui
from PyQt5.uic import loadUi
from PyQt5.QtCore import pyqtSignal, QMetaObject, Qt, pyqtSlot
from PyQt5.QtWidgets import QDialog
from shared import get_update_interval, get_format_string, set_update_interval, set_format_string, settings_updated_event, set_current_source, get_current_source
from tray import TrayIcon

config = ConfigParser()
temp_dir = tempfile.gettempdir()
qr_path = os.path.join(temp_dir, "qr.png")

"""Login Window to display the QR code"""
class LoginWindow(QtWidgets.QMainWindow):
    login_complete = pyqtSignal()

    def __init__(self, driver):
        super(LoginWindow, self).__init__()
        loadUi("Login.ui", self)
        self.setWindowTitle("WAPresence - Login")
        self.driver = driver
        self.qr_thread_running = False

    def showEvent(self, event):
        """Start the QR code thread when the window is shown"""
        super(LoginWindow, self).showEvent(event)
        if not self.qr_thread_running:
            self.update_qr_code()
            self.qr_thread_running = True

    def update_qr_code(self):
        """Check for the QR code and display it"""
        def qr_thread():
            while True:
                try:
                    qr = self.driver.find_element(By.XPATH, "//canvas")
                    qr.screenshot(qr_path)
                    pixmap = QtGui.QPixmap(qr_path)
                    self.QR.setPixmap(pixmap)
                except Exception:
                    self.QR.setText("Loading...")
                time.sleep(1)

                # Check if login is complete
                if "_aigw" in self.driver.page_source:
                    self.login_complete.emit()
                    break

        threading.Thread(target=qr_thread, daemon=True).start()

class SpotifyAPISetupDialog(QDialog):
    """Dialog to set up Spotify credentials"""
    def __init__(self):
        super(SpotifyAPISetupDialog, self).__init__()
        loadUi("SpotifyAPISetup.ui", self)
        self.setWindowTitle("WAPresence - Setup Spotify API")
        self.RedirectURI.setDisabled(True)
        self.EditRedirectButton.clicked.connect(self.enable_redirect_uri)
        self.ActionButton.accepted.connect(self.save_credentials)
        self.ActionButton.rejected.connect(self.reject)

    def enable_redirect_uri(self):
        """Enable the RedirectURI field for advanced users."""
        self.RedirectURI.setDisabled(False)

    def save_credentials(self):
        """Save Spotify credentials to config.ini."""
        client_id = self.ClientID.text().strip()
        client_secret = self.ClientSecret.text().strip()
        redirect_uri = self.RedirectURI.text().strip()

        if not client_id or not client_secret:
            QtWidgets.QMessageBox.warning(self, "Error", "Client ID and Client Secret cannot be empty!")
            return

        if not config.has_section("Spotify"):
            config.add_section("Spotify")
        config.set("Spotify", "ClientID", client_id)
        config.set("Spotify", "ClientSecret", client_secret)
        
        # Save the RedirectURI only if it's enabled and not empty
        if self.RedirectURI.isEnabled() and redirect_uri:
            config.set("Spotify", "RedirectURI", redirect_uri)
        else:
            # Use a default RedirectURI if not provided
            config.set("Spotify", "RedirectURI", "http://localhost:6969/callback")

        with open("config.ini", "w") as config_file:
            config.write(config_file)

        QtWidgets.QMessageBox.information(self, "Success", "Spotify API credentials saved successfully!")
        time.sleep(1)
        self.accept()

class SettingsWindow(QtWidgets.QMainWindow):
    """Settings Window to control the application"""
    restore_bio_signal = pyqtSignal()

    def __init__(self, driver):
        super(SettingsWindow, self).__init__()
        loadUi("Settings.ui", self)
        self.setWindowTitle("WAPresence - Settings")
        self.driver = driver
        self.tray = TrayIcon(settings_callback=self.show_settings, quit_callback=self.tray_exit)
        self.tray.settings_callback = self.show_settings
        self.tray.show()
        self.load_config()
        self.SaveButton.clicked.connect(self.save_settings)
        self.RestoreButton.clicked.connect(self.restore_defaults)
        self.ExitButton.clicked.connect(self.exit_application)
        self.LocalRadio.toggled.connect(self.handle_radio_selection)
        self.SpotifyRadio.toggled.connect(self.handle_radio_selection)

    def handle_radio_selection(self):
        """Handle the selection of Local Media or Spotify."""
        if self.SpotifyRadio.isChecked():
            if not config.has_section("Spotify") or not config.get("Spotify", "ClientID", fallback="") or not config.get("Spotify", "ClientSecret", fallback=""):
                # Open Spotify API setup dialog
                dialog = SpotifyAPISetupDialog()
                if dialog.exec_() == QDialog.Rejected:
                    self.LocalRadio.setChecked(True)
                    set_current_source("local")
                else:
                    config.set("Configuration", "Source", "Spotify")
                    set_current_source("spotify")
            else:
                config.set("Configuration", "Source", "Spotify")
                set_current_source("spotify")
        elif self.LocalRadio.isChecked():
            set_current_source("local")
            config.set("Configuration", "Source", "Local")
        with open("config.ini", "w") as config_file:
            config.write(config_file)

    def load_config(self):
        """Load settings from config.ini and populate the GUI fields."""
        print("Loading settings from config.ini...")
        if not config.read("config.ini"):
            print("config.ini not found. Creating a new one with default settings...")

            set_update_interval(1)
            set_format_string("Listening to [artist] - [title] | [bio]")
            if not config.has_section("Configuration"):
                config.add_section("Configuration")
            config.set("Configuration", "UpdateEvery", "1")
            config.set("Configuration", "Format", "Listening to [artist] - [title] | [bio]")
            config.set("Configuration", "Source", "Local")

            with open("config.ini", "w") as config_file:
                config.write(config_file)
            self.LocalRadio.setChecked(True)
        else:
            set_update_interval(int(config.get("Configuration", "UpdateEvery", fallback="1")))
            set_format_string(config.get("Configuration", "Format", fallback="Listening to [artist] - [title] | [bio]"))
            source = config.get("Configuration", "Source")
            self.UpdateEveryBox.setValue(get_update_interval())
            self.FormatTextBox.setText(get_format_string())
            if source == "Spotify":
                self.SpotifyRadio.setChecked(True)
            else:
                self.LocalRadio.setChecked(True)

    def save_settings(self):
        """Save settings to config.ini and emit updates"""
        print("Saving settings...")
        set_update_interval(self.UpdateEveryBox.value())
        set_format_string(self.FormatTextBox.text())

        if not config.has_section("Configuration"):
            config.add_section("Configuration")
        config.set("Configuration", "UpdateEvery", str(get_update_interval()))
        config.set("Configuration", "Format", get_format_string())
        with open("config.ini", "w") as config_file:
            config.write(config_file)

        QtWidgets.QMessageBox.information(self, "Settings Saved", "Your settings have been saved successfully!")
        settings_updated_event.set()  # Signal the update_bio_loop to reload settings

    def restore_defaults(self):
        """Restore default settings"""
        print("Restoring defaults...")
        
        config.remove_section("Spotify")
        config.remove_section("Configuration")
        
        if os.path.exists("config.ini"):
            os.remove("config.ini")  # Delete the config.ini file

        set_update_interval(1)
        set_format_string("Listening to [artist] - [title] | [bio]")
        
        self.UpdateEveryBox.setValue(get_update_interval())
        self.FormatTextBox.setText(get_format_string())
        self.LocalRadio.setChecked(True)
        self.SpotifyRadio.setChecked(False)

        QtWidgets.QMessageBox.information(self, "Defaults Restored", "Settings have been restored to defaults.")
        settings_updated_event.set()  # Signal the update_bio_loop to reload settings

    def closeEvent(self, event):
        """Put the application in the system tray instead of closing it."""
        event.ignore()
        self.hide()
        self.tray.icon.notify("Application minimized to system tray.", "WAPresence")
        
    def show_settings(self):
        """Show the settings window."""
        print("Showing settings window...")
        QMetaObject.invokeMethod(self, "execute_gui_operations", Qt.QueuedConnection)
        
    def tray_exit(self):
        """Handle the exit action from the tray icon."""
        print("Tray icon exit triggered.")
        QMetaObject.invokeMethod(self, "exit_application", Qt.QueuedConnection)

    @pyqtSlot()
    def execute_gui_operations(self):
        """Perform GUI operations."""
        print("Executing GUI operations...")
        try:
            self.show()
            self.raise_()
            self.activateWindow()
            self.repaint()
            print("Window showed successfully.")
        except Exception as e:
            print(f"Error during GUI operations: {e}")

    @pyqtSlot()
    def exit_application(self):
        """Exit the application and restore the original bio."""
        print("Exiting application...")
        try:
            os.remove(qr_path)
            print("QR code file removed.")
            self.restore_bio_signal.emit()
            print("Restore bio signal emitted.")
            self.driver.quit()
            print("Selenium driver quit successfully.")
            QtWidgets.QApplication.quit()
            print("Application quit successfully.")
        except Exception as e:
            print(f"Error during cleanup operations: {e}")
        finally:
            os._exit(0)