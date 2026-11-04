"""
WAPresence Media Bridge Plugin
Fetches the currently playing song from Windows System Media Transport Controls (SMTC)
and forwards it to WAPresence via the Plugin Webhook HTTP API.
"""

import sys
import time
import json
import subprocess
import requests

WAPRESENCE_URL = "http://127.0.0.1:6970"
POLL_INTERVAL_SECONDS = 2.0

PS_SCRIPT = """
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media, ContentType = WindowsRuntime] | Out-Null

try {
    $asyncOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $mgr = Await $asyncOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $session = $mgr.GetCurrentSession()

    if ($null -eq $session) {
        Write-Output '{"has_media": false}'
        exit
    }

    $info = $session.GetPlaybackInfo()
    $status = $info.PlaybackStatus.ToString()

    $propAsync = $session.TryGetMediaPropertiesAsync()
    $props = Await $propAsync ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])

    $sourceAppId = $session.SourceAppUserModelId

    $res = [PSCustomObject]@{
        has_media     = $true
        title         = $props.Title
        artist        = $props.Artist
        album         = $props.AlbumTitle
        track_number  = $props.TrackNumber
        status        = $status
        app_id        = $sourceAppId
    }

    $res | ConvertTo-Json -Compress
} catch {
    Write-Output '{"has_media": false}'
}
"""

def get_current_system_media():
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT],
            capture_output=True,
            text=True,
            timeout=5
        )
        out = proc.stdout.strip()
        if not out:
            return None
        data = json.loads(out)
        if not data.get("has_media"):
            return None
        return data
    except Exception as e:
        return None

def main():
    print("=" * 65)
    print("  WAPresence System Media Forwarder (Plugin Reference)")
    print(f"  Forwarding Windows media playback -> {WAPRESENCE_URL}")
    print("  Press Ctrl+C to stop.")
    print("=" * 65)

    last_signature = None

    while True:
        try:
            media = get_current_system_media()

            if media and media.get("title"):
                status = media.get("status", "Playing")
                is_playing = status in ("Playing", "Paused")
                is_paused = (status == "Paused")

                signature = f"{media.get('title')}|{media.get('artist')}|{status}"

                if signature != last_signature:
                    last_signature = signature
                    app_name = (media.get("app_id") or "Media Player").split("!")[-1].split(".exe")[0]

                    payload = {
                        "title": media.get("title", ""),
                        "artist": media.get("artist", ""),
                        "album": media.get("album", ""),
                        "track_number": media.get("track_number", 0),
                        "is_playing": is_playing,
                        "is_paused": is_paused,
                        "app": app_name,
                        "device": "PC"
                    }

                    print(f"[*] Track update: {payload['artist']} - {payload['title']} [{status}] ({app_name})")
                    try:
                        res = requests.post(f"{WAPRESENCE_URL}/api/media", json=payload, timeout=2)
                        if res.ok:
                            print(f"    [✓] Synced with WAPresence")
                        else:
                            print(f"    [!] Error response: {res.status_code}")
                    except requests.exceptions.RequestException as e:
                        print(f"    [!] WAPresence server not reachable on {WAPRESENCE_URL}")
            else:
                if last_signature is not None:
                    last_signature = None
                    print("[*] Playback stopped. Clearing WAPresence bio...")
                    try:
                        requests.post(f"{WAPRESENCE_URL}/api/clear", timeout=2)
                        print("    [✓] Bio restored")
                    except requests.exceptions.RequestException:
                        pass

            time.sleep(POLL_INTERVAL_SECONDS)

        except KeyboardInterrupt:
            print("\nStopping forwarder. Restoring bio...")
            try:
                requests.post(f"{WAPRESENCE_URL}/api/clear", timeout=2)
            except Exception:
                pass
            break
        except Exception as e:
            time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()
