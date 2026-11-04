"""
WAPresence Mobile Companion Simulator
Simulates a smartphone companion app (e.g. running on Android/iOS)
beaming mobile media playback across the local network to WAPresence.
"""

import time
import requests

WAPRESENCE_URL = "http://127.0.0.1:6970"

PLAYLIST = [
    {
        "title": "Starboy",
        "artist": "The Weeknd, Daft Punk",
        "album": "Starboy",
        "track_number": 1,
        "app": "Spotify Mobile",
        "device": "Google Pixel 9 Pro",
        "battery": "88%"
    },
    {
        "title": "Save Your Tears",
        "artist": "The Weeknd",
        "album": "After Hours",
        "track_number": 11,
        "app": "Apple Music iOS",
        "device": "iPhone 16 Pro",
        "battery": "94%"
    },
    {
        "title": "Levitating",
        "artist": "Dua Lipa",
        "album": "Future Nostalgia",
        "track_number": 5,
        "app": "YouTube Music",
        "device": "Galaxy S24 Ultra",
        "battery": "72%"
    }
]

def main():
    print("=" * 65)
    print("  WAPresence Mobile Companion App Simulation")
    print(f"  Target PC Host: {WAPRESENCE_URL}")
    print("  Demonstrating mobile -> desktop media syncing with custom fields.")
    print("=" * 65)

    for i, track in enumerate(PLAYLIST, 1):
        # 1. Start Playing
        print(f"\n[Phone] Playing track #{i}: {track['artist']} - {track['title']}")
        payload = {
            **track,
            "is_playing": True,
            "is_paused": False
        }
        try:
            res = requests.post(f"{WAPRESENCE_URL}/api/media", json=payload, timeout=2)
            print(f"  -> Beamed to WAPresence: HTTP {res.status_code}")
        except Exception as e:
            print(f"  -> Connection error: {e}")

        time.sleep(3)

        # 2. Simulate Pause
        print(f"[Phone] Pausing track #{i}...")
        payload["is_paused"] = True
        try:
            requests.post(f"{WAPRESENCE_URL}/api/media", json=payload, timeout=2)
        except Exception:
            pass

        time.sleep(2)

    # 3. Stop and clear
    print("\n[Phone] Playback session ended. Clearing bio...")
    try:
        requests.post(f"{WAPRESENCE_URL}/api/clear", timeout=2)
        print("[✓] WhatsApp bio restored to original text.")
    except Exception:
        pass

if __name__ == "__main__":
    main()
