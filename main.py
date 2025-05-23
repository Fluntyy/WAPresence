import os
import time
import asyncio
import threading
from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import NoSuchElementException
from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as MediaManager
from PyQt5.QtWidgets import QApplication
from gui import LoginWindow, SettingsWindow  # Import GUI classes
from shared import get_update_interval, get_format_string, settings_updated_event, get_current_source, source_changed_event
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from configparser import ConfigParser
# import chromedriver_autoinstaller

# Global Variables
driver = None
biotext = ""
update_interval = 1
format_string = "Listening to [artist] - [title] | [bio]"
sp = None
config = ConfigParser()

"""Initialize the Selenium WebDriver"""
def init_driver():
    global driver
    chrome_options = Options()
    chrome_options.add_argument("--no-sandbox")  # Fix for crashing issues
    chrome_options.add_argument("--disable-dev-shm-usage")  # Fix for shared memory issues
    chrome_options.add_argument("--disable-gpu")  # Optional: Disable GPU acceleration
    chrome_options.add_argument("--headless")  # Optional: Run in headless mode
    driver = webdriver.Chrome(options=chrome_options)
    driver.get("https://web.whatsapp.com/")
    driver.set_window_size(520, 850)
    
"""Initialize the Spotify client"""
def init_spotify_client():
    global sp
    # Re-read the config file to get the latest values
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
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/header/div/div[2]/div/div[2]/button").click()
            time.sleep(0.5)
            biotext = driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div/div/span/span").text
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
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div/span[2]/button").click()
            time.sleep(0.2)
            bio_input = driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div[1]/div/div/div")
            bio_input.send_keys(Keys.CONTROL + "a")
            bio_input.send_keys(biotext)
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div[1]/span[2]/button").click()
            time.sleep(update_interval)
            print("\nLogging out of WhatsApp...")
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/header/div/div[1]/div/div[1]/button").click()
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[3]/header/header/div/span/div/div[2]/button").click()
            time.sleep(0.1)
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/span[5]/div/ul/div/div[4]/li").click()
            time.sleep(0.2)
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/span[2]/div/div/div/div/div/div/div[2]/div/button[2]").click()
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

"""Fetch currently playing media information from the local system"""
async def get_media_info():
    sessions = await MediaManager.request_async()
    current_session = sessions.get_current_session()
    if current_session:
        info = await current_session.try_get_media_properties_async()
        info_dict = {
            "artist": info.artist,
            "title": info.title,
            "album_title": info.album_title,
            "track_number": info.track_number,
        }

        if current_session.get_playback_info().playback_status.name == "PAUSED":
            info_dict['title'] = f"{info_dict.get('title', 'Unknown Title')} (Paused)"
        return info_dict
    return None

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

            source = get_current_source()
            if source == "local":
                media = asyncio.run(get_media_info())
            elif source == "spotify":
                media = get_spotify_media_info()

            if media:
                new_bio = format_string.replace("[artist]", media.get('artist', 'Unknown Artist')) \
                                       .replace("[title]", media.get('title', 'Unknown Title')) \
                                       .replace("[album]", media.get('album', 'Unknown Album')) \
                                       .replace("[tracknum]", str(media.get('track_number', 'Unknown Track Number'))) \
                                       .replace("[bio]", biotext)
            else:
                new_bio = biotext
                
            if new_bio == previous_bio:
                unchanged_count += 1
                print(f"Bio hasn't changed. Skipping update... [{unchanged_count}]", end="\r")
                continue

            unchanged_count = 0
            print(f"\nUpdating bio to: {new_bio}")
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div/span[2]/button").click()
            time.sleep(0.2)
            bio_input = driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div[1]/div/div/div")
            bio_input.send_keys(Keys.CONTROL + 'a')
            bio_input.send_keys(new_bio)
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div/div[2]/div[1]/span/div/div/span/div/div/div[4]/div[2]/div[1]/span[2]/button").click()

            previous_bio = new_bio
        except NoSuchElementException:
            print("Error updating bio. Retrying...")
            time.sleep(1)

"""Main function"""
def main():
    global driver, update_interval, format_string
    # chromedriver_autoinstaller.install()
    init_driver()

    app = QApplication([])

    # Show login window
    login_window = LoginWindow(driver)

    # Retain the SettingsWindow in memory
    def on_login_complete():
        try:
            print("Login complete. Closing LoginWindow and opening SettingsWindow.")
            login_window.close()  # Close the LoginWindow
            time.sleep(0.1)
            print("Closing the new look dialog...")
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/span[2]/div/div/div/div/div/div/div[2]/div/button").click()  # Close the "new look" dialog
            time.sleep(0.1)
            get_bio_text()
            global settings_window  # Make settings_window global to retain it in memory
            settings_window = SettingsWindow(driver)  # Create the SettingsWindow
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