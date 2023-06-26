from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
import asyncio
from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as MediaManager
import ctypes
import time

ctypes.windll.kernel32.SetConsoleTitleW("WAPresence")

async def get_media_info():
    # Copy pasted from https://stackoverflow.com/questions/65011660/how-can-i-get-the-title-of-the-currently-playing-media-in-windows-10-with-python
    sessions = await MediaManager.request_async()
    current_session = sessions.get_current_session()
    if current_session: 
        info = await current_session.try_get_media_properties_async()
        info_dict = {song_attr: info.__getattribute__(song_attr) for song_attr in dir(info) if song_attr[0] != '_'}
        info_dict['genres'] = list(info_dict['genres'])
        return info_dict

print("Opening Chrome")
driver = webdriver.Chrome()
driver.get("https://web.whatsapp.com/")

while True:
    if "Search or" in driver.page_source:
            print("Getting bio text")
            driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[4]/header/div[1]/div").click()
            time.sleep(0.5)
            biotext = driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div[1]/span/div/span/div/div/div[4]/div[2]/div/div/span/span").text
            break

while True:
    driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div[1]/span/div/span/div/div/div[4]/div[2]/div/span[2]/button").click()
    time.sleep(0.2)
    try:
        current_media_info = asyncio.run(get_media_info())
        print(f"Changing Bio to 'Listening to {current_media_info['artist']} - {current_media_info['title']} | {biotext}'")
        driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(Keys.CONTROL + 'a')
        driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(f"Listening to {current_media_info['artist']} - {current_media_info['title']} | {biotext}")
    except TypeError:
        print(f"Changing Bio to '{biotext}'")
        driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(Keys.CONTROL + 'a')
        driver.find_element(By.CSS_SELECTOR, ".to2l77zo.gfz4du6o.ag5g9lrv.fe5nidar.kao4egtt").send_keys(f"{biotext}")
    driver.find_element(By.XPATH, "/html/body/div[1]/div/div/div[3]/div[1]/span/div/span/div/div/div[4]/div[2]/div/span[2]/button").click()
    time.sleep(1)
