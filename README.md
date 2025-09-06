# WAPresence
Show your **music information** in your **WhatsApp bio**

## Installation

### Method 1: Using the Installer
1. Download the installer from the [**releases page**](https://github.com/Fluntyy/WAPresence/releases/latest).
2. Run the installer and follow the on-screen instructions.
3. Once installed, open **WhatsApp** on your **phone**.
4. Follow these steps to link your device:
   - **Android**: Tap **⋮ (three dots)** > **Linked devices** > **Link a device**.
   - **iPhone**: Go to **Settings** > **Linked Devices** > **Link a Device**.
5. **Scan** the **QR Code** displayed on your **Computer**.
6. If there's media playing, **your WhatsApp bio will automatically update** within 1-2 seconds.

### Method 2: Manual Installation
First, **you need to** [**download Python**](https://www.python.org/downloads/) (if you haven't already).

1. Download the file [**here**](https://github.com/Fluntyy/WAPresence/releases/latest).
2. Open **Terminal** and type:
   ```
   $ pip install -r requirements.txt

   ```
3. **Open `index.py`** by double-clicking it or by typing:
   ```
   $ python index.py
   ```
   in the **Terminal**.
4. Open **WhatsApp** on your **phone**.
5. Follow these steps to link your device:
   - **Android**: Tap **⋮ (three dots)** > **Linked devices** > **Link a device**.
   - **iPhone**: Go to **Settings** > **Linked Devices** > **Link a Device**.
6. **Scan** the **QR Code** displayed on your **Computer**.

Once linked, if there's media playing, **your WhatsApp bio will automatically update** within 1-2 seconds.

## Media Source Definitions

WAPresence can pull media information from three types of sources: **Local**, **Spotify**, and **Plugins**.

### Local

The "Local" source option retrieves media information directly from your computer. The method varies depending on your operating system:

  * **Windows:** Utilizes the **Global System Media Transport Controls (SMTC)**. This allows it to capture media information universally from most applications that support media key integration, including web browsers (like YouTube), Spotify's desktop app, VLC, and others.
  * **Linux:** Uses the **Media Player Remote Interfacing Specification (MPRIS)** via D-Bus. This is a standard protocol for controlling media players on Linux desktops. Any application that supports MPRIS can have its media information displayed (e.g., VLC, Rhythmbox, Spotify). You may need to enable this feature in your media player's settings.

### Spotify

The "Spotify" source option connects directly to your Spotify account using the official **Spotify Web API**.

  * **Authentication:** You will be asked to authorize the application with your Spotify account. To do this, you first need to configure your own credentials.
  * **Setup:** For instructions on how to get your credentials, please follow the [**Guide to Creating a Spotify Developer Application**](Spotify_Guide.md).
  * **Cross-Device Functionality:** Because it uses the API, it can detect and display what you're listening to on **any device** logged into your Spotify account, including your phone, smart speaker, or computer.

### Plugins

The "Plugin" source option allows **third-party modules** to feed activity or media data into WAPresence.  
Plugins provide maximum flexibility by letting you define custom activities beyond local or Spotify playback (e.g., VS Code file editing, Minecraft server info, or even another music player).

A plugin communicates with WAPresence by sending a JSON-like payload with the following fields:

```json
{
  "app": "Spotify",
  "type": "media",
  "default_format": "{artist} - {title}",
  "activity": {
    "artist": "Rick Astley",
    "title": "Never Gonna Give You Up",
    "album": "Whenever You Need Somebody",
    "track_number": 1,
    "status": "playing"
  }
}
```

-   **app** → The name of the application or source (e.g., `"Spotify"`, `"VS Code"`, `"Minecraft"`).

-   **type** → The category of activity (e.g., `"media"`, `"app"`, `"game"`).
    
-   **default_format** → A string template showing how the activity should be displayed, with placeholders referencing keys in `activity`.
    
-   **activity** → A dictionary of dynamic values describing the current state (e.g., track info, file path, server IP, status).

If you want to create your own plugin, check out the [**Plugin Creation Guide**](Plugin_Guide.md).
For examples, see the [`/plugins`](https://github.com/WAPresence/tree/main/plugins) folder in this repository.