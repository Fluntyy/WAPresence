import { EventEmitter } from 'node:events'
import { WhatsAppClient, VerificationResult } from './whatsapp/client.js'
import { IMediaSource, MediaTrackInfo } from './media/types.js'
import { AppConfig } from './config.js'
import { formatMediaStatus, getAvailablePlaceholders, MAX_ABOUT_LENGTH } from './format.js'
import { createMediaSource } from './media/index.js'
import { SpotifySource } from './media/spotify.js'
import { PluginSource } from './media/plugin.js'
import { getLogger } from './logger.js'

const log = getLogger('updater')

// Refresh About every 1 hour (3600s) even if unchanged, to prevent 24h ephemeral expiry
const EPHEMERAL_REFRESH_INTERVAL_MS = 60 * 60 * 1000

export interface UpdaterStatus {
	currentTrack: MediaTrackInfo | null
	lastWrittenText: string | null
	lastVerification: VerificationResult | null
	isBackingOff: boolean
	backoffUntil: number
	errorMessage: string | null
	isPresencePaused: boolean
}

export class PresenceUpdater extends EventEmitter {
	private client: WhatsAppClient
	private mediaSource: IMediaSource
	private config: AppConfig

	private isRunning: boolean = false
	private pollTimer: NodeJS.Timeout | null = null
	private lastWrittenText: string | null = null
	private lastWriteTime: number = 0
	private backoffAttempts: number = 0
	private backoffUntil: number = 0
	private lastVerification: VerificationResult | null = null
	private lastErrorMessage: string | null = null
	private isUpdating: boolean = false
	private lastTrack: MediaTrackInfo | null = null
	private pausedSince: number | null = null
	private isPresencePaused: boolean = false

	constructor(client: WhatsAppClient, config: AppConfig, customMediaSource?: IMediaSource) {
		super()
		this.client = client
		this.config = config
		this.mediaSource = customMediaSource || createMediaSource(config)
		this.attachMediaSourceListeners()
	}

	private attachMediaSourceListeners() {
		this.mediaSource.on('track_change', () => {
			if (this.isRunning) {
				this.tick().catch((err) => log.error({ err }, 'Error during track_change tick'))
			}
		})

		this.mediaSource.on('placeholders_change', (placeholders: string[]) => {
			this.emit('placeholders_change', placeholders)
		})
	}

	public getMediaSource(): IMediaSource {
		return this.mediaSource
	}

	public getAvailablePlaceholders(): string[] {
		if (this.mediaSource instanceof PluginSource) {
			return this.mediaSource.getAvailablePlaceholders()
		}
		return getAvailablePlaceholders()
	}

	public getStatus(): UpdaterStatus {
		return {
			currentTrack: this.lastTrack,
			lastWrittenText: this.lastWrittenText,
			lastVerification: this.lastVerification,
			isBackingOff: Date.now() < this.backoffUntil,
			backoffUntil: this.backoffUntil,
			errorMessage: this.lastErrorMessage,
			isPresencePaused: this.isPresencePaused
		}
	}

	public isPaused(): boolean {
		return this.isPresencePaused
	}

	public async togglePause(): Promise<boolean> {
		await this.setPause(!this.isPresencePaused)
		return this.isPresencePaused
	}

	public async setPause(paused: boolean): Promise<void> {
		if (this.isPresencePaused === paused) return
		this.isPresencePaused = paused
		log.info({ paused }, 'Presence manual pause state changed')

		if (paused) {
			try {
				await this.client.restoreOriginalBio()
				this.lastWrittenText = this.client.getOriginalBio()
			} catch (err) {
				log.warn({ err }, 'Error restoring bio when pausing presence')
			}
		} else {
			this.pausedSince = null
			this.lastWrittenText = null
			if (this.isRunning) {
				try {
					await this.tick()
				} catch (err) {
					log.warn({ err }, 'Error running tick on presence resume')
				}
			}
		}

		this.emit('pause_change', this.isPresencePaused)
		this.emit('status_updated', this.getStatus())
	}

	private filterTrack(track: MediaTrackInfo | null): MediaTrackInfo | null {
		if (!track) {
			this.pausedSince = null
			return null
		}

		// 1. Blacklist Apps check
		if (this.config.blacklistApps && this.config.blacklistApps.length > 0 && track.app) {
			const appLower = track.app.toLowerCase()
			const isBlacklisted = this.config.blacklistApps.some((b) => {
				const bLower = b.trim().toLowerCase()
				if (!bLower) return false
				return appLower === bLower || appLower.includes(bLower) || bLower.includes(appLower)
			})
			if (isBlacklisted) {
				log.debug({ app: track.app }, 'Track ignored due to blacklisted app')
				this.pausedSince = null
				return null
			}
		}

		// 2. Exclude Regex check
		if (this.config.excludeRegex && this.config.excludeRegex.trim().length > 0) {
			try {
				const regex = new RegExp(this.config.excludeRegex.trim(), 'i')
				const fullString = `${track.artist || ''} - ${track.title || ''} ${track.album || ''}`
				if (regex.test(track.title || '') || regex.test(track.artist || '') || regex.test(fullString)) {
					log.debug({ title: track.title, artist: track.artist }, 'Track ignored due to exclude regex match')
					this.pausedSince = null
					return null
				}
			} catch (err) {
				log.warn({ err }, 'Invalid exclude regex during track filtering')
			}
		}

		// 3. Paused Timeout check
		if (track.isPaused) {
			const now = Date.now()
			if (this.pausedSince === null) {
				this.pausedSince = now
			}
			const timeoutSeconds = this.config.pausedTimeout ?? 30
			if (timeoutSeconds > 0) {
				const elapsedSeconds = (now - this.pausedSince) / 1000
				if (elapsedSeconds >= timeoutSeconds) {
					log.debug({ elapsedSeconds, timeoutSeconds }, 'Media paused longer than timeout; treating as inactive')
					return null
				}
			}
		} else {
			this.pausedSince = null
		}

		return track
	}

	public async start(): Promise<void> {
		if (this.isRunning) return
		this.isRunning = true
		log.info('Starting presence update loop')

		await this.mediaSource.start()
		try {
			this.lastTrack = await this.mediaSource.getCurrentTrack()
		} catch (err) {
			log.debug({ err }, 'Could not get initial track')
		}

		this.scheduleNextTick(0)
	}

	private scheduleNextTick(delayMs?: number) {
		if (!this.isRunning) return
		if (this.pollTimer) {
			clearTimeout(this.pollTimer)
			this.pollTimer = null
		}

		const delay = delayMs !== undefined ? delayMs : this.config.updateEvery * 1000
		this.pollTimer = setTimeout(async () => {
			this.pollTimer = null
			try {
				await this.tick()
			} catch (err) {
				log.error({ err }, 'Unexpected error in updater tick')
			} finally {
				if (this.isRunning) {
					this.scheduleNextTick()
				}
			}
		}, delay)
	}

	public async tick(): Promise<void> {
		if (this.isUpdating || !this.isRunning || this.isPresencePaused) return
		if (this.client.getState() !== 'connected') {
			return
		}

		// Check exponential backoff
		if (Date.now() < this.backoffUntil) {
			log.debug('Skipping tick due to active backoff')
			return
		}

		this.isUpdating = true

		try {
			const rawTrack = await this.mediaSource.getCurrentTrack()
			if (!this.isRunning || this.isPresencePaused) return

			const currentTrack = this.filterTrack(rawTrack)
			this.lastTrack = currentTrack
			const originalBio = this.client.getOriginalBio()

			const activeFormat = this.config.source === 'Spotify'
				? (this.config.formatSpotify || this.config.format)
				: (this.config.source === 'Plugin'
					? (this.config.formatPlugin || this.config.format)
					: (this.config.formatLocal || this.config.format))

			const targetText = formatMediaStatus(
				activeFormat,
				currentTrack,
				originalBio,
				MAX_ABOUT_LENGTH,
				this.config.appendPauseEmoji ?? true
			)

			const now = Date.now()
			const isTextChanged = targetText !== this.lastWrittenText
			const isNearExpiry = now - this.lastWriteTime >= EPHEMERAL_REFRESH_INTERVAL_MS

			if (!isTextChanged && !isNearExpiry) {
				// Text has not changed and ephemeral duration is still fresh
				this.emit('tick_skipped', { text: targetText, currentTrack })
				this.emit('status_updated', this.getStatus())
				return
			}

			if (!this.isRunning) return

			log.info({ targetText, isTextChanged, isNearExpiry }, 'Writing WhatsApp About text')

			const verification = await this.client.updateAboutWithVerification(targetText)
			this.lastVerification = verification

			if (verification.verified) {
				this.lastWrittenText = targetText
				this.lastWriteTime = now
				this.backoffAttempts = 0
				this.backoffUntil = 0
				this.lastErrorMessage = null

				log.info({ text: targetText }, 'Presence updated and verified successfully')
				this.emit('presence_updated', {
					text: targetText,
					currentTrack,
					verification
				})
				this.emit('status_updated', this.getStatus())
			} else {
				// Verification failed: apply exponential backoff (2s, 4s, 8s, up to 30s)
				const backoffDelay = Math.min(2000 * Math.pow(2, this.backoffAttempts), 30000)
				this.backoffAttempts++
				this.backoffUntil = Date.now() + backoffDelay
				this.lastErrorMessage = verification.error || 'Verification mismatch'

				log.warn(
					{
						expected: targetText,
						server: verification.serverText,
						backoffDelayMs: backoffDelay,
						attempt: this.backoffAttempts
					},
					'Verification failed: applying exponential backoff'
				)

				this.emit('verification_failed', {
					expected: targetText,
					verification,
					backoffDelayMs: backoffDelay
				})
				this.emit('status_updated', this.getStatus())
			}
		} catch (err: any) {
			const errMsg = err?.message || String(err)
			this.lastErrorMessage = errMsg
			log.error({ err }, 'Unexpected error in presence update tick')
			this.emit('error', err)
		} finally {
			this.isUpdating = false
		}
	}

	public async updateConfig(newConfig: AppConfig): Promise<void> {
		const sourceChanged = this.config.source !== newConfig.source
		const spotifyCredsChanged =
			this.config.clientID !== newConfig.clientID ||
			this.config.redirectURI !== newConfig.redirectURI
		const pluginPortChanged =
			newConfig.source === 'Plugin' && this.config.pluginPort !== newConfig.pluginPort

		const activeFormat = newConfig.source === 'Spotify'
			? (newConfig.formatSpotify || newConfig.format)
			: (newConfig.source === 'Plugin'
				? (newConfig.formatPlugin || newConfig.format)
				: (newConfig.formatLocal || newConfig.format))

		this.config = {
			...newConfig,
			format: activeFormat
		}

		if (sourceChanged || spotifyCredsChanged || pluginPortChanged) {
			log.info('Media source configuration changed, re-initializing media source')
			await this.mediaSource.stop()
			this.mediaSource = createMediaSource(newConfig)
			this.attachMediaSourceListeners()
			await this.mediaSource.start()
			this.emit('placeholders_change', this.getAvailablePlaceholders())
		} else if (this.mediaSource instanceof SpotifySource) {
			this.mediaSource.setPollInterval(newConfig.updateEvery)
		}

		if (this.isRunning) {
			this.scheduleNextTick(0)
		}
	}

	public async stop(): Promise<void> {
		this.isRunning = false
		if (this.pollTimer) {
			clearTimeout(this.pollTimer)
			this.pollTimer = null
		}

		if (this.isUpdating) {
			const start = Date.now()
			while (this.isUpdating && Date.now() - start < 1500) {
				await new Promise((resolve) => setTimeout(resolve, 50))
			}
		}

		await this.mediaSource.stop()
		this.lastWrittenText = null
	}
}
