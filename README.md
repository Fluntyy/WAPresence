# WAPresence

WAPresence is a cross-platform desktop application built with TypeScript, Node.js, and Electron that automatically synchronizes your current media playback with your WhatsApp "About" (status/bio) text in real time.

---

## Features

- **Real-Time Bio Synchronization**: Automatically broadcasts your active track title, artist, and album directly to your WhatsApp profile status.
- **Multiple Media Sources**:
  - **Local Media (Windows)**: Integrates directly with Windows System Media Transport Controls (SMTC) via WinRT, capturing playback from Spotify, Apple Music, Tidal, foobar2000, web browsers, and media players.
  - **Local Media (Linux)**: Native MPRIS integration over session D-Bus supporting all standard Linux desktop media players.
  - **Spotify Web API**: Cross-platform support using the Spotify Web API with PKCE OAuth flow (no client secret required).
  - **Plugin Webhook API**: Built-in local HTTP server allowing companion apps, browser extensions, and scripts to push custom playback metadata.
- **Custom Bio Formatting**: Customize presence strings with dynamic placeholders (`[artist]`, `[title]`, `[album]`, `[tracknum]`, `[bio]`) and live character counter tracking WhatsApp's 50-character limit.
- **Smart Pause Handling**: Automatically detects paused playback and optionally appends a pause indicator.
- **Material Design 3 Interface**: Modern UI built with Google Material Design 3 web components, dynamic color scheme generation, and support for Light, Dark, or System theme.
- **Single-Instance & System Tray Integration**: Runs discreetly in the background, minimizing to the system tray with memory reclamation and instant window restoration.
- **Server-Side Verification**: Verifies status updates directly with WhatsApp servers and applies exponential backoff during network or rate-limit events.
- **Launch with OS**: Optional autostart on system boot, starting silently in the system tray.
- **Automatic Updates**: Built-in update checker powered by GitHub Releases with one-click installation.

---

## Why Baileys Fork is Required

Upstream `@whiskeysockets/baileys` (v7.0.0-rc.9 on npm) updates only the legacy status stanza (`<iq xmlns="status">...`), leaving the modern visible WhatsApp About unchanged.

This project uses WhiskeySockets/Baileys PR #2798 by `crowroser`:
- **Repository**: [https://github.com/crowroser/Baileys](https://github.com/crowroser/Baileys)
- **Branch**: `fix/update-profile-status-about`
- **Pinned Commit SHA**: `7fadfe38a01fc4ad0102e008c5007e7f5c940851`

> **Note**: This fork is not official and is maintained separately. It is required to support WhatsApp's GraphQL MEX status mutation.

### Building from Source
For complete, step-by-step instructions on setting up your directory structure and compiling both repositories from source, see **[BUILDING.md](BUILDING.md)**.

---

## Modern WhatsApp About Behavior

- **Modern About Mutation**: The fork executes the modern WhatsApp GraphQL MEX mutation (`xwa2_update_text_status`), followed by a legacy status stanza as fallback.
- **50-Character Text Limit**: The modern About has a strict **50-character limit**. Texts exceeding 50 characters are cleanly truncated to 47 characters with an appended ellipsis (`...`).
- **Emoji Field**: The emoji is sent as a distinct GraphQL input field (`mexInput.emoji.content`) and does not count towards the 50-character limit in the modern About.
- **Ephemeral Duration & Expiry**: WhatsApp treats modern text status as an ephemeral note. When text is non-empty, the duration defaults to 24 hours (86,400 seconds). WAPresence continually refreshes this while music plays so your About does not expire.
- **Strict Verification Step**: After every About update, WAPresence queries the WhatsApp server with `fetchTextStatus(ownJid)` and compares the returned text against the expected value. If a mismatch occurs, the update loop backs off exponentially (2s -> 4s -> 8s up to 30s) and displays an alert banner in the Settings UI. A manual **"Verify now"** button is also provided.

---

## Media Sources

| Source | Platform | Implementation Details |
|---|---|---|
| **Local Media** | **Windows** | Global System Media Transport Controls (SMTC) via WinRT. Uses a lightweight helper process (`smtc-helper.ps1`) communicating over JSON-lines IPC. Appends a pause indicator when paused. |
| **Local Media** | **Linux** | MPRIS over session D-Bus (`org.mpris.MediaPlayer2.*`) using `dbus-next`. Monitors `PropertiesChanged` and `NameOwnerChanged`. Appends a pause indicator when paused. |
| **Local Media** | **macOS** | Local media capture is not supported on macOS; displays a notice while allowing Spotify and Plugin modes. |
| **Spotify** | **Cross-Platform** | Spotify Web API with PKCE (Proof Key for Code Exchange). Requires no client secret. Uses loopback redirection (`http://127.0.0.1:6969/callback`). Respects HTTP 429 `Retry-After` headers. Tokens are securely stored in the OS AppData directory. |
| **Plugin** | **Cross-Platform** | Local HTTP webhook server (`http://127.0.0.1:6970`). Accepts JSON playback payloads from browser extensions, companion apps, or scripts. See [PLUGIN_API.md](PLUGIN_API.md) for full specification. |

---

## Bio Restoration

1. On initial login, your original WhatsApp About text is retrieved via `fetchTextStatus` and recorded to `original_bio.json` in your OS AppData directory with `restored: false`.
2. When the app exits normally (Settings "Exit", Tray "Quit", or OS signals `SIGINT`/`SIGTERM`), your original bio is restored to WhatsApp and marked `restored: true`.
3. If an unexpected power loss or process termination occurs while music is playing, the unrestored bio is detected on the next launch and safely restored.
4. Normal exit does not log out of WhatsApp, preserving your credentials. An explicit **"Log out WhatsApp"** action is available to unlink your session when desired.

---

## Format Placeholders

In Settings, you can configure your presence string using the following placeholders:

| Placeholder | Replaced With |
|---|---|
| `[artist]` | Artist name (default: "Unknown Artist") |
| `[title]` | Track title (with pause indicator when paused) |
| `[album]` | Album name (default: "Unknown Album") |
| `[tracknum]` | Track number (or empty string if unavailable) |
| `[bio]` | Your original WhatsApp bio before starting the app |

> **Note**: A live character counter (`X/50`) updates in real time as you edit the format string in Settings.

---

## Configuration & Storage Locations

- **`config.ini`**: Stored in the application directory:
  ```ini
  [Configuration]
  UpdateEvery = 1
  Format = Listening to [artist] - [title]
  Source = Local

  [Spotify]
  ClientID = your_client_id
  RedirectURI = http://127.0.0.1:6969/callback
  ```
- **App Data Directory**:
  - Windows: `%APPDATA%\WAPresence`
  - Linux: `~/.config/WAPresence`
  - macOS: `~/Library/Application Support/WAPresence`
  - Contains: `baileys_auth/` (credentials), `original_bio.json`, `spotify_tokens.json`, and `wapresence.log`.

---

## Development & Build

You can use any Node.js package manager (`npm`, `pnpm`, or `yarn`).

### Install Dependencies
```bash
npm install
# or: pnpm install / yarn install
```

### Run Tests
```bash
npm test
# or: pnpm test / yarn test
```

### Build Application
```bash
npm run build
# or: pnpm run build / yarn build
```

### Start Electron App
```bash
npm start
# or: pnpm start / yarn start
```

### Package Distributables
```bash
npm run pack
# or create installers:
npm run dist
```
