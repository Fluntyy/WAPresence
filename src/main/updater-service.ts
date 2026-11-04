import { EventEmitter } from 'node:events'
import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater from 'electron-updater';
import { execSync } from 'node:child_process'
import { getLogger } from './logger.js'

const { autoUpdater } = electronUpdater;

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

export class UpdaterService extends EventEmitter {
	private state: UpdaterState = {
		checking: false,
		updateAvailable: false,
		updateDownloaded: false,
		currentVersion: app.getVersion() || '1.0.0',
		availableVersion: null,
		releaseNotes: null,
		downloadProgress: 0,
		error: null
	}

	private beforeQuitCallback: (() => Promise<void>) | null = null

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
		autoUpdater.autoDownload = false
		autoUpdater.autoInstallOnAppQuit = true

		const token = this.getGitHubToken()
		if (token) {
			autoUpdater.setFeedURL({
				provider: 'github',
				owner: 'Fluntyy',
				repo: 'WAPresence',
				private: true,
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

		autoUpdater.on('update-not-available', (info: any) => {
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
			if (!app.isPackaged) {
				// In development mode, query GitHub Releases API directly
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
		log.info('Initiating download of new update')
		await autoUpdater.downloadUpdate()
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
					// No releases yet
					this.state.checking = false
					this.state.updateAvailable = false
					this.emit('update-not-available', { currentVersion: this.state.currentVersion })
					return
				}
				throw new Error(`GitHub API returned status ${res.status}: ${res.statusText}`)
			}

			const data: any = await res.json()
			const latestTag = (data.tag_name || '').replace(/^v/, '')

			if (this.isVersionGreater(latestTag, this.state.currentVersion)) {
				this.state.checking = false
				this.state.updateAvailable = true
				this.state.availableVersion = latestTag
				this.state.releaseNotes = data.body || null
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

	private isVersionGreater(v1: string, v2: string): boolean {
		const parts1 = v1.split('.').map((p) => parseInt(p, 10) || 0)
		const parts2 = v2.split('.').map((p) => parseInt(p, 10) || 0)
		for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
			const a = parts1[i] || 0
			const b = parts2[i] || 0
			if (a > b) return true
			if (a < b) return false
		}
		return false
	}
}
