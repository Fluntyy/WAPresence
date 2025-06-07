import time
import asyncio
import threading
import argparse
import sys
import platform  # Import platform module for OS detection

# --- Platform-specific imports ---
IS_WINDOWS = platform.system() == "Windows"
IS_LINUX = platform.system() == "Linux"

if IS_WINDOWS:
    try:
        import ctypes # type: ignore
        from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as MediaManager # type: ignore
    except ImportError:
        print("Error: 'winsdk' library not found.")
        print("Please install it using: pip install winsdk")
        sys.exit(1)
elif IS_LINUX:
    try:
        from dbus_next.aio import MessageBus # type: ignore
        from dbus_next.constants import BusType # type: ignore
    except ImportError:
        print("Error: 'dbus-next' library not found.")
        print("Please install it using: pip install dbus-next")
        sys.exit(1)

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.common.exceptions import NoSuchElementException
from PyQt5.QtWidgets import QApplication
from gui import LoginWindow, SettingsWindow  # Import GUI classes
from shared import get_update_interval, get_format_string, settings_updated_event, get_current_source, source_changed_event
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from configparser import ConfigParser

# Global Variables
driver = None
biotext = ""
update_interval = 1
format_string = get_format_string()
sp = None
config = ConfigParser()
OLD_UI = False
user_agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"

"""Element Definitions"""
def define_element():
    global profile_menu, biotext_element, bio_input, edit_button, done_button
    if OLD_UI == False:
        profile_menu = "/html/body/div[1]/div/div/div[3]/div/header/div/div[2]/div/div[2]/button"
        biotext_element = "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div/div/span/span"
        bio_input = "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div[1]/div/div/div"
        edit_button = "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div/span[2]/button"
        done_button = "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div[1]/span[2]/button"
        print("Using new element definitions.")
    else:
        profile_menu = "/html/body/div[1]/div/div/div[3]/div/header/div/div/div/div/span/div/div[2]/div[2]/button"
        biotext_element = "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div/div/span/span"
        bio_input = "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div[1]/div[3]/div/div"
        edit_button = "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div/span[2]/button"
        done_button = "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div[1]/span[2]/button"
        print("Using old element definitions.")

"""Logout mechanism"""
def logout():
    if OLD_UI == False:
        driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/header/div/div[1]/div/div[1]/button").click()
        driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[3]/header/header/div/span/div/div[2]/button").click()
        time.sleep(0.1)
        driver.find_element(By.XPATH, "/html/body/div[1]/div/div/span[5]/div/ul/div/div[4]/li").click()
        time.sleep(0.2)
        driver.find_element(By.XPATH, "/html/body/div[1]/div/div/span[2]/div/div/div/div/div/div/div[2]/div/button[2]").click()
    else:
        driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/header/div/div/div/div/span/div/div[1]/div[1]/button").click()
        driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[3]/header/header/div/span/div/div[2]/button").click()
        time.sleep(0.1)
        driver.find_element(By.XPATH, "/html/body/div[1]/div/div/span[6]/div/ul/div/li[4]/div").click()
        time.sleep(0.2)
        driver.find_element(By.XPATH, "/html/body/div[1]/div/div/span[2]/div/div/div/div/div/div/div[2]/div/button[2]").click()

"""Initialize the Selenium WebDriver"""
def init_driver(debug=False, browser="chrome"):
    global driver
    browser = browser.lower()
    print(f"Initializing WebDriver for: {browser.capitalize()}")

    if browser == "chrome":
        chrome_options = ChromeOptions()
        if IS_LINUX:
             chrome_options.add_argument("--no-sandbox")
             if not debug:
                chrome_options.add_argument(f'user-agent={user_agent}')
                chrome_options.add_argument("--disable-blink-features=AutomationControlled")
                chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
                chrome_options.add_experimental_option('useAutomationExtension', False)
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        if not debug:
            chrome_options.add_argument("--headless")
        else:
            print("DEBUG enabled: Chrome window will be visible.")
        driver = webdriver.Chrome(options=chrome_options)

    elif browser == "edge":
        edge_options = EdgeOptions()
        if IS_LINUX:
            edge_options.add_argument("--no-sandbox")
            if not debug:
                chrome_options.add_argument(f'user-agent={user_agent}')
                chrome_options.add_argument("--disable-blink-features=AutomationControlled")
                chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
                chrome_options.add_experimental_option('useAutomationExtension', False)
        edge_options.add_argument("--disable-dev-shm-usage")
        edge_options.add_argument("--disable-gpu")
        if not debug:
            edge_options.add_argument("--headless")
        else:
            print("DEBUG enabled: Edge window will be visible.")
        driver = webdriver.Edge(options=edge_options)

    elif browser == "firefox":
        firefox_options = FirefoxOptions()
        if not debug:
            firefox_options.add_argument("--headless")
        else:
            print("DEBUG enabled: Firefox window will be visible.")
        driver = webdriver.Firefox(options=firefox_options)

    else:
        raise ValueError("Unsupported browser. Use 'chrome', 'edge', or 'firefox'.")

    driver.get("https://web.whatsapp.com/")
    driver.set_window_size(520, 850)

"""Initialize the Spotify client"""
def init_spotify_client():
    global sp
    config.read("config.ini")
    
    client_id = config.get("Spotify", "ClientID", fallback="")
    client_secret = config.get("Spotify", "ClientSecret", fallback="")
    redirect_uri = config.get("Spotify", "RedirectURI", fallback="http://localhost:6969/callback")
    SCOPE = "user-library-read user-read-playback-state user-read-currently-playing"
    
    if not client_id or not client_secret:
        print("Spotify API credentials are missing!")
        return

    sp = spotipy.Spotify(auth_manager=SpotifyOAuth(client_id=client_id, client_secret=client_secret, redirect_uri=redirect_uri, scope=SCOPE))

"""Get the current bio text"""
def get_bio_text():
    global biotext
    print("Getting bio text...")
    while True:
        try:
            driver.find_element(By.XPATH, profile_menu).click()
            time.sleep(0.5)
            biotext = driver.find_element(By.XPATH, biotext_element).text
            print(f"Current bio: {biotext}")
            break
        except NoSuchElementException:
            print("Bio element not found. Retrying...")
            time.sleep(1)

"""Restore the bio text to its original state"""
def restore_bio():
    print("\nRestoring bio...")
    if biotext:
        try:
            driver.find_element(By.XPATH, edit_button).click()
            time.sleep(0.2)
            driver.find_element(By.XPATH, bio_input).send_keys(Keys.CONTROL + "a")
            driver.find_element(By.XPATH, bio_input).send_keys(biotext)
            driver.find_element(By.XPATH, done_button).click()
            time.sleep(update_interval)
            print("\nLogging out of WhatsApp...")
            logout()
            while True:
                try:
                    driver.find_element(By.CLASS_NAME, "_akaz")
                    break
                except NoSuchElementException:
                    time.sleep(0.1)
        except Exception:
            pass

"""Fetch currently playing media information from Spotify"""
def get_spotify_media_info():
    if sp is None:
        init_spotify_client()

    current_track = sp.current_playback()
    if current_track is None or current_track.get('item') is None:
        return None

    track = current_track['item']
    title = track['name']
    artist = ', '.join([artist['name'] for artist in track['artists']])
    album = track['album']['name']
    is_playing = current_track['is_playing']

    if not is_playing:
        title += " (Paused)"

    return {
        'title': title,
        'artist': artist,
        'album': album
    }

async def get_media_info_windows():
    """Fetch media info on Windows using WinSDK."""
    sessions = await MediaManager.request_async()
    current_session = sessions.get_current_session()
    if current_session:
        info = await current_session.try_get_media_properties_async()
        info_dict = {
            "artist": info.artist,
            "title": info.title,
            "album": info.album_title,
            "track_number": info.track_number,
        }

        if current_session.get_playback_info().playback_status.name == "PAUSED":
            info_dict['title'] = f"{info_dict.get('title', 'Unknown Title')} (Paused)"
        return info_dict
    return None

def to_str(value):
    if hasattr(value, 'value'):
        value = value.value
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)

async def get_media_info_linux():
    try:
        bus = await MessageBus(bus_type=BusType.SESSION).connect()

        introspection_dbus = await bus.introspect('org.freedesktop.DBus', '/org/freedesktop/DBus')
        dbus_proxy = bus.get_proxy_object('org.freedesktop.DBus', '/org/freedesktop/DBus', introspection_dbus)
        dbus_interface = dbus_proxy.get_interface('org.freedesktop.DBus')
        all_service_names = await dbus_interface.call_list_names()

        for service in all_service_names:
            if service.startswith('org.mpris.MediaPlayer2.'):
                introspection_player = await bus.introspect(service, '/org/mpris/MediaPlayer2')
                proxy_object_player = bus.get_proxy_object(service, '/org/mpris/MediaPlayer2', introspection_player)
                properties_interface = proxy_object_player.get_interface('org.freedesktop.DBus.Properties')

                playback_status_variant = await properties_interface.call_get(
                    'org.mpris.MediaPlayer2.Player', 'PlaybackStatus')
                playback_status = playback_status_variant.value

                if playback_status not in ["Playing", "Paused"]:
                    continue

                metadata_variant = await properties_interface.call_get(
                    'org.mpris.MediaPlayer2.Player', 'Metadata')
                metadata = metadata_variant.value  # unwrap Variant here

                title = to_str(metadata.get('xesam:title', 'Unknown Title'))
                artist = to_str(metadata.get('xesam:artist', ['Unknown Artist']))
                album = to_str(metadata.get('xesam:album', 'Unknown Album'))
                track_number = metadata.get('xesam:trackNumber', 0)

                info_dict = {
                    "artist": artist,
                    "title": title,
                    "album": album,
                    "track_number": track_number,
                }

                if playback_status == "Paused":
                    info_dict['title'] = f"{info_dict['title']} (Paused)"

                return info_dict

        return None

    except Exception as e:
        print(f"Could not get media info from DBus: {e}")
        return None

async def get_media_info_unsupported():
    """Fallback for unsupported operating systems."""
    print("Local media info is not supported on this operating system.")
    await asyncio.sleep(3600)
    return None

# Cross-platform brooo
if IS_WINDOWS:
    get_local_media_info = get_media_info_windows
elif IS_LINUX:
    get_local_media_info = get_media_info_linux
else:
    get_local_media_info = get_media_info_unsupported

"""Background loop to update the WhatsApp bio."""
def update_bio_loop():
    previous_bio = None
    unchanged_count = 0
    while True:
        try:
            settings_updated_event.wait(timeout=get_update_interval()/2)
            source_changed_event.wait(timeout=get_update_interval()/2)
            settings_updated_event.clear()
            source_changed_event.clear()
        
            format_string = get_format_string()
            source = get_current_source()
            media = None
            if source == "local":
                media = asyncio.run(get_local_media_info())
            elif source == "spotify":
                media = get_spotify_media_info()

            if media:
                new_bio = format_string.replace("[artist]", media.get('artist', 'Unknown Artist')) \
                                       .replace("[title]", media.get('title', 'Unknown Title')) \
                                       .replace("[album]", media.get('album', 'Unknown Album')) \
                                       .replace("[tracknum]", str(media.get('track_number', ''))) \
                                       .replace("[bio]", biotext)
            else:
                new_bio = biotext
                
            if new_bio == previous_bio:
                unchanged_count += 1
                print(f"Bio hasn't changed. Skipping update... [{unchanged_count}]", end="\r")
                continue

            unchanged_count = 0
            print(f"\nUpdating bio to: {new_bio}")
            driver.find_element(By.XPATH, edit_button).click()
            time.sleep(0.2)
            driver.find_element(By.XPATH, bio_input).send_keys(Keys.CONTROL + "a")
            driver.find_element(By.XPATH, bio_input).send_keys(new_bio)
            driver.find_element(By.XPATH, done_button).click()

            previous_bio = new_bio
        except NoSuchElementException:
            print("Error updating bio. Retrying...")
            time.sleep(1)
        except Exception as e:
            print(f"An unexpected error occurred in update loop: {e}")

def attach_console():
    """Attach a console window for debugging on Windows."""
    if IS_WINDOWS and not sys.stdout:  # Check if the app is running without a console
        try:
            ctypes.windll.kernel32.AllocConsole()
            sys.stdout = open("CONOUT$", "w")  # Redirect stdout to the console
            sys.stderr = open("CONOUT$", "w")  # Redirect stderr to the console
        except Exception as e:
            print(f"Could not allocate console: {e}")

"""Main function"""
def main():
    global driver, update_interval, format_string

    parser = argparse.ArgumentParser(description="WAPresence Application")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode to open browser window and show logs")
    parser.add_argument("--browser", type=str, default="chrome", choices=["chrome", "edge", "firefox"],
                        help="Specify the browser to use (default: chrome)")
    args = parser.parse_args()
    if args.debug:
        attach_console()
        print("DEBUG enabled: Console attached.")

    init_driver(debug=args.debug, browser=args.browser)
    app = QApplication([])
    login_window = LoginWindow(driver)
    
    def on_login_complete():
        global OLD_UI
        try:
            print("Login complete. Closing LoginWindow and opening SettingsWindow.")
            login_window.close()
            time.sleep(0.1)
            try:
                if driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/header/div/div/div/div/span/div/div[2]/div[2]/button"):
                    print("Old UI detected.")
                    OLD_UI = True
            except NoSuchElementException:
                print("New UI detected.")
                OLD_UI = False
            
            print("Defining elements based on the UI type...")
            define_element()
            time.sleep(1)
            
            if not OLD_UI:
                try:
                    print("Closing the new look dialog if it exists...")
                    driver.find_element(By.XPATH, "/html/body/div[1]/div/div/span[2]/div/div/div/div/div/div/div[2]/div/button").click()
                except NoSuchElementException:
                    print("New look dialog not found, continuing.")
            
            get_bio_text()
            
            global settings_window
            settings_window = SettingsWindow(driver)
            settings_window.restore_bio_signal.connect(restore_bio)
            settings_window.show()
            print("SettingsWindow is now displayed.")

            bio_thread = threading.Thread(target=update_bio_loop, daemon=True)
            bio_thread.start()
            print("Started update_bio_loop in a background thread.")
        except Exception as e:
            print(f"Error in on_login_complete: {e}")

    login_window.login_complete.connect(on_login_complete)

    try:
        login_window.show()
        app.exec_()
    finally:
        print("Closing WebDriver...")
        driver.quit()

if __name__ == "__main__":
    main()