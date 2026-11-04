import { EventEmitter } from 'node:events'
import pino from 'pino'
import qrcode from 'qrcode'
import makeWASocket, {
	DisconnectReason,
	jidNormalizedUser,
	WASocket
} from '@whiskeysockets/baileys'
import { initAuthState, clearAuthState } from './auth.js'
import {
	loadBioRecord,
	saveOriginalBio,
	markBioRestored,
	clearBioRecord
} from '../storage/bioStore.js'
import { truncateText, MAX_ABOUT_LENGTH } from '../format.js'
import { getLogger } from '../logger.js'

const log = getLogger('whatsapp:client')

export interface VerificationResult {
	verified: boolean
	expectedText: string
	serverText: string
	emoji?: string
	ephemeralDurationSeconds?: number
	lastUpdateTime?: Date
	error?: string
}

export type WhatsAppClientState = 'idle' | 'connecting' | 'qr' | 'connected' | 'disconnected' | 'logged_out'

export class WhatsAppClient extends EventEmitter {
	private socket: WASocket | null = null
	private state: WhatsAppClientState = 'idle'
	private ownJid: string | null = null
	private originalBio: string = ''
	private isIntentionallyClosed: boolean = false
	private reconnectAttempts: number = 0
	private reconnectTimer: NodeJS.Timeout | null = null
	private customAuthDir?: string
	private lastQrDataUrl: string | null = null

	constructor(customAuthDir?: string) {
		super()
		this.customAuthDir = customAuthDir
	}

	public getState(): WhatsAppClientState {
		return this.state
	}

	public getOwnJid(): string | null {
		return this.ownJid
	}

	public getOriginalBio(): string {
		return this.originalBio
	}

	public getLastQr(): string | null {
		return this.lastQrDataUrl
	}

	public async connect(): Promise<void> {
		if (this.socket && this.state === 'connected') {
			log.info('Already connected to WhatsApp')
			return
		}

		this.isIntentionallyClosed = false
		this.setState('connecting')

		const { state, saveCreds } = await initAuthState(this.customAuthDir)

		const baileysLogger = pino({ level: 'silent' })

		this.socket = makeWASocket({
			auth: state,
			logger: baileysLogger,
			syncFullHistory: false
		})

		this.socket.ev.on('creds.update', saveCreds)

		this.socket.ev.on('connection.update', async (update) => {
			const { connection, lastDisconnect, qr } = update

			if (qr) {
				log.info('Received new QR code for WhatsApp linking')
				this.setState('qr')
				try {
					const dataUrl = await qrcode.toDataURL(qr, {
						margin: 2,
						width: 256,
						color: {
							dark: '#000000',
							light: '#ffffff'
						}
					})
					this.lastQrDataUrl = dataUrl
					this.emit('qr', dataUrl)
				} catch (err) {
					log.error({ err }, 'Failed to render QR code to data URL')
				}
			}

			if (connection === 'open') {
				this.lastQrDataUrl = null
				this.reconnectAttempts = 0
				if (this.reconnectTimer) {
					clearTimeout(this.reconnectTimer)
					this.reconnectTimer = null
				}

				const rawId = this.socket?.user?.id || (state.creds.me && state.creds.me.id) || ''
				this.ownJid = rawId ? jidNormalizedUser(rawId) : null
				log.info({ ownJid: this.ownJid }, 'WhatsApp connection established successfully')

				await this.initializeBio()

				this.setState('connected')
				this.emit('connected', { ownJid: this.ownJid, originalBio: this.originalBio })
			}

			if (connection === 'close') {
				const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
				const isLoggedOut = statusCode === DisconnectReason.loggedOut

				log.warn({ statusCode, isLoggedOut, closed: this.isIntentionallyClosed }, 'WhatsApp connection closed')

				if (isLoggedOut) {
					this.setState('logged_out')
					clearAuthState(this.customAuthDir)
					clearBioRecord()
					this.emit('logged_out')
				} else if (!this.isIntentionallyClosed) {
					this.setState('disconnected')
					this.emit('disconnected')
					this.scheduleReconnect()
				}
			}
		})
	}

	private setState(newState: WhatsAppClientState) {
		this.state = newState
		this.emit('state_change', newState)
	}

	private scheduleReconnect() {
		if (this.reconnectTimer || this.isIntentionallyClosed) return

		// Exponential backoff: 2s, 4s, 8s, up to 30s
		const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts + 1), 30000)
		this.reconnectAttempts++

		log.info({ delayMs, attempt: this.reconnectAttempts }, 'Scheduling reconnect to WhatsApp')
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			this.connect().catch((err) => {
				log.error({ err }, 'Error during scheduled reconnect')
			})
		}, delayMs)
	}

	/**
	 * Reads original bio on login. If an un-restored bio from a previous crash exists,
	 * retains that crash bio. Otherwise reads from server and records it.
	 */
	private async initializeBio(): Promise<void> {
		if (!this.ownJid || !this.socket) return

		const savedRecord = loadBioRecord()
		if (savedRecord && !savedRecord.restored && savedRecord.bio) {
			log.warn({ bio: savedRecord.bio }, 'Found un-restored bio from previous crash session; retaining it')
			this.originalBio = savedRecord.bio
			return
		}

		try {
			const status = await this.fetchCurrentServerStatus()
			this.originalBio = status?.text || ''
			saveOriginalBio(this.originalBio)
			log.info({ originalBio: this.originalBio }, 'Original WhatsApp bio recorded on startup')
		} catch (err) {
			log.error({ err }, 'Failed to fetch initial WhatsApp About status from server')
			this.originalBio = ''
			saveOriginalBio('')
		}
	}

	/**
	 * Fetches the current text status directly from the server for our own JID.
	 */
	public async fetchCurrentServerStatus() {
		if (!this.socket || !this.ownJid) {
			throw new Error('WhatsApp client is not connected')
		}

		const resultList = await this.socket.fetchTextStatus(this.ownJid)
		const first = resultList?.[0]
		const textStatus = (first as any)?.text_status
		return {
			text: textStatus?.text || '',
			emoji: textStatus?.emoji,
			ephemeralDurationSeconds: textStatus?.ephemeralDurationSeconds,
			lastUpdateTime: textStatus?.lastUpdateTime
		}
	}

	/**
	 * Updates the WhatsApp About (text status) and verifies that the server accepted the change.
	 * Never reports success based only on promise resolution.
	 */
	public async updateAboutWithVerification(targetText: string): Promise<VerificationResult> {
		if (!this.socket || !this.ownJid) {
			return {
				verified: false,
				expectedText: targetText,
				serverText: '',
				error: 'WhatsApp client is not connected'
			}
		}

		const safeText = truncateText(targetText, MAX_ABOUT_LENGTH)
		const hasText = safeText.trim().length > 0
		const expectedText = safeText.trim()

		try {
			// updateProfileAbout sets xwa2_update_text_status (and fallback legacy status)
			// When clearing text status (hasText === false), text is null and ephemeralDuration is 0
			await this.socket.updateProfileAbout({
				text: hasText ? safeText : null,
				ephemeralDuration: hasText ? 86400 : 0
			})

			// Give the WhatsApp server a brief moment to propagate
			await new Promise((resolve) => setTimeout(resolve, 200))

			// Verify by querying fetchTextStatus
			const serverStatus = await this.fetchCurrentServerStatus()
			const serverText = (serverStatus.text || '').trim()

			if (serverText !== expectedText) {
				const errMsg = `Verification failed: wrote "${expectedText}", but server returned "${serverText}"`
				log.error({ expected: expectedText, got: serverText }, errMsg)
				const result: VerificationResult = {
					verified: false,
					expectedText,
					serverText,
					emoji: serverStatus.emoji,
					ephemeralDurationSeconds: serverStatus.ephemeralDurationSeconds,
					lastUpdateTime: serverStatus.lastUpdateTime,
					error: errMsg
				}
				this.emit('verification_failed', result)
				return result
			}

			log.info({ safeText: expectedText }, 'WhatsApp About update successfully verified')
			const result: VerificationResult = {
				verified: true,
				expectedText,
				serverText,
				emoji: serverStatus.emoji,
				ephemeralDurationSeconds: serverStatus.ephemeralDurationSeconds,
				lastUpdateTime: serverStatus.lastUpdateTime
			}
			this.emit('about_verified', result)
			return result
		} catch (err: any) {
			const errMsg = err?.message || String(err)
			log.error({ err }, 'Error occurred while updating WhatsApp About')
			const result: VerificationResult = {
				verified: false,
				expectedText: safeText,
				serverText: '',
				error: errMsg
			}
			this.emit('verification_failed', result)
			return result
		}
	}

	/**
	 * Restores original bio to WhatsApp and marks it restored in the local store.
	 */
	public async restoreOriginalBio(): Promise<boolean> {
		if (!this.socket || !this.ownJid) {
			log.warn('Cannot restore original bio: not connected')
			return false
		}

		log.info({ originalBio: this.originalBio }, 'Restoring original WhatsApp bio')
		try {
			await this.socket.updateProfileAbout({
				text: this.originalBio || null,
				ephemeralDuration: this.originalBio ? 86400 : 0
			})
			markBioRestored()
			log.info('Original bio successfully restored')
			return true
		} catch (err) {
			log.error({ err }, 'Failed to restore original bio to WhatsApp')
			return false
		}
	}

	/**
	 * Log out unlinks the device completely. Clears local credentials.
	 */
	public async logout(): Promise<void> {
		this.isIntentionallyClosed = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}

		await this.restoreOriginalBio()

		if (this.socket) {
			try {
				await this.socket.logout()
			} catch (err) {
				log.warn({ err }, 'Error during socket.logout()')
			}
		}

		clearAuthState(this.customAuthDir)
		clearBioRecord()
		this.setState('logged_out')
		this.emit('logged_out')
	}

	/**
	 * Gracefully disconnects on normal exit without unlinking session.
	 * Restores bio and ends connection.
	 */
	public async disconnect(): Promise<void> {
		this.isIntentionallyClosed = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}

		await this.restoreOriginalBio()

		if (this.socket) {
			try {
				this.socket.end(undefined)
			} catch (err) {
				log.warn({ err }, 'Error during socket.end()')
			}
			this.socket = null
		}
		this.setState('idle')
	}
}
