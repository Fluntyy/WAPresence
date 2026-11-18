import { EventEmitter } from 'node:events'
import { spawn, ChildProcess } from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { IMediaSource, MediaTrackInfo } from './types.js'
import { getLogger } from '../logger.js'

const log = getLogger('media:macos')

export const MACOS_HELPER_FILENAME = 'macos-media-helper.js'

export interface MacosHelperPayload {
	title?: string
	artist?: string
	album?: string
	track_number?: number
	status?: string
	app?: string
	error?: string
}

export function parseMacosHelperPayload(data: MacosHelperPayload): MediaTrackInfo | null {
	const status = data.status
	if (status === 'Playing' || status === 'Paused') {
		const isPaused = status === 'Paused'
		const isPlaying = status === 'Playing'
		const title = (data.title || '').trim() || 'Unknown Title'
		const artist = (data.artist || '').trim() || 'Unknown Artist'
		const album = (data.album || '').trim() || 'Unknown Album'

		return {
			title,
			artist,
			album,
			trackNumber: typeof data.track_number === 'number' && data.track_number > 0 ? data.track_number : 0,
			isPlaying,
			isPaused,
			source: 'Local',
			app: (data.app || '').trim()
		}
	}

	return null
}

export class MacosMediaSource extends EventEmitter implements IMediaSource {
	readonly name = 'Local'
	private process: ChildProcess | null = null
	private currentTrack: MediaTrackInfo | null = null
	private isRunning: boolean = false
	private restartTimer: NodeJS.Timeout | null = null

	public getScriptPath(): string {
		const currentFile = fileURLToPath(import.meta.url)
		const currentDir = path.dirname(currentFile)

		// Candidate 1: app.asar.unpacked if packaged with asarUnpack
		const unpackedDir = currentDir.replace('app.asar', 'app.asar.unpacked')
		const unpackedFile = path.join(unpackedDir, MACOS_HELPER_FILENAME)
		if (fs.existsSync(unpackedFile)) return unpackedFile

		// Candidate 2: same directory (dist/main/media/macos-media-helper.js)
		const sameDir = path.join(currentDir, MACOS_HELPER_FILENAME)
		if (fs.existsSync(sameDir)) return sameDir

		// Candidate 3: src directory during dev/vitest (src/main/media/macos-media-helper.js)
		const srcDir = path.resolve(currentDir, '..', '..', 'src', 'main', 'media', MACOS_HELPER_FILENAME)
		if (fs.existsSync(srcDir)) return srcDir

		// Candidate 4: root relative
		const rootPath = path.resolve(process.cwd(), 'src', 'main', 'media', MACOS_HELPER_FILENAME)
		if (fs.existsSync(rootPath)) return rootPath

		return sameDir
	}

	public async start(): Promise<void> {
		if (this.isRunning) return
		this.isRunning = true

		if (process.platform !== 'darwin') {
			log.warn('macOS Now Playing helper is only supported on macOS')
			return
		}

		this.spawnHelper()
	}

	private spawnHelper() {
		if (!this.isRunning) return

		const scriptPath = this.getScriptPath()
		log.info({ scriptPath }, 'Starting macOS Now Playing helper process')

		try {
			this.process = spawn('/usr/bin/osascript', ['-l', 'JavaScript', scriptPath], {
				stdio: ['ignore', 'pipe', 'pipe']
			})

			if (!this.process.stdout) {
				log.error('Failed to attach to macOS media helper stdout')
				return
			}

			const rl = readline.createInterface({
				input: this.process.stdout,
				terminal: false
			})

			rl.on('line', (line) => {
				this.handleLine(line.trim())
			})

			this.process.stderr?.on('data', (data) => {
				const text = data.toString().trim()
				if (text) {
					log.warn({ stderr: text }, 'macOS media helper stderr output')
				}
			})

			this.process.on('error', (err) => {
				log.error({ err }, 'macOS media helper process error')
			})

			this.process.on('close', (code) => {
				log.info({ code }, 'macOS media helper process exited')
				this.process = null
				if (this.isRunning) {
					// Restart cleanly (either after periodic recycle or unexpected exit)
					const delayMs = code === 0 ? 500 : 3000
					this.restartTimer = setTimeout(() => {
						this.restartTimer = null
						if (this.isRunning) {
							this.spawnHelper()
						}
					}, delayMs)
				}
			})
		} catch (err) {
			log.error({ err }, 'Failed to spawn macOS media helper process')
		}
	}

	public handleLine(line: string) {
		if (!line || !line.startsWith('{')) return

		try {
			const data = JSON.parse(line) as MacosHelperPayload
			if (data.error) {
				log.warn({ error: data.error }, 'macOS media helper reported error')
				return
			}

			const newTrack = parseMacosHelperPayload(data)
			this.updateCurrentTrack(newTrack)
		} catch (err) {
			log.debug({ err, line }, 'Failed to parse JSON from macOS media helper')
		}
	}

	private updateCurrentTrack(track: MediaTrackInfo | null) {
		const oldTrack = this.currentTrack
		const changed =
			(!oldTrack && track) ||
			(oldTrack && !track) ||
			(oldTrack &&
				track &&
				(oldTrack.title !== track.title ||
					oldTrack.artist !== track.artist ||
					oldTrack.album !== track.album ||
					oldTrack.trackNumber !== track.trackNumber ||
					oldTrack.isPlaying !== track.isPlaying ||
					oldTrack.isPaused !== track.isPaused ||
					oldTrack.app !== track.app))

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
		if (this.restartTimer) {
			clearTimeout(this.restartTimer)
			this.restartTimer = null
		}
		if (this.process) {
			try {
				this.process.kill('SIGTERM')
			} catch (err) {
				log.warn({ err }, 'Error killing macOS media helper process')
			}
			this.process = null
		}
		this.currentTrack = null
	}
}
