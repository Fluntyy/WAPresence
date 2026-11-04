import { EventEmitter } from 'node:events'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { URL } from 'node:url'
import { IMediaSource, MediaTrackInfo } from './types.js'
import { getSpotifyTokensPath } from '../paths.js'
import { getLogger } from '../logger.js'

const log = getLogger('media:spotify')

export interface SpotifyTokens {
	access_token: string
	refresh_token: string
	expires_at: number
}

export class SpotifySource extends EventEmitter implements IMediaSource {
	readonly name = 'Spotify'
	private clientID: string
	private redirectURI: string
	private tokens: SpotifyTokens | null = null
	private currentTrack: MediaTrackInfo | null = null
	private isRunning: boolean = false
	private pollTimer: NodeJS.Timeout | null = null
	private rateLimitedUntil: number = 0
	private pollIntervalMs: number = 1000

	constructor(clientID: string, redirectURI: string) {
		super()
		this.clientID = clientID
		this.redirectURI = redirectURI
		this.loadSavedTokens()
	}

	public setConfig(clientID: string, redirectURI: string) {
		this.clientID = clientID
		this.redirectURI = redirectURI
	}

	public setPollInterval(seconds: number) {
		this.pollIntervalMs = Math.max(1, seconds) * 1000
	}

	public hasCredentials(): boolean {
		return Boolean(this.clientID && this.clientID.trim().length > 0)
	}

	public isAuthenticated(): boolean {
		return Boolean(this.tokens && this.tokens.refresh_token)
	}

	private loadSavedTokens(): void {
		const tokenPath = getSpotifyTokensPath()
		try {
			if (fs.existsSync(tokenPath)) {
				const content = fs.readFileSync(tokenPath, 'utf-8')
				const parsed = JSON.parse(content)
				if (parsed.access_token && parsed.refresh_token) {
					this.tokens = parsed
					log.info('Loaded existing Spotify tokens from app data')
				}
			}
		} catch (err) {
			log.warn({ err }, 'Failed to load Spotify tokens')
		}
	}

	private saveTokens(tokens: SpotifyTokens): void {
		this.tokens = tokens
		const tokenPath = getSpotifyTokensPath()
		try {
			fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8')
			log.info('Saved Spotify tokens to app data')
		} catch (err) {
			log.error({ err }, 'Failed to save Spotify tokens')
		}
	}

	public clearTokens(): void {
		this.tokens = null
		const tokenPath = getSpotifyTokensPath()
		try {
			if (fs.existsSync(tokenPath)) {
				fs.unlinkSync(tokenPath)
			}
		} catch (err) {
			log.error({ err }, 'Failed to clear Spotify tokens')
		}
	}

	/**
	 * Starts PKCE authorization flow. Launches local loopback server and returns
	 * the authorization URL to open in the user's browser.
	 */
	public async startAuthFlow(): Promise<{ authUrl: string; completionPromise: Promise<boolean> }> {
		if (!this.clientID) {
			throw new Error('Spotify Client ID is not configured')
		}

		// Generate PKCE code verifier and code challenge
		const verifier = crypto.randomBytes(32).toString('base64url')
		const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')

		const parsedUrl = new URL(this.redirectURI)
		const port = parseInt(parsedUrl.port || '6969', 10)
		const callbackPath = parsedUrl.pathname || '/callback'

		const authUrl = `https://accounts.spotify.com/authorize?client_id=${encodeURIComponent(
			this.clientID
		)}&response_type=code&redirect_uri=${encodeURIComponent(
			this.redirectURI
		)}&code_challenge_method=S256&code_challenge=${encodeURIComponent(
			challenge
		)}&scope=${encodeURIComponent('user-read-playback-state user-read-currently-playing')}`

		const completionPromise = new Promise<boolean>((resolve) => {
			const server = http.createServer(async (req, res) => {
				const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)

				if (reqUrl.pathname !== callbackPath) {
					res.writeHead(404)
					res.end('Not Found')
					return
				}

				const code = reqUrl.searchParams.get('code')
				const error = reqUrl.searchParams.get('error')

				if (error || !code) {
					log.error({ error }, 'Spotify authorization failed or was denied')
					res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
					res.end(`
						<body style="background:#121212;color:#f87171;font-family:sans-serif;text-align:center;padding:50px;">
							<h2>Spotify Authorization Failed</h2>
							<p>${error || 'No authorization code received.'}</p>
							<p>You can close this window and try again.</p>
						</body>
					`)
					server.close()
					resolve(false)
					return
				}

				// Exchange authorization code + code_verifier for tokens
				try {
					const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded'
						},
						body: new URLSearchParams({
							grant_type: 'authorization_code',
							client_id: this.clientID,
							code,
							redirect_uri: this.redirectURI,
							code_verifier: verifier
						})
					})

					if (!tokenRes.ok) {
						const errBody = await tokenRes.text()
						throw new Error(`Token exchange failed (${tokenRes.status}): ${errBody}`)
					}

					const data = await tokenRes.json()
					const tokens: SpotifyTokens = {
						access_token: data.access_token,
						refresh_token: data.refresh_token,
						expires_at: Date.now() + (data.expires_in || 3600) * 1000
					}

					this.saveTokens(tokens)

					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
					res.end(`
						<body style="background:#121212;color:#10b981;font-family:sans-serif;text-align:center;padding:50px;">
							<h2>Spotify Authorization Successful!</h2>
							<p style="color:#9ca3af;">WAPresence is now connected to Spotify. You may close this tab.</p>
						</body>
					`)
					server.close()
					resolve(true)
				} catch (err: any) {
					log.error({ err }, 'Error during Spotify token exchange')
					res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
					res.end(`
						<body style="background:#121212;color:#f87171;font-family:sans-serif;text-align:center;padding:50px;">
							<h2>Authorization Error</h2>
							<p>${err.message}</p>
						</body>
					`)
					server.close()
					resolve(false)
				}
			})

			server.listen(port, '127.0.0.1', () => {
				log.info({ port, redirectURI: this.redirectURI }, 'Spotify PKCE callback server listening')
			})

			// Timeout after 3 minutes if user closes browser
			setTimeout(() => {
				try {
					server.close()
				} catch {}
				resolve(false)
			}, 180000)
		})

		return { authUrl, completionPromise }
	}

	private async ensureValidToken(): Promise<string | null> {
		if (!this.tokens) return null

		// Refresh 60 seconds before expiration
		if (Date.now() >= this.tokens.expires_at - 60000) {
			if (!this.tokens.refresh_token) return null

			try {
				log.info('Refreshing expired Spotify access token')
				const res = await fetch('https://accounts.spotify.com/api/token', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded'
					},
					body: new URLSearchParams({
						grant_type: 'refresh_token',
						refresh_token: this.tokens.refresh_token,
						client_id: this.clientID
					})
				})

				if (!res.ok) {
					log.error({ status: res.status }, 'Failed to refresh Spotify token')
					return null
				}

				const data = await res.json()
				this.tokens.access_token = data.access_token
				this.tokens.expires_at = Date.now() + (data.expires_in || 3600) * 1000
				if (data.refresh_token) {
					this.tokens.refresh_token = data.refresh_token
				}
				this.saveTokens(this.tokens)
			} catch (err) {
				log.error({ err }, 'Network error refreshing Spotify token')
				return null
			}
		}

		return this.tokens.access_token
	}

	public async fetchCurrentlyPlaying(): Promise<MediaTrackInfo | null> {
		if (Date.now() < this.rateLimitedUntil) {
			return this.currentTrack
		}

		const token = await this.ensureValidToken()
		if (!token) {
			return null
		}

		try {
			const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
				headers: {
					Authorization: `Bearer ${token}`
				}
			})

			if (res.status === 204) {
				// No content playing
				return null
			}

			if (res.status === 429) {
				const retryAfterHeader = res.headers.get('Retry-After')
				const retrySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5
				this.rateLimitedUntil = Date.now() + retrySeconds * 1000
				log.warn({ retrySeconds }, 'Spotify rate limited (429), backing off')
				return this.currentTrack
			}

			if (!res.ok) {
				log.warn({ status: res.status }, 'Spotify currently-playing API error')
				return null
			}

			const data = await res.json()
			if (!data || !data.item) {
				return null
			}

			const item = data.item
			const isPlaying = Boolean(data.is_playing)
			const isPaused = !isPlaying
			let title = (item.name || '').trim() || 'Unknown Title'

			// Pause suffix: append ⏸️ when paused
			if (isPaused && !title.endsWith('⏸️')) {
				title = `${title} ⏸️`
			}

			const artists = Array.isArray(item.artists)
				? item.artists.map((a: any) => a.name).join(', ')
				: 'Unknown Artist'

			const album = item.album?.name || 'Unknown Album'
			const trackNumber = item.track_number || 0

			return {
				title,
				artist: artists,
				album,
				trackNumber,
				isPlaying,
				isPaused,
				source: 'Spotify'
			}
		} catch (err) {
			log.error({ err }, 'Error querying Spotify currently-playing')
			return null
		}
	}

	public async start(): Promise<void> {
		if (this.isRunning) return
		this.isRunning = true

		const poll = async () => {
			if (!this.isRunning) return
			const track = await this.fetchCurrentlyPlaying()
			this.updateTrack(track)

			if (this.isRunning) {
				this.pollTimer = setTimeout(poll, this.pollIntervalMs)
			}
		}

		poll()
	}

	private updateTrack(track: MediaTrackInfo | null) {
		const oldTrack = this.currentTrack
		const changed =
			(!oldTrack && track) ||
			(oldTrack && !track) ||
			(oldTrack && track && (
				oldTrack.title !== track.title ||
				oldTrack.artist !== track.artist ||
				oldTrack.album !== track.album ||
				oldTrack.isPlaying !== track.isPlaying ||
				oldTrack.isPaused !== track.isPaused
			))

		if (changed) {
			this.currentTrack = track
			this.emit('track_change', track)
		}
	}

	public async getCurrentTrack(): Promise<MediaTrackInfo | null> {
		return this.currentTrack
	}

	public async stop(): Promise<void> {
		this.isRunning = false
		if (this.pollTimer) {
			clearTimeout(this.pollTimer)
			this.pollTimer = null
		}
		this.currentTrack = null
	}
}
