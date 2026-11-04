# WAPresence Plugin & Webhook API

WAPresence includes a local loopback HTTP webhook server that allows third-party extensions, companion mobile apps (Android/iOS), CLI tools, and automation scripts to push media playback metadata directly into WAPresence, which formats and beams it to your WhatsApp About (bio) in real time.

---

## 1. Overview & Architecture

When **Plugin** is selected as the media source in WAPresence:
- WAPresence starts a lightweight HTTP server bound to `127.0.0.1` (default port: `6970`, customizable in **⚙️ Preferences**).
- CORS headers (`Access-Control-Allow-Origin: *`) are enabled so browser extensions (Chrome, Firefox, Safari) can send playback updates directly without cross-origin blocks.
- Arbitrary custom fields sent in payloads are automatically extracted into dynamic format placeholders (e.g. `[app]`, `[device]`) and surfaced in the WAPresence Settings UI.
- When media stops or is cleared, the original WhatsApp bio is restored.

---

## 2. HTTP Endpoints

Base URL: `http://127.0.0.1:6970` *(or configured port)*

### `POST /api/media`
Also accepts `POST /api/presence` or `POST /`.

Pushes current track metadata to WAPresence. If `is_playing` is true, WAPresence formats the About bio and pushes it to WhatsApp. If paused, it can append the `⏸️` indicator (if enabled in Preferences).

#### Request Headers
```http
Content-Type: application/json
```

#### Request Body Schema
| Field | Type | Description |
|---|---|---|
| `title` | `string` | Track or media title (e.g. `"Starboy"`) |
| `artist` | `string` | Artist or channel name (e.g. `"The Weeknd"`) |
| `album` | `string` | Album name or show title |
| `track_number` / `trackNumber` | `number \| string` | Track index / number |
| `is_playing` / `isPlaying` | `boolean` | `true` if active (default: `true`) |
| `is_paused` / `isPaused` | `boolean` | `true` if paused (appends `⏸️` if configured) |
| `fields` | `object` | Key-value dictionary of custom placeholders |
| *(any other key)* | `any` | Any top-level field is also treated as a custom placeholder! |

#### Example Payload with Custom Fields
```json
{
  "title": "Blinding Lights",
  "artist": "The Weeknd",
  "album": "After Hours",
  "track_number": 9,
  "is_playing": true,
  "is_paused": false,
  "app": "YouTube Music",
  "device": "Pixel 9 Pro"
}
```

#### Response
```json
{
  "success": true,
  "message": "Media updated",
  "track": {
    "title": "Blinding Lights",
    "artist": "The Weeknd",
    "album": "After Hours",
    "trackNumber": 9,
    "isPlaying": true,
    "isPaused": false,
    "customFields": {
      "app": "YouTube Music",
      "device": "Pixel 9 Pro"
    }
  },
  "placeholders": [
    "[artist]",
    "[title]",
    "[album]",
    "[tracknum]",
    "[bio]",
    "[app]",
    "[device]"
  ]
}
```

---

### `POST /api/clear`
Also accepts `POST /clear`.

Notifies WAPresence that playback has completely stopped. WAPresence clears the active track and restores the user's original WhatsApp About text.

#### Request Body
Empty or `{}`.

#### Response
```json
{
  "success": true,
  "message": "Media cleared, bio restored"
}
```

---

### `GET /api/status`
Also accepts `GET /status`.

Returns the current status of the plugin media source, active track, and all detected dynamic placeholders.

#### Response
```json
{
  "status": "online",
  "source": "Plugin",
  "current_track": {
    "title": "Blinding Lights",
    "artist": "The Weeknd",
    "album": "After Hours",
    "isPlaying": true,
    "isPaused": false
  },
  "placeholders": [
    "[artist]",
    "[title]",
    "[album]",
    "[tracknum]",
    "[bio]",
    "[app]",
    "[device]"
  ]
}
```

---

## 3. Dynamic Format Placeholders

In addition to standard placeholders:
- `[artist]`
- `[title]`
- `[album]`
- `[tracknum]`
- `[bio]` (the user's original WhatsApp bio)

Any property provided in `fields: { ... }` or at the root of the JSON payload becomes a valid placeholder:
- `{ "app": "SoundCloud" }` &rarr; use `[app]` in your format string
- `{ "device": "Galaxy S24" }` &rarr; use `[device]` in your format string
- `{ "genre": "Synthwave" }` &rarr; use `[genre]` in your format string

Example format string:
```
🎧 [title] - [artist] ([app] on [device])
```

---

## 4. Code Examples

### cURL
```bash
# Push media track
curl -X POST http://127.0.0.1:6970/api/media \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Midnight City",
    "artist": "M83",
    "album": "Hurry Up, We'\''re Dreaming",
    "is_playing": true,
    "app": "Foobar2000"
  }'

# Stop / Clear playback
curl -X POST http://127.0.0.1:6970/api/clear
```

### JavaScript / Browser Extension (Fetch)
```javascript
// Send current playback from a browser extension (e.g. YouTube Music, Soundcloud, Bandcamp)
async function reportMedia(title, artist, album, isPlaying, isPaused) {
  try {
    await fetch('http://127.0.0.1:6970/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        artist,
        album,
        is_playing: isPlaying,
        is_paused: isPaused,
        app: 'Web Browser'
      })
    });
  } catch (err) {
    console.error('WAPresence server unreachable:', err);
  }
}
```

### Python
```python
import requests

def update_wapresence(title, artist, album=None, is_playing=True, is_paused=False, **extras):
    payload = {
        "title": title,
        "artist": artist,
        "album": album or "",
        "is_playing": is_playing,
        "is_paused": is_paused,
        **extras
    }
    requests.post("http://127.0.0.1:6970/api/media", json=payload, timeout=2)

def clear_wapresence():
    requests.post("http://127.0.0.1:6970/api/clear", timeout=2)
```

---

## 5. Mobile Companion App Blueprint (Android / iOS)

A common use case is beaming media playing on your phone (e.g. Spotify on Android, Apple Music, YouTube Music) to your PC so your WhatsApp bio updates even when listening on mobile.

### Android Companion Implementation
1. **Media Detection**: Implement a `NotificationListenerService` or register a `MediaSessionManager.OnActiveSessionsChangedListener`.
2. **Metadata Extraction**:
   ```kotlin
   val metadata = session.metadata
   val title = metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)
   val artist = metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST)
   val album = metadata?.getString(MediaMetadata.METADATA_KEY_ALBUM)
   val isPlaying = session.playbackState?.state == PlaybackState.STATE_PLAYING
   val isPaused = session.playbackState?.state == PlaybackState.STATE_PAUSED
   ```
3. **Transport to PC**:
   - **Local Wi-Fi / LAN**: Send the HTTP POST directly to your PC's local LAN IP (e.g. `http://192.168.1.100:6970/api/media`).
   - **USB Cable / ADB**: Run `adb reverse tcp:6970 tcp:6970` on the PC, allowing the phone to send requests to `http://localhost:6970`.
   - **Tailscale / WireGuard**: If connected via VPN / Tailscale mesh, target the PC's 100.x Tailscale IP.
4. **Custom Placeholders**:
   Add `{ "device": Build.MODEL, "app": session.packageName }` to the POST body. In WAPresence, you can format it as:
   ```
   [artist] - [title] ([app] on [device])
   ```
