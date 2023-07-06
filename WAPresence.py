from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import NoSuchElementException, InvalidSessionIdException
import asyncio
from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as MediaManager
import winsdk.windows.media.core as core
import ctypes
import time
import sys
import threading
import os.path
from PyQt5 import QtWidgets
from PyQt5.QtWidgets import QMessageBox
from PyQt5.uic import *
from subprocess import CREATE_NO_WINDOW
from configparser import ConfigParser
config = ConfigParser()

ctypes.windll.kernel32.SetConsoleTitleW("WAPresence - Terminal")

chrome_service = ChromeService('chromedriver')
chrome_service.creation_flags = CREATE_NO_WINDOW

print("Opening Chrome")
driver = webdriver.Chrome(service=chrome_service)
driver.get("https://web.whatsapp.com/")
driver.set_window_size(520, 850)

app = None; widget = None; paused = False; biotext = ""

UpdateEvery = 1
SaveConfig = False
Format = "Listening to [artist] - [title] | [bio]"

def settingsgui():
    global widget; global app; global Format; global UpdateEvery
    print("Setting up PyQt5")
    app = QtWidgets.QApplication(sys.argv)
    widget = loadUi('settings.ui')
    print("Opening GUI")
    if os.path.isfile("config.ini") is True:
        print("config.ini detected!")
        widget.SaveConfigCheck.setChecked(True)
        config.read('config.ini')
        UpdateEvery = config.get('Configuration', 'UpdateEvery')
        Format = config.get('Configuration', 'Format')
        widget.UpdateEveryBox.setValue(int(UpdateEvery))
        widget.FormatTextBox.setText(Format)
    widget.ExitButton.clicked.connect(exitfunc)
    widget.SaveButton.clicked.connect(update)
    widget.show()
    sys.exit(app.exec_())
    
def exitfunc():
    if biotext == "":
        print("You are not logged in! Exiting.")
        driver.quit()
        app.quit()
        os._exit(0)
    else:
        try:
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div[1]/span/div/span/div/div/div[4]/div[2]/div/span[2]/button").click()
            time.sleep(0.2)
            driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(Keys.CONTROL + 'a')
            driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(biotext)
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div[1]/span/div/span/div/div/div[4]/div[2]/div/span[2]/button").click()
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[4]/header/div[2]/div/span/div[5]/div").click()
        except NoSuchElementException:
            print("Error restoring! Restarting...")
            exitfunc()
        finally:
            driver.quit()
            app.quit()
            os._exit(0)

def update():
    global UpdateEvery; global SaveConfig; global Format
    Format = widget.FormatTextBox.text()
    UpdateEvery = widget.UpdateEveryBox.text()
    SaveConfig = widget.SaveConfigCheck.isChecked()
    print(f"Update every {UpdateEvery} second(s), Save config is {SaveConfig}, and Format = '{Format}'")
    if SaveConfig is True:
        open("config.ini", "a")

        config.read('config.ini')
        if not config.has_section('Configuration'):
            config.add_section('Configuration')
        config.set('Configuration', 'UpdateEvery', str(UpdateEvery))
        config.set('Configuration', 'Format', Format)

        with open('config.ini', 'w') as f:
            config.write(f)
    else:
        if os.path.isfile("config.ini") is True:
            msgBox = QMessageBox()
            msgBox.setIcon(QMessageBox.Warning)
            msgBox.setText("You have a config.ini file. If you uncheck this, the file will be deleted.\nDo you want to proceed?")
            msgBox.setWindowTitle("Warning!")
            msgBox.setStandardButtons(QMessageBox.Ok | QMessageBox.Cancel)

            returnValue = msgBox.exec()
            if returnValue == QMessageBox.Ok:
                os.remove("config.ini")
            else:
                widget.SaveConfigCheck.setChecked(True)

async def get_media_info():
    # Copy pasted from https://stackoverflow.com/questions/65011660/how-can-i-get-the-title-of-the-currently-playing-media-in-windows-10-with-python
    sessions = await MediaManager.request_async()
    current_session = sessions.get_current_session()
    if current_session: 
        info = await current_session.try_get_media_properties_async()
        info_dict = {song_attr: info.__getattribute__(song_attr) for song_attr in dir(info) if song_attr[0] != '_'}
        info_dict['genres'] = list(info_dict['genres'])
        return info_dict

def app():
    global biotext
    while True:
        try:
            if "_64p9P" in driver.page_source:
                print("Getting bio text")
                driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[4]/header/div[1]/div").click()
                time.sleep(0.5)
                biotext = driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div[1]/span/div/span/div/div/div[4]/div[2]/div/div/span/span").text
                break
        except:
            pass
    
    def UpdateLoop():
        while True:
            try:
                media = asyncio.run(get_media_info())
                Bio = Format.replace("[artist]", media['artist']).replace("[title]", media['title']).replace("[album]", media['album_title']).replace("[tracknum]", str(media['track_number'])).replace("[bio]", biotext)
                driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div[1]/span/div/span/div/div/div[4]/div[2]/div/span[2]/button").click()
                time.sleep(0.2)
                try:
                    print(f"Changing Bio to '{Bio}'")
                    driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(Keys.CONTROL + 'a')
                    driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(Bio)
                except TypeError:
                    print(f"Changing Bio to '{biotext}'")
                    driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(Keys.CONTROL + 'a')
                    driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(biotext)
                driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div[1]/span/div/span/div/div/div[4]/div[2]/div/span[2]/button").click()
                time.sleep(int(UpdateEvery))
            except NoSuchElementException:
                print("Element not found. Retrying...")
                UpdateLoop()

    UpdateLoop()

thread1 = threading.Thread(target=settingsgui)
thread2 = threading.Thread(target=app)

thread1.start()
thread2.start()

thread1.join()
thread2.join()