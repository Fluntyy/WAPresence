# WAPresence Python Plugin Examples

This folder contains Python scripts demonstrating how to interact with the WAPresence **Plugin** media source.

---

## Prerequisites

Install the `requests` library:

```bash
pip install requests
```

Make sure **WAPresence** is running and its media source is set to **Plugin** (configured on port `6970` by default).

---

## 1. `test_key_plugin.py` (Custom Keys & Interactive Tester)

Sends arbitrary custom fields and controls playback state:

```bash
# Run interactive menu to test custom keys and triggers
python test_key_plugin.py

# Or run with CLI flags:
python test_key_plugin.py --play
python test_key_plugin.py --pause
python test_key_plugin.py --clear
python test_key_plugin.py --status
```

Any custom field you send (such as `app`, `device`, `genre`, `bitrate`, `mood`) will automatically appear as a format placeholder in the WAPresence UI (e.g. `[app]`, `[device]`).

Example format string in WAPresence:
```
🎧 [title] - [artist] ([app] on [device])
```

---

## 2. `media_plugin.py` (Windows System Media Bridge)

Captures whatever music or video is currently playing on Windows (Spotify Desktop, YouTube in Chrome/Firefox/Edge, Media Player, Foobar2000, etc.) using Windows System Media Transport Controls (SMTC) and continuously forwards it to WAPresence:

```bash
python media_plugin.py
```

* When music plays or changes, WAPresence updates your WhatsApp bio.
* When music pauses, the pause indicator (`⏸️`) is handled.
* When playback stops or the player closes, WAPresence immediately restores your original WhatsApp bio.

---

## 3. `mobile_companion_mock.py` (Phone Companion Simulation)

Simulates a mobile app (e.g. Android `NotificationListenerService` or iOS Shortcut) sending music playing on your smartphone to your PC over your local Wi-Fi or VPN:

```bash
python mobile_companion_mock.py
```
