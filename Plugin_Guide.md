# Plugin Creation Guide

This guide shows how to build a simple WAPresence **Plugin** that sends activity data to the local API (`127.0.0.1:6969`).  
Plugins let you feed **media**, **game**, or **app** activity into WAPresence using a tiny HTTP server.

> For examples, see the [`/plugins`](https://github.com/Fluntyy/WAPresence/tree/main/plugins) folder in this repository.

---

## What a Plugin Is

A plugin is **any process** that can POST a JSON payload to WAPresence's local API.  
The core expects a unified payload shape:

```json
{
  "app": "YourAppName",
  "type": "media | game | app",
  "default_format": "{artist} - {title}",
  "activity": { "artist": "Rick Astley", "title": "Never Gonna Give You Up", "status": "playing" },
  "timestamp": 1724399999.123
}

```

-   **app**: Display name of the source (e.g., `"Spotify"`, `"VS Code"`, `"Minecraft"`).
    
-   **type**: One of `"media"`, `"game"`, or `"app"`.
    
-   **default_format**: A template string referencing keys inside `activity`.
    
-   **activity**: A dictionary with dynamic values (track info, file path, server IP, status, etc.).
    
-   **timestamp** _(optional)_: Unix epoch (float). If omitted, the plugin server will set it.
    

WAPresence displays activity according to `default_format` and only pushes updates when it detects a change.

----------

## Reference Plugin (FastAPI)

Below is the reference plugin server (the same as in this repo), which exposes two endpoints:

-   `POST /update` — send new presence data
    
-   `GET /current` — read the latest presence snapshot
    

```py
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, Dict, Any
import threading
import uvicorn
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

current_presence: Dict[str, Any] = {}

class PresencePayload(BaseModel):
    app: str
    type: str  # example: "media", "game", "app"
    default_format: str
    activity: Dict[str, Any]
    timestamp: Optional[float] = None

@app.post("/update")
async def update_presence(data: PresencePayload):
    data.timestamp = data.timestamp or time.time()
    
    payload = {
        "app": data.app,
        "type": data.type,
        "activity": data.activity,
        "timestamp": data.timestamp,
        "default_format": data.default_format
    }

    global current_presence
    current_presence = payload
    return {"message": "Presence updated", "data": current_presence}

@app.get("/current")
async def get_current_presence():
    return current_presence or {"message": "No presence data yet."}

def start_server():
    uvicorn.run("plugin_server:app", host="127.0.0.1", port=6969, reload=True)
    
if __name__ == "__main__":
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    print("API server running in background thread")

```

### Endpoint Behavior

-   `POST /update`
    
    -   Validates the payload.
        
    -   If `timestamp` is absent, it populates with `time.time()`.
            
    -   Stores the latest payload in memory.
        
-   `GET /current`
    
    -   Returns the last stored payload (or a simple “No presence data yet.” message if there's no presence running).
        

----------

## Quick Start

### Requirements

-   Python 3.9+
    
-   `fastapi`, `uvicorn`
    

```bash
pip install fastapi uvicorn

```

### Running

Save the server as `plugin_server.py` and run your plugin process:

```bash
python plugin_server.py

```

By default it serves on **`http://127.0.0.1:6969`** with CORS enabled (for OBS overlay / web dashboards).

----------

## Posting Data

### cURL

```bash
curl -X POST http://127.0.0.1:6969/update \
  -H "Content-Type: application/json" \
  -d '{
    "app": "Spotify",
    "type": "media",
    "default_format": "{artist} - {title}",
    "activity": {
      "artist": "Toby Fox",
      "title": "MEGALOVANIA",
      "status": "playing"
    }
  }'

```

### JavaScript (Browser/Node)

```js
await fetch("http://127.0.0.1:6969/update", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    app: "VS Code",
    type: "app",
    default_format: "{filename} — {language}",
    activity: { filename: "main.py", language: "Python", status: "editing" }
  })
});

```

### Python

```py
import requests

payload = {
  "app": "Minecraft",
  "type": "game",
  "default_format": "{server} — {players} players",
  "activity": { "server": "play.example.net", "players": 12, "status": "online" }
}

r = requests.post("http://127.0.0.1:6969/update", json=payload)
print(r.json())

```

----------

## Reading Data (for Overlays/Dashboards)

```bash
curl http://127.0.0.1:6969/current

```

Typical response:

```json
{
  "app": "Spotify",
  "type": "media",
  "activity": {
    "artist": "Toby Fox",
    "title": "MEGALOVANIA",
    "status": "playing"
  },
  "timestamp": 1724399999.123,
  "default_format": "{artist} - {title}"
}

```

> Because CORS is enabled (`allow_origins=["*"]`), browser UIs (OBS overlays, local dashboards) can fetch `/current` directly.  

----------

## Recommended Activity Keys

These aren't strict, but common keys help consistency across plugins:

### Media

-   `artist`, `title`, `album`, `track_number`, `status` (`playing`, `paused`, `stopped`), `duration`, `position`
    

### Game

-   `server`, `mode`, `map`, `players`, `rank`, `status` (`online`, `offline`, `in_match`)
    

### App / IDE

-   `filename`, `language`, `project`, `branch`, `status` (`editing`, `building`, `debugging`)
    

----------

## Formatting Tips

-   `default_format` uses Python's `str.format` with keys from `activity`.
    
    -   Example: `"{artist} - {title}"` needs `activity.artist` and `activity.title`.
        
-   If a key is missing, the server won't crash, but the formatted string is considered invalid:
    
    -   `"[Invalid format: missing key 'artist']"`34

----------

## Update Strategy

-   Send updates **only when something changes** (track switch, status change, file change, etc.).
    
-   Avoid spamming the endpoint; a 1-2s debounce is usually enough for most activities.
    
-   WAPresence already ignores identical payloads to reduce noise.
    

----------

## Troubleshooting

-   **CORS errors in browser**: ensure you're calling `http://127.0.0.1:6969` (not `localhost` if your app enforces a strict origin) and that CORS is allowed.
    
-   **“Invalid format: missing key”**: your `default_format` references a key that isn't in `activity`.
    
-   **No data at `/current`**: call `/update` at least once, or check that your plugin is running and reachable.
    
-   **Port in use**: change the port (e.g., `6970`) in `uvicorn.run`.