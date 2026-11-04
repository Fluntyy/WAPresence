import { EventEmitter } from 'node:events'
import http from 'node:http'
import { IMediaSource, MediaTrackInfo } from './types.js'
import { getAvailablePlaceholders } from '../format.js'
import { getLogger } from '../logger.js'

const log = getLogger('media:plugin')

export interface PluginMediaPayload {
	title?: string
	artist?: string
	album?: string
	track_number?: number | string
	trackNumber?: number | string
	is_playing?: boolean
	isPlaying?: boolean
	is_paused?: boolean
	isPaused?: boolean
	fields?: Record<string, any>
	[key: string]: any
}

export class PluginSource extends EventEmitter implements IMediaSource {
	readonly name = 'Plugin'
	private port: number
	private server: http.Server | null = null
	private currentTrack: MediaTrackInfo | null = null
	private isRunning: boolean = false
	private detectedPlaceholders: Set<string> = new Set()

	constructor(port: number = 6970) {
		super()
		this.port = port
	}

	public setPort(port: number) {
		this.port = port
	}

	public getPort(): number {
		return this.port
	}

	public getAvailablePlaceholders(): string[] {
		const custom: Record<string, any> = {}
		for (const p of this.detectedPlaceholders) {
			const clean = p.replace(/^\[/, '').replace(/\]$/, '')
			custom[clean] = true
		}
		return getAvailablePlaceholders(custom)
	}

	public async start(): Promise<void> {
		if (this.isRunning) return
		this.isRunning = true

		this.server = http.createServer((req, res) => {
			// Allow CORS for browser extensions and companion clients
			res.setHeader('Access-Control-Allow-Origin', '*')
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

			if (req.method === 'OPTIONS') {
				res.writeHead(204)
				res.end()
				return
			}

			const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)

			if (req.method === 'GET' && (url.pathname === '/api/status' || url.pathname === '/status')) {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(
					JSON.stringify({
						status: 'online',
						source: 'Plugin',
						current_track: this.currentTrack,
						placeholders: this.getAvailablePlaceholders()
					})
				)
				return
			}

			if (req.method === 'POST' && (url.pathname === '/api/clear' || url.pathname === '/clear')) {
				this.updateCurrentTrack(null)
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ success: true, message: 'Media cleared, bio restored' }))
				return
			}

			if (req.method === 'POST' && (url.pathname === '/api/media' || url.pathname === '/api/presence' || url.pathname === '/')) {
				let body = ''
				req.on('data', (chunk) => {
					body += chunk
					// Max 1MB body protection
					if (body.length > 1e6) {
						req.destroy()
					}
				})

				req.on('end', () => {
					try {
						const payload: PluginMediaPayload = body ? JSON.parse(body) : {}
						this.handlePayload(payload)
						res.writeHead(200, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify({ success: true, received: this.currentTrack }))
					} catch (err: any) {
						log.warn({ err }, 'Invalid JSON payload received on plugin webhook')
						res.writeHead(400, { 'Content-Type': 'application/json' })
						res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
					}
				})
				return
			}

			res.writeHead(404, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ error: 'Not Found' }))
		})

		return new Promise((resolve) => {
			this.server?.listen(this.port, '127.0.0.1', () => {
				log.info({ port: this.port }, 'Plugin HTTP webhook server listening')
				resolve()
			})

			this.server?.on('error', (err: any) => {
				log.error({ err, port: this.port }, 'Plugin HTTP server error')
			})
		})
	}

	private handlePayload(payload: PluginMediaPayload) {
		const isPlaying = payload.is_playing ?? payload.isPlaying ?? true
		const isPaused = payload.is_paused ?? payload.isPaused ?? false
		const rawTitle = (payload.title || '').trim()

		if (!rawTitle || (!isPlaying && !isPaused)) {
			this.updateCurrentTrack(null)
			return
		}

		const artist = (payload.artist || '').trim() || 'Unknown Artist'
		const album = (payload.album || '').trim() || 'Unknown Album'
		const trackNumber = payload.track_number ?? payload.trackNumber ?? 0

		// Extract any custom fields
		const customFields: Record<string, string | number> = {}

		// Nested fields object
		if (payload.fields && typeof payload.fields === 'object') {
			for (const [k, v] of Object.entries(payload.fields)) {
				if (v !== undefined && v !== null) {
					customFields[k] = v
					this.detectedPlaceholders.add(`[${k.toLowerCase()}]`)
				}
			}
		}

		// Also collect any top-level non-standard keys
		const knownKeys = new Set([
			'title', 'artist', 'album', 'track_number', 'trackNumber',
			'is_playing', 'isPlaying', 'is_paused', 'isPaused', 'fields'
		])

		for (const [k, v] of Object.entries(payload)) {
			if (!knownKeys.has(k) && (typeof v === 'string' || typeof v === 'number')) {
				customFields[k] = v
				this.detectedPlaceholders.add(`[${k.toLowerCase()}]`)
			}
		}

		const newTrack: MediaTrackInfo = {
			title: rawTitle,
			artist,
			album,
			trackNumber,
			isPlaying,
			isPaused,
			source: 'Plugin',
			customFields: Object.keys(customFields).length > 0 ? customFields : undefined
		}

		this.emit('placeholders_change', this.getAvailablePlaceholders())
		this.updateCurrentTrack(newTrack)
	}

	private updateCurrentTrack(track: MediaTrackInfo | null) {
		const oldTrack = this.currentTrack
		const changed =
			(!oldTrack && track) ||
			(oldTrack && !track) ||
			(oldTrack && track && (
				oldTrack.title !== track.title ||
				oldTrack.artist !== track.artist ||
				oldTrack.album !== track.album ||
				oldTrack.isPlaying !== track.isPlaying ||
				oldTrack.isPaused !== track.isPaused ||
				JSON.stringify(oldTrack.customFields) !== JSON.stringify(track.customFields)
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
		if (this.server) {
			try {
				this.server.close()
			} catch {}
			this.server = null
		}
		this.currentTrack = null
	}
}
