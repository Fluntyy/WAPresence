# AGENTS.md — AI Agent Guidelines & Engineering Handbook

This document defines the strict requirements, architectural patterns, design standards, and operational protocols for any AI agent working on the **WAPresence** codebase.

---

## 1. Project Overview & Architecture

WAPresence is a cross-platform desktop application built with **TypeScript (ESM)**, **Electron**, and **Node.js 22 LTS**. It synchronizes active media playback to the user's WhatsApp "About" (status/bio) text in real time.

### Core Architecture Components
- **Main Process** (`src/main/`): Orchestrates Electron windows, system tray, auto-start, updater service, configuration storage (`config.ini`), and WhatsApp lifecycle.
- **Renderer Process** (`src/renderer/`): Material Design 3 frontend components bundled offline. Three main windows/views:
  - `login/`: WhatsApp QR code pairing window.
  - `settings/`: Main presence dashboard, live status verification, and preferences.
  - `spotify-setup/`: Spotify API PKCE setup dialog.
- **Preload Scripts** (`src/preload/index.cjs`): Secure CommonJS context bridge providing safe IPC methods to renderer processes (`contextIsolation: true`, `nodeIntegration: false`).
- **Media Sources** (`src/main/media/`):
  - `windows-smtc.ts`: Global Windows System Media Transport Controls (SMTC) via WinRT helper script (`smtc-helper.ps1`).
  - `linux-mpris.ts`: Linux MPRIS player monitor over session D-Bus (`org.mpris.MediaPlayer2.*`).
  - `spotify.ts`: Spotify Web API using PKCE OAuth (no client secret required, loopback `http://127.0.0.1:6969/callback`).
  - `plugin.ts`: Local HTTP webhook server (`http://127.0.0.1:6970`) accepting JSON track payloads from browser extensions and companion apps.
- **WhatsApp Engine** (`src/main/whatsapp/client.ts`):
  - Requires WhiskeySockets/Baileys fork by `crowroser` (branch: `fix/update-profile-status-about`, PR #2798) located locally at `../Baileys`.
  - Modern WhatsApp About uses the GraphQL MEX mutation (`xwa2_update_text_status`). Upstream npm Baileys does NOT update the modern visible status.
  - Strict 50-character limit. Texts exceeding 50 characters are automatically truncated to 47 characters with `...`.
  - Post-update verification via `fetchTextStatus(ownJid)` with exponential backoff on errors.

---

## 2. Essential Commands

> **CRITICAL RULE**: ALWAYS use `pnpm` for running commands in this workspace. Never use `npm` or `yarn`.

```bash
# Install dependencies
pnpm install

# Run full project build (main TypeScript + offline MD3 bundle + assets)
pnpm run build

# Run unit test suite (vitest)
pnpm test

# Launch application in Electron development mode
pnpm start

# Package unpackaged production binary (creates release/win-unpacked)
pnpm run pack

# Package full production installers and executables
pnpm run dist
```

---

## 3. Strict DO's and DON'Ts

### DO
1. **DO ALWAYS use `pnpm`** for executing package management, build, and test commands.
2. **DO test the build locally before prompting the user**: Run `pnpm run build`, `pnpm test`, and `pnpm run dist`.
3. **DO ask the user to test the built `.exe` FIRST** before pushing commits to remote or publishing/updating a GitHub release.
4. **DO resolve renderer paths using `dist/renderer`**: When loading HTML files in the main process, always check `dist/renderer/` first (since `src/` is never included inside `app.asar`).
5. **DO configure `asarUnpack` for external child scripts**: Files executed by external OS binaries (e.g. `powershell.exe` running `smtc-helper.ps1`) cannot read inside `.asar` archives. Always unpack them in `electron-builder.json` and resolve to `app.asar.unpacked`.
6. **DO use `<md-dialog>` for all user prompts**: Confirmations (log out, reset defaults, warning notices) must use Material Design 3 dialogs, never native OS message boxes or browser `alert()` / `confirm()`.
7. **DO blur the background window** when a dialog is displayed by adding the `.dialog-open` CSS class to `<body>`, and remove it when the dialog closes.
8. **DO respect light and dark themes**: Use dynamic Material Design 3 semantic CSS custom properties (`var(--md-sys-color-primary)`, `var(--md-sys-color-surface)`, etc.).
9. **DO hide all scrollbars**: Apply `scrollbar-width: none !important;` and `::-webkit-scrollbar { display: none !important; }` across all windows and dialogs.
10. **DO insert placeholder tokens at the cursor position**: When the user clicks placeholder chips (`[artist]`, `[title]`, etc.), insert text at the active selection point and prevent double spaces.

### DON'T
1. **DON'T use `npm` or `yarn`** under any circumstances in command line operations.
2. **DON'T push to GitHub or create a release without user approval**: The user must test the generated executable first to verify that no runtime errors or blank screens occur.
3. **DON'T hardcode paths to `src/renderer/` in production code**: `src/` does not exist inside packaged `.asar` bundles; loading it will cause `chrome-error://chromewebdata` blank windows.
4. **DON'T hardcode light pastel colors for text on surface elements**: For example, `#a7f3d0` or `#fca5a5` become unreadable in Light Mode. Use semantic theme variables instead.
5. **DON'T use native HTML `<select>` elements**: Always use `<md-outlined-select>` and `<md-select-option>` for dropdowns.
6. **DON'T use emojis in `README.md`**: The user strictly requested no emojis in the user-facing documentation.
7. **DON'T enforce `pnpm` in `README.md`**: External users may use `npm`, `pnpm`, or `yarn`; do not mandate `pnpm` in public user documentation.
8. **DON'T launch multiple application instances**: Enforce `app.requestSingleInstanceLock()`. If a secondary instance is opened, focus and restore the existing window from the system tray.
9. **DON'T show the dashboard on OS startup**: When "Start with OS" is enabled, start minimized in the system tray without displaying any window.

---

## 4. UI & Material Design 3 Guidelines

### Component Sourcing
- WAPresence bundles `@material/web` components offline via `src/renderer/md3-bundle.ts` compiled to `dist/renderer/md3.bundle.js`.
- Fonts (`Google Sans`, `JetBrains Mono`, `Material Symbols Rounded`) are bundled locally under `assets/fonts/` and served via `src/renderer/index.css`. Never load Google Fonts over CDN.

### Dialog Protocol
- Place dialogs inside the HTML with `<md-dialog id="...">`.
- When showing:
  ```javascript
  document.body.classList.add('dialog-open')
  dialogElement.show()
  ```
- When closing:
  ```javascript
  dialogElement.close()
  document.body.classList.remove('dialog-open')
  ```
- CSS blur handler:
  ```css
  body.dialog-open #app-container {
      filter: blur(4px);
      pointer-events: none;
      transition: filter 0.2s ease;
  }
  ```

### Button & Action Styling
- Maintain generous padding on buttons: horizontal padding should be at least `12px` to prevent text truncation or cramped icons.
- Top bar action buttons should use a tight `gap: 4px` between action buttons (`Preferences`, `Exit`, `Save & Update`).
- For custom-colored filled buttons where container color is dark (such as Spotify's `#btn-ok`), explicitly hardcode white text and white icon colors (`color: #ffffff !important; --md-filled-button-label-text-color: #ffffff !important;`) to prevent Light Mode from rendering black text over dark backgrounds.

### Contrast & Theming Rules
- The theme engine in `src/renderer/theme.ts` uses `@material/material-color-utilities` to dynamically generate all `--md-sys-color-*` CSS variables based on WhatsApp's emerald green seed (`#00a884` / `#059669`).
- Status banners:
  - `.banner-success`: Use `background: color-mix(in srgb, var(--md-sys-color-primary) 12%, var(--md-sys-color-surface)); color: var(--md-sys-color-primary); font-weight: 500; border: 1px solid var(--md-sys-color-primary);`.
  - `.banner-error`: Use `background: color-mix(in srgb, var(--md-sys-color-error) 15%, var(--md-sys-color-surface)); color: var(--md-sys-color-error); font-weight: 500; border: 1px solid var(--md-sys-color-error);`.

---

## 5. File Resolution & Packaging Protocol

### Loading HTML Files in Electron
In `src/main/index.ts`, `getHtmlPath()` must resolve files using the following fallback order:
```typescript
function getHtmlPath(subPath: string): string {
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = path.dirname(currentFile)

    // 1. Packaged asar & dist: dist/main -> ../renderer/<subPath>
    const distRel = path.resolve(currentDir, '..', 'renderer', subPath)
    if (fs.existsSync(distRel)) return distRel

    // 2. Inside app.getAppPath() dist/renderer
    const asarDist = path.join(app.getAppPath(), 'dist', 'renderer', subPath)
    if (fs.existsSync(asarDist)) return asarDist

    // 3. Project cwd dist/renderer
    const cwdDist = path.resolve(process.cwd(), 'dist', 'renderer', subPath)
    if (fs.existsSync(cwdDist)) return cwdDist

    // 4. Development mode fallback: src/renderer
    const srcPath = path.resolve(process.cwd(), 'src', 'renderer', subPath)
    if (fs.existsSync(srcPath)) return srcPath

    return distRel
}
```

### Packaging External Scripts (`electron-builder.json`)
External PowerShell helper scripts must be listed under `asarUnpack`:
```json
{
  "files": [
    "dist/**/*",
    "assets/**/*",
    "package.json"
  ],
  "asarUnpack": [
    "**/smtc-helper.ps1"
  ]
}
```
In `src/main/media/windows-smtc.ts`, check `currentDir.replace('app.asar', 'app.asar.unpacked')` before spawning `powershell.exe`.

---

## 6. Testing & Quality Assurance

1. **Unit Tests**:
   - Run `pnpm test`. Ensure all 36 test cases in `src/main/*.test.ts` pass before submitting changes.
2. **Production Binary Smoke Test**:
   - Run `pnpm run dist`.
   - Run `release/win-unpacked/WAPresence.exe` or test the portable executable.
   - Verify that no `chrome-error://chromewebdata` appears, that DevTools (`Ctrl+Shift+I`) shows complete DOM structure, and that font glyphs render correctly offline.
3. **Theme Switch Verification**:
   - Verify Settings UI and dialogs in both Light and Dark themes to confirm text legibility and banner contrast.

---

## 7. Release & GitHub Upload Protocol

When user explicitly confirms readiness to publish a release:
1. Ensure git working directory is clean: `git status`.
2. Commit changes with a conventional commit message:
   ```powershell
   git add -A; git commit -m "feat/fix: description"
   ```
3. Push to master:
   ```powershell
   git push origin master
   ```
4. Force-update git release tag:
   ```powershell
   git tag -fa v1.0.0 -m "Release v1.0.0"; git push origin v1.0.0 --force
   ```
5. Upload standardized release assets using GitHub CLI (`gh`):
   - `WAPresence-Setup-1.0.0.exe` (Installer)
   - `WAPresence-Setup-1.0.0.exe.blockmap` (Differential update blockmap)
   - `WAPresence-1.0.0.exe` (Portable executable)
   - `latest.yml` (Auto-updater manifest)
   ```powershell
   gh release upload v1.0.0 "release\WAPresence-Setup-1.0.0.exe" "release\WAPresence-1.0.0.exe" "release\WAPresence-Setup-1.0.0.exe.blockmap" "release\latest.yml" --clobber
   ```
6. Avoid uploading duplicate filenames with spaces or dots that clutter the release page.

---

## 8. Security Considerations

- **Context Isolation**: Main windows must set `contextIsolation: true` and `nodeIntegration: false`. All frontend-to-backend IPC communication must go through strictly validated channels in `src/preload/index.cjs`.
- **Localhost Binding**:
  - Spotify PKCE callback server binds strictly to `127.0.0.1:6969`.
  - Plugin Webhook API server binds strictly to `127.0.0.1:6970` (or user-configured local port).
  - Never bind listening HTTP servers to `0.0.0.0`.
- **Credential Storage**:
  - WhatsApp authentication credentials (`baileys_auth/`) and Spotify refresh tokens (`spotify_tokens.json`) are stored exclusively in the OS-standard AppData directory (`%APPDATA%\WAPresence` on Windows). Never store secrets or tokens in project working directories.
