### this works by a mobile client sending a request to the ntfy server
### then this "plugin" receives the request and sends it to wapresence
### by using this, you don't have to do port forwarding or anything like that
### the mobile client is still a wip, but you get the idea

import requests
import json
import sys
import time
from colorama import init, Fore
init(autoreset=True)

def get_latest(username):
    url = f"https://ntfy.sh/wapresence--{username}/json?poll=1&since=latest"
    try:
        r = requests.get(url, timeout=5)
        for line in r.iter_lines():
            if line:
                data = json.loads(line.decode("utf-8"))
                if data.get("event") == "message":
                    return data.get("message", "")
    except:
        return ""
    return ""

def get_status(state):
    if state == "paused":
        return " ⏸️"
    elif state == "stopped":
        return " ⏹️"
    elif state == "playing":
        return ""
    else:
        return state

def parse_message(message):
    if message == "__empty__||__empty__||__empty__||__empty__||__empty__":
        return {
            "app": "Mobile Music",
            "type": "media",
            "default_format": "Playing [artist] - [title][emoji]",
            "activity": {
                "title": "",
                "artist": "",
                "album": "",
                "track": "",
                "emoji": "😴",
            }
        }

    parts = message.split("||")
    if len(parts) == 5:
        artist, title, album, track, status = parts
        return {
            "app": "Mobile Music",
            "type": "media",
            "default_format": "Playing [artist] - [title][emoji]",
            "activity": {
                "title": title,
                "artist": artist,
                "album": album,
                "track": track,
                "emoji": get_status(status.lower())
            }
        }
    else:
        return None

def send_to_wapresence(payload):
    try:
        res = requests.post("http://localhost:6969/update", json=payload, timeout=3)
        if res.status_code != 200:
            print(Fore.RED + f"Failed to send to WAPresence: {res.status_code}")
    except Exception as e:
        print(Fore.RED + f"Error sending to WAPresence: {e}")

def print_music_info(activity, clear_previous=False):
    if clear_previous:
        for _ in range(5):
            sys.stdout.write("\033[F\033[K")
        sys.stdout.flush()

    if not activity or activity["emoji"] == "😴":
        print(Fore.YELLOW + "No music playing. 😴")
        return

    print(Fore.CYAN + f"🎤 Artist: {Fore.WHITE}{activity['artist']}")
    print(Fore.MAGENTA + f"🎵 Title: {Fore.WHITE}{activity['title']}")
    print(Fore.BLUE + f"💿 Album: {Fore.WHITE}{activity['album']}")
    print(Fore.GREEN + f"🔢 Track: {Fore.WHITE}#{activity['track']}")
    status_color = Fore.RED if activity["emoji"].lower() == "⏸️" else Fore.GREEN
    print(status_color + f"🎶 Status: {activity['emoji']}")

def listen(username, initial_message):
    url = f"https://ntfy.sh/wapresence--{username}/json"
    last_message = initial_message

    try:
        with requests.get(url, stream=True) as response:
            for line in response.iter_lines():
                if line:
                    try:
                        data = json.loads(line.decode("utf-8"))
                        if data.get("event") == "message":
                            message = data.get("message", "")
                            if message != last_message:
                                last_message = message

                                payload = parse_message(message)
                                if payload:
                                    print_music_info(payload["activity"], clear_previous=True)
                                    send_to_wapresence(payload)
                                else:
                                    print(Fore.RED + "Invalid message format received.")
                    except json.JSONDecodeError:
                        continue
    except KeyboardInterrupt:
        print("\nStopped by user with Ctrl+C.")
    except Exception as e:
        print(Fore.RED + f"Error: {e}")

if __name__ == "__main__":
    username = input("🎧 What's the username you want to listen to: ").strip()
    if not username:
        print(Fore.RED + "Username cannot be empty.")
        exit(1)

    print(Fore.CYAN + f"\n🔊 Listening to ntfy topic: {username}")

    latest = get_latest(username)
    if latest:
        payload = parse_message(latest)
        if payload:
            print_music_info(payload["activity"])
            send_to_wapresence(payload)
        else:
            print(Fore.RED + "Invalid message format.")
    else:
        print(Fore.YELLOW + "No recent message found.")

    try:
        listen(username, latest)
    except KeyboardInterrupt:
        print("\nStopped")
