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
        "default_format": data.default_format,
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
