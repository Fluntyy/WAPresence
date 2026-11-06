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
			errorMessage: this.lastErrorMessage
		}
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
		if (this.isUpdating || !this.isRunning) return
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
			const currentTrack = await this.mediaSource.getCurrentTrack()
			if (!this.isRunning) return
			this.lastTrack = currentTrack
			const originalBio = this.client.getOriginalBio()

			const targetText = formatMediaStatus(
				this.config.format,
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

		this.config = newConfig

		if (sourceChanged || spotifyCredsChanged || pluginPortChanged) {
			log.info('Media source configuration changed, re-initializing media source')
			await this.mediaSource.stop()
			this.mediaSource = createMediaSource(newConfig)
			this.attachMediaSourceListeners()
			await this.mediaSource.start()
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
