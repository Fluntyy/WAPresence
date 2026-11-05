# WAPresence (TypeScript / Electron Edition)

WAPresence is a cross-platform desktop application built with **TypeScript**, **Node.js 22 LTS**, and **Electron** that automatically displays what you are currently listening to in your WhatsApp "About" (status/bio) text, and reliably restores your original bio when exiting.

---

## 1. Why Baileys Fork is Required

Upstream `@whiskeysockets/baileys` (v7.0.0-rc.9 on npm) updates only the legacy status stanza (`<iq xmlns="status">...`), which leaves the modern visible WhatsApp About completely unchanged.

This project uses WhiskeySockets/Baileys PR #2798 by `crowroser`:
- **Repository**: [https://github.com/crowroser/Baileys](https://github.com/crowroser/Baileys)
- **Branch**: `fix/update-profile-status-about`
- **Pinned Commit SHA**: `7fadfe38a01fc4ad0102e008c5007e7f5c940851`

### Installation Method
Because upstream git dependencies do not commit the compiled `lib/` directory and pnpm isolates dependency builds, installing directly via git URL fails without a prior compile step. The reliable working installation method:
1. Clone the fork locally into `../Baileys` on branch `fix/update-profile-status-about`.
2. Build the fork: `pnpm run build` (or `tsc -p ./tsconfig.json`).
3. Install into WAPresence via local package path:
   ```bash
   pnpm add @whiskeysockets/baileys@file:../Baileys
   ```

---

## 2. Modern WhatsApp About Behavior

- **Modern About Mutation**: The fork executes the modern WhatsApp GraphQL MEX mutation (`xwa2_update_text_status`), followed by a legacy status stanza as fallback.
- **50-Character Text Limit**: The modern About has a strict **50-character limit**. Texts exceeding 50 characters are cleanly truncated to 47 characters with an appended ellipsis (`...`).
- **Emoji Field**: The emoji is sent as a distinct GraphQL input field (`mexInput.emoji.content`) and **does NOT count towards the 50-character limit** in the modern About. (Note: The fallback legacy status stanza concatenates them with a space).
- **Ephemeral Duration & Expiry**: WhatsApp treats modern text status as an ephemeral note. When text is non-empty, the duration cannot be 0 and defaults to 24 hours (86,400 seconds). WAPresence's update loop continually refreshes this while music plays so your About does not expire.
- **Strict Verification Step**: After every About update, WAPresence queries the WhatsApp server with `fetchTextStatus(ownJid)` and compares the returned text against the expected value. The application never reports "updated" based on promise resolution alone. If a mismatch occurs, the update loop backs off exponentially (2s → 4s → 8s up to 30s) and displays an alert banner in the Settings UI. A manual **"Verify now"** button is also provided.

---

## 3. Media Sources

| Source | Platform | Implementation Details |
|---|---|---|
| **Local Media** | **Windows** | Global System Media Transport Controls (SMTC) via WinRT. Uses a lightweight helper process (`smtc-helper.ps1`) communicating over JSON-lines IPC. Appends ` ⏸️` to the title when paused. |
| **Local Media** | **Linux** | MPRIS over session D-Bus (`org.mpris.MediaPlayer2.*`) using `dbus-next`. Monitors `PropertiesChanged` and `NameOwnerChanged`. Appends ` ⏸️` to the title when paused. |
| **Local Media** | **macOS** | Local media is not supported on macOS; displays a helpful notice while allowing Spotify mode. |
| **Spotify** | **Cross-Platform** | Spotify Web API with **PKCE** (Proof Key for Code Exchange). Requires **no client secret**. Uses loopback redirection (`http://127.0.0.1:6969/callback`). Respects HTTP 429 `Retry-After` headers and appends ` (Paused)` when paused. Tokens are stored in the OS AppData directory. |

---

## 4. Crash-Resilient Bio Restoration

1. On initial login, your original WhatsApp About text is retrieved via `fetchTextStatus` and recorded to `original_bio.json` in your OS AppData directory with `restored: false`.
2. When the app exits normally (Settings "Exit", Tray "Quit", or OS signals `SIGINT`/`SIGTERM`), the original bio is restored to WhatsApp and marked `restored: true`.
3. If an unexpected power loss or process kill occurs while music is playing, the un-restored bio is detected on the next launch and safely restored.
4. Normal exit does **not** log out of WhatsApp, preserving your session. An explicit **"Log out WhatsApp"** button and tray menu item are available to unlink your device when desired.

---

## 5. Format Placeholders

In Settings, you can configure your presence string using the following placeholders:

| Placeholder | Replaced With |
|---|---|
| `[artist]` | Artist name (default: "Unknown Artist") |
| `[title]` | Track title (with ` ⏸️` or `(Paused)` when paused) |
| `[album]` | Album name (default: "Unknown Album") |
| `[tracknum]` | Track number (or empty string if unavailable) |
| `[bio]` | Your original WhatsApp bio before starting the app |

> **Note**: A live character counter (`X/50`) updates in real time as you edit the format string in Settings.

---

## 6. Configuration & Storage Locations

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

## 7. Development & Build

> **Rule**: Always use `pnpm` instead of `npm`.

### Run Tests
```bash
pnpm test
```

### Build Application
```bash
pnpm run build
```

### Start Electron App
```bash
pnpm start
```

### Package Distributables
```bash
pnpm run pack
# or create installers:
pnpm run dist
```
