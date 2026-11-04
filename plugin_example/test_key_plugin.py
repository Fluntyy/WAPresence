"""
WAPresence Plugin Test Client
Demonstrates sending custom keys, fields, and playback metadata to WAPresence.
"""

import sys
import json
import argparse
import requests

DEFAULT_URL = "http://127.0.0.1:6970"

def send_media(base_url: str, title: str, artist: str, album: str = "", track_num: int = 1, is_playing: bool = True, is_paused: bool = False, **custom_fields):
    url = f"{base_url.rstrip('/')}/api/media"
    payload = {
        "title": title,
        "artist": artist,
        "album": album,
        "track_number": track_num,
        "is_playing": is_playing,
        "is_paused": is_paused,
        **custom_fields
    }
    
    print(f"\n[+] Sending POST to {url}:")
    print(json.dumps(payload, indent=2))
    
    try:
        res = requests.post(url, json=payload, timeout=3)
        res.raise_for_status()
        data = res.json()
        print("\n[✓] Response from WAPresence:")
        print(json.dumps(data, indent=2))
        print("\nActive Placeholders in WAPresence:")
        for p in data.get("placeholders", []):
            print(f"  • {p}")
    except requests.exceptions.RequestException as e:
        print(f"\n[!] Error connecting to WAPresence at {url}: {e}")
        print("    Ensure WAPresence is running with media source set to 'Plugin'.")

def clear_media(base_url: str):
    url = f"{base_url.rstrip('/')}/api/clear"
    print(f"\n[+] Sending POST to {url} (restoring bio)...")
    try:
        res = requests.post(url, timeout=3)
        res.raise_for_status()
        print("[✓] Bio restored successfully:", res.json())
    except requests.exceptions.RequestException as e:
        print(f"[!] Error: {e}")

def get_status(base_url: str):
    url = f"{base_url.rstrip('/')}/api/status"
    try:
        res = requests.get(url, timeout=3)
        res.raise_for_status()
        print("[✓] Current WAPresence Plugin Status:")
        print(json.dumps(res.json(), indent=2))
    except requests.exceptions.RequestException as e:
        print(f"[!] Error: {e}")

def interactive_mode(base_url: str):
    print("=" * 60)
    print("  WAPresence Custom Key & Plugin Interactive Tester")
    print("=" * 60)
    print("Commands:")
    print("  1. Send sample track with custom fields ([app], [device], [genre])")
    print("  2. Send custom track with your own keys")
    print("  3. Toggle Pause (append pause emoji)")
    print("  4. Clear track (restore original WhatsApp bio)")
    print("  5. View status and active placeholders")
    print("  0. Exit")
    print("=" * 60)

    while True:
        try:
            choice = input("\nSelect option (0-5): ").strip()
            if choice == "0":
                break
            elif choice == "1":
                send_media(
                    base_url,
                    title="Starboy",
                    artist="The Weeknd",
                    album="Starboy",
                    track_num=1,
                    is_playing=True,
                    is_paused=False,
                    app="SoundCloud",
                    device="Pixel 9 Pro",
                    genre="R&B / Synth",
                    bitrate="320kbps",
                    mood="Energetic"
                )
            elif choice == "2":
                title = input("Track Title: ").strip() or "Custom Title"
                artist = input("Artist: ").strip() or "Custom Artist"
                album = input("Album: ").strip()
                custom_key = input("Custom Key Name (e.g. 'app', 'station', 'dj'): ").strip() or "source"
                custom_val = input(f"Value for [{custom_key}]: ").strip() or "Demo"
                extras = {custom_key: custom_val}
                send_media(base_url, title, artist, album, **extras)
            elif choice == "3":
                send_media(
                    base_url,
                    title="Starboy",
                    artist="The Weeknd",
                    album="Starboy",
                    is_playing=True,
                    is_paused=True,
                    app="SoundCloud",
                    device="Pixel 9 Pro"
                )
            elif choice == "4":
                clear_media(base_url)
            elif choice == "5":
                get_status(base_url)
            else:
                print("Invalid choice, select 0-5.")
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break

def main():
    parser = argparse.ArgumentParser(description="WAPresence Plugin Custom Key Client")
    parser.add_argument("--url", default=DEFAULT_URL, help=f"Plugin endpoint (default: {DEFAULT_URL})")
    parser.add_argument("--play", action="store_true", help="Send test track")
    parser.add_argument("--pause", action="store_true", help="Send paused test track")
    parser.add_argument("--clear", action="store_true", help="Clear media and restore WhatsApp bio")
    parser.add_argument("--status", action="store_true", help="Get plugin status and active placeholders")

    args = parser.parse_args()

    if args.play:
        send_media(args.url, "Midnight City", "M83", "Hurry Up", app="Foobar2000", device="Desktop PC", genre="Electronic")
    elif args.pause:
        send_media(args.url, "Midnight City", "M83", "Hurry Up", is_paused=True, app="Foobar2000", device="Desktop PC")
    elif args.clear:
        clear_media(args.url)
    elif args.status:
        get_status(args.url)
    else:
        interactive_mode(args.url)

if __name__ == "__main__":
    main()
