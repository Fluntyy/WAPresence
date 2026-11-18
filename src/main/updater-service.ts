import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { execFile, execSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { getLogger } from './logger.js'

const { autoUpdater } = electronUpdater
const execFileAsync = promisify(execFile)

const log = getLogger('updater-service')

export interface UpdateInfo {
	version: string
	releaseNotes?: string
	releaseDate?: string
}

export interface DownloadProgress {
	percent: number
	bytesPerSecond: number
	transferred: number
	total: number
}

export interface UpdaterState {
	checking: boolean
	updateAvailable: boolean
	updateDownloaded: boolean
	currentVersion: string
	availableVersion: string | null
	releaseNotes: string | null
	downloadProgress: number
	error: string | null
}

export interface GitHubReleaseAsset {
	name: string
	browser_download_url: string
	size?: number
}

/**
 * Resolves the enclosing `.app` bundle path on macOS from `process.execPath`.
 * e.g. `/Applications/WAPresence.app/Contents/MacOS/WAPresence` -> `/Applications/WAPresence.app`
 */
export function resolveMacAppBundlePath(execPath: string): string | null {
	const normalized = execPath.replace(/\\/g, '/')
	const marker = '.app/Contents/MacOS/'
	const idx = normalized.indexOf(marker)
	if (idx === -1) return null
	return normalized.slice(0, idx + 4)
}

/**
 * Selects the matching macOS `.zip` release asset for the running CPU architecture (`x64` or `arm64`).
 */
export function selectMacZipAsset(assets: GitHubReleaseAsset[], arch: string): GitHubReleaseAsset | null {
	const zipAssets = assets.filter(
		(a) => a && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.zip') && !a.name.toLowerCase().endsWith('.blockmap')
	)
	if (zipAssets.length === 0) return null

	const archLower = arch.toLowerCase()
	const exact = zipAssets.find((a) => a.name.toLowerCase().includes(`-${archLower}.zip`))
	if (exact) return exact

	if (archLower === 'x64') {
		const fallbackX64 = zipAssets.find((a) => !a.name.toLowerCase().includes('arm64'))
		if (fallbackX64) return fallbackX64
	}

	return zipAssets[0]
}

/**
 * Compares two semver strings (`v1 > v2`).
 */
export function isVersionGreater(v1: string, v2: string): boolean {
	const clean1 = v1.replace(/^v/i, '').split('-')[0]
	const clean2 = v2.replace(/^v/i, '').split('-')[0]
	const parts1 = clean1.split('.').map((p) => parseInt(p, 10) || 0)
	const parts2 = clean2.split('.').map((p) => parseInt(p, 10) || 0)
	for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
		const a = parts1[i] || 0
		const b = parts2[i] || 0
		if (a > b) return true
		if (a < b) return false
	}
	return false
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildMacInstallScript(oldAppPath: string, newAppPath: string, parentPid: number, tempDir: string): string {
	const backupAppPath = `${oldAppPath}.bak`
	const swapScriptPath = path.posix.join(tempDir, 'swap-app.sh')
	return [
		'#!/bin/sh',
		'set -u',
		`OLD_APP=${shellQuote(oldAppPath)}`,
		`NEW_APP=${shellQuote(newAppPath)}`,
		`BACKUP_APP=${shellQuote(backupAppPath)}`,
		`PARENT_PID=${parentPid}`,
		`TMP_DIR=${shellQuote(tempDir)}`,
		`SWAP_SCRIPT=${shellQuote(swapScriptPath)}`,
		'',
		'# Wait for WAPresence to finish restoring bio and exit cleanly (up to 15s)',
		'i=0',
		'while kill -0 "$PARENT_PID" 2>/dev/null && [ "$i" -lt 75 ]; do',
		'  sleep 0.2',
		'  i=$((i + 1))',
		'done',
		'',
		'cat << \'SWAPEOF\' > "$SWAP_SCRIPT"',
		'#!/bin/sh',
		'set -e',
		`OLD_APP=${shellQuote(oldAppPath)}`,
		`NEW_APP=${shellQuote(newAppPath)}`,
		`BACKUP_APP=${shellQuote(backupAppPath)}`,
		'rm -rf "$BACKUP_APP"',
		'mv "$OLD_APP" "$BACKUP_APP"',
		'if ! mv "$NEW_APP" "$OLD_APP"; then',
		'  mv "$BACKUP_APP" "$OLD_APP" || true',
		'  exit 1',
		'fi',
		'rm -rf "$BACKUP_APP"',
		'SWAPEOF',
		'chmod +x "$SWAP_SCRIPT"',
		'',
		'# Try direct in-place replacement first; fall back to native macOS admin prompt if needed',
		'if ! /bin/sh "$SWAP_SCRIPT" 2>/dev/null; then',
		'  /usr/bin/osascript -e \'on run argv\' -e \'do shell script "/bin/sh " & quoted form of (item 1 of argv) with administrator privileges\' -e \'end run\' -- "$SWAP_SCRIPT" 2>/dev/null || true',
		'fi',
		'',
		'/usr/bin/xattr -rd com.apple.quarantine "$OLD_APP" 2>/dev/null || true',
		'/usr/bin/open -n "$OLD_APP"',
		'rm -rf "$TMP_DIR" 2>/dev/null || true',
		''
	].join('\n')
}

export class UpdaterService extends EventEmitter {
	private state: UpdaterState = {
		checking: false,
		updateAvailable: false,
		updateDownloaded: false,
		currentVersion: app.getVersion() || '1.2.1',
		availableVersion: null,
		releaseNotes: null,
		downloadProgress: 0,
		error: null
	}

	private beforeQuitCallback: (() => Promise<void>) | null = null
	private macDownloadUrl: string | null = null
	private macExtractedAppPath: string | null = null
	private macTempDir: string | null = null
	private isDownloading: boolean = false

	constructor() {
		super()
		this.configureUpdater()
	}

	public setBeforeQuitCallback(cb: () => Promise<void>) {
		this.beforeQuitCallback = cb
	}

	public getState(): UpdaterState {
		return { ...this.state }
	}

	private isCustomMacUpdater(): boolean {
		return process.platform === 'darwin'
	}

	private getGitHubToken(): string | null {
		if (process.env.GH_TOKEN && process.env.GH_TOKEN.trim().length > 0) {
			return process.env.GH_TOKEN.trim()
		}
		if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim().length > 0) {
			return process.env.GITHUB_TOKEN.trim()
		}

		// Try querying gh auth token if user has gh installed and authenticated
		try {
			const token = execSync('gh auth token', {
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 3000
			}).trim()
			if (token && token.length > 5) {
				return token
			}
		} catch {}

		return null
	}

	private configureUpdater() {
		// On macOS, unsigned builds cannot use Squirrel.Mac (which rejects missing Developer ID signatures),
		// so we handle macOS updates via our native in-place `.zip` + `ditto` updater.
		if (this.isCustomMacUpdater()) {
			return
		}

		autoUpdater.autoDownload = false
		autoUpdater.autoInstallOnAppQuit = true

		const token = this.getGitHubToken()
		if (token) {
			autoUpdater.setFeedURL({
				provider: 'github',
				owner: 'Fluntyy',
				repo: 'WAPresence',
				private: false,
				token
			})
		}

		autoUpdater.on('checking-for-update', () => {
			this.state.checking = true
			this.state.error = null
			this.emit('checking-for-update')
		})

		autoUpdater.on('update-available', (info: any) => {
			this.state.checking = false
			this.state.updateAvailable = true
			this.state.availableVersion = info.version
			this.state.releaseNotes = typeof info.releaseNotes === 'string' ? info.releaseNotes : null
			log.info({ version: info.version }, 'Update available from GitHub Releases')
			this.emit('update-available', {
				version: info.version,
				releaseNotes: this.state.releaseNotes
			})
		})

		autoUpdater.on('update-not-available', () => {
			this.state.checking = false
			this.state.updateAvailable = false
			log.info({ currentVersion: this.state.currentVersion }, 'No updates available; running latest version')
			this.emit('update-not-available', { currentVersion: this.state.currentVersion })
		})

		autoUpdater.on('download-progress', (progressObj: any) => {
			this.state.downloadProgress = Math.round(progressObj.percent || 0)
			this.emit('download-progress', {
				percent: this.state.downloadProgress,
				bytesPerSecond: progressObj.bytesPerSecond || 0,
				transferred: progressObj.transferred || 0,
				total: progressObj.total || 0
			})
		})

		autoUpdater.on('update-downloaded', (info: any) => {
			this.state.downloadProgress = 100
			this.state.updateDownloaded = true
			log.info({ version: info.version }, 'Update downloaded successfully and ready for install')
			this.emit('update-downloaded', { version: info.version })
		})

		autoUpdater.on('error', (err: any) => {
			this.state.checking = false
			const errorMsg = err?.message || String(err)
			this.state.error = errorMsg
			log.warn({ err: errorMsg }, 'Error checking or downloading update')
			this.emit('error', { message: errorMsg })
		})
	}

	public async checkForUpdates(): Promise<UpdaterState> {
		if (this.state.checking) return this.state

		this.state.checking = true
		this.state.error = null

		try {
			if (!app.isPackaged || this.isCustomMacUpdater()) {
				await this.checkGitHubReleasesDirect()
			} else {
				await autoUpdater.checkForUpdates()
			}
		} catch (err: any) {
			const msg = err?.message || String(err)
			this.state.checking = false
			this.state.error = msg
			log.warn({ msg }, 'Check for updates encountered error')
			this.emit('error', { message: msg })
		}

		return this.getState()
	}

	public async downloadUpdate(): Promise<void> {
		if (!this.state.updateAvailable) {
			throw new Error('No update is available to download')
		}
		if (this.isDownloading) return

		if (this.isCustomMacUpdater()) {
			await this.downloadMacUpdate()
			return
		}

		log.info('Initiating download of new update')
		this.isDownloading = true
		try {
			await autoUpdater.downloadUpdate()
		} finally {
			this.isDownloading = false
		}
	}

	private async downloadMacUpdate(): Promise<void> {
		if (!this.macDownloadUrl) {
			const msg = `No macOS (${process.arch}) update archive found in release v${this.state.availableVersion}`
			this.state.error = msg
			this.emit('error', { message: msg })
			throw new Error(msg)
		}

		this.isDownloading = true
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wapresence-update-'))
		const zipPath = path.join(tempDir, 'update.zip')
		const extractDir = path.join(tempDir, 'extracted')
		fs.mkdirSync(extractDir, { recursive: true })

		try {
			log.info({ url: this.macDownloadUrl, arch: process.arch }, 'Downloading macOS update archive')

			const headers: Record<string, string> = {
				'User-Agent': 'WAPresence-App'
			}
			const token = this.getGitHubToken()
			if (token) {
				headers['Authorization'] = `token ${token}`
			}

			const res = await fetch(this.macDownloadUrl, { headers, redirect: 'follow' })
			if (!res.ok || !res.body) {
				throw new Error(`Failed to download update (HTTP ${res.status})`)
			}

			const total = Number(res.headers.get('content-length') || 0)
			let transferred = 0
			const startedAt = Date.now()
			let lastEmitAt = 0

			const fileStream = fs.createWriteStream(zipPath)
			const reader = res.body.getReader()

			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) break
					if (value) {
						transferred += value.byteLength
						if (!fileStream.write(value)) {
							await new Promise<void>((resolve) => fileStream.once('drain', resolve))
						}
						const now = Date.now()
						if (now - lastEmitAt >= 150 || (total > 0 && transferred >= total)) {
							lastEmitAt = now
							const elapsedSec = Math.max((now - startedAt) / 1000, 0.1)
							const percent = total > 0 ? Math.min(99, Math.round((transferred / total) * 100)) : 0
							this.state.downloadProgress = percent
							this.emit('download-progress', {
								percent,
								bytesPerSecond: Math.round(transferred / elapsedSec),
								transferred,
								total
							})
						}
					}
				}
			} finally {
				await new Promise<void>((resolve, reject) => {
					fileStream.end(() => resolve())
					fileStream.on('error', reject)
				})
			}

			log.info({ zipPath, extractDir }, 'Extracting macOS update archive with ditto')
			await execFileAsync('/usr/bin/ditto', ['-xk', zipPath, extractDir])

			const entries = fs.readdirSync(extractDir)
			const appBundleName = entries.find((e) => e.endsWith('.app'))
			if (!appBundleName) {
				throw new Error('Downloaded macOS update archive does not contain an .app bundle')
			}

			const extractedAppPath = path.join(extractDir, appBundleName)

			// Strip quarantine attribute so Gatekeeper does not block relaunch
			try {
				await execFileAsync('/usr/bin/xattr', ['-rd', 'com.apple.quarantine', extractedAppPath])
			} catch {}

			// Clean up any previous staged temp dir
			if (this.macTempDir && this.macTempDir !== tempDir) {
				try {
					fs.rmSync(this.macTempDir, { recursive: true, force: true })
				} catch {}
			}

			this.macTempDir = tempDir
			this.macExtractedAppPath = extractedAppPath
			this.state.downloadProgress = 100
			this.state.updateDownloaded = true

			log.info({ version: this.state.availableVersion, extractedAppPath }, 'macOS update staged and ready for in-place install')
			this.emit('update-downloaded', { version: this.state.availableVersion })
		} catch (err: any) {
			try {
				fs.rmSync(tempDir, { recursive: true, force: true })
			} catch {}
			const msg = err?.message || String(err)
			this.state.error = msg
			log.error({ err: msg }, 'macOS update download/extraction failed')
			this.emit('error', { message: msg })
			throw err
		} finally {
			this.isDownloading = false
		}
	}

	public async quitAndInstall(): Promise<void> {
		log.info('Preparing to quit and install update')
		if (this.beforeQuitCallback) {
			try {
				await this.beforeQuitCallback()
			} catch (err) {
				log.warn({ err }, 'Error during before-quit callback prior to update install')
			}
		}

		if (this.isCustomMacUpdater()) {
			const currentAppPath = resolveMacAppBundlePath(process.execPath)
			if (!currentAppPath || !this.macExtractedAppPath || !this.macTempDir || !fs.existsSync(this.macExtractedAppPath)) {
				const msg = !currentAppPath
					? 'In-place macOS updates require running WAPresence from an installed .app bundle'
					: 'Staged macOS update bundle is missing'
				log.error({ currentAppPath, macExtractedAppPath: this.macExtractedAppPath }, msg)
				this.state.error = msg
				this.emit('error', { message: msg })
				return
			}

			const installScriptPath = path.join(this.macTempDir, 'install-update.sh')
			const scriptContent = buildMacInstallScript(currentAppPath, this.macExtractedAppPath, process.pid, this.macTempDir)
			fs.writeFileSync(installScriptPath, scriptContent, { encoding: 'utf-8', mode: 0o755 })

			log.info({ currentAppPath, newAppPath: this.macExtractedAppPath }, 'Launching detached macOS in-place updater script')
			const child = spawn('/bin/sh', [installScriptPath], {
				detached: true,
				stdio: 'ignore'
			})
			child.unref()
			app.exit(0)
			return
		}

		autoUpdater.quitAndInstall(false, true)
	}

	private async checkGitHubReleasesDirect(): Promise<void> {
		const token = this.getGitHubToken()
		const headers: Record<string, string> = {
			'User-Agent': 'WAPresence-App',
			Accept: 'application/vnd.github.v3+json'
		}
		if (token) {
			headers['Authorization'] = `token ${token}`
		}

		try {
			const res = await fetch('https://api.github.com/repos/Fluntyy/WAPresence/releases/latest', {
				headers
			})

			if (!res.ok) {
				if (res.status === 404) {
					this.state.checking = false
					this.state.updateAvailable = false
					this.emit('update-not-available', { currentVersion: this.state.currentVersion })
					return
				}
				throw new Error(`GitHub API returned status ${res.status}: ${res.statusText}`)
			}

			const data: any = await res.json()
			const latestTag = (data.tag_name || '').replace(/^v/, '')

			if (isVersionGreater(latestTag, this.state.currentVersion)) {
				this.state.checking = false
				this.state.updateAvailable = true
				this.state.availableVersion = latestTag
				this.state.releaseNotes = data.body || null

				if (this.isCustomMacUpdater() && Array.isArray(data.assets)) {
					const macAsset = selectMacZipAsset(data.assets, process.arch)
					this.macDownloadUrl = macAsset ? macAsset.browser_download_url : null
				}

				this.emit('update-available', {
					version: latestTag,
					releaseNotes: this.state.releaseNotes
				})
			} else {
				this.state.checking = false
				this.state.updateAvailable = false
				this.emit('update-not-available', { currentVersion: this.state.currentVersion })
			}
		} catch (err: any) {
			this.state.checking = false
			this.state.error = err.message
			this.emit('error', { message: err.message })
		}
	}
}
