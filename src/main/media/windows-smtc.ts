import { EventEmitter } from 'node:events'
import { spawn, ChildProcess } from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { IMediaSource, MediaTrackInfo } from './types.js'
import { getLogger } from '../logger.js'

const log = getLogger('media:windows')

export class WindowsSmtcSource extends EventEmitter implements IMediaSource {
	readonly name = 'Local'
	private process: ChildProcess | null = null
	private currentTrack: MediaTrackInfo | null = null
	private isRunning: boolean = false

	private getScriptPath(): string {
		// Handle ESM __dirname
		const currentFile = fileURLToPath(import.meta.url)
		const currentDir = path.dirname(currentFile)

		// Candidate 1: app.asar.unpacked if packaged with asarUnpack
		const unpackedDir = currentDir.replace('app.asar', 'app.asar.unpacked')
		const unpackedFile = path.join(unpackedDir, 'smtc-helper.ps1')
		if (fs.existsSync(unpackedFile)) return unpackedFile

		// Candidate 2: same directory (dist/main/media/smtc-helper.ps1)
		const sameDir = path.join(currentDir, 'smtc-helper.ps1')
		if (fs.existsSync(sameDir)) return sameDir

		// Candidate 3: src directory during dev/vitest (src/main/media/smtc-helper.ps1)
		const srcDir = path.resolve(currentDir, '..', '..', 'src', 'main', 'media', 'smtc-helper.ps1')
		if (fs.existsSync(srcDir)) return srcDir

		// Candidate 4: root relative
		const rootPath = path.resolve(process.cwd(), 'src', 'main', 'media', 'smtc-helper.ps1')
		if (fs.existsSync(rootPath)) return rootPath

		return sameDir
	}

	public async start(): Promise<void> {
		if (this.isRunning) return
		this.isRunning = true

		if (process.platform !== 'win32') {
			log.warn('Windows SMTC is not supported on non-Windows platforms')
			return
		}

		const scriptPath = this.getScriptPath()
		log.info({ scriptPath }, 'Starting Windows SMTC helper process')

		try {
			this.process = spawn(
				'powershell.exe',
				['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
				{
					stdio: ['ignore', 'pipe', 'pipe'],
					windowsHide: true
				}
			)

			if (!this.process.stdout) {
				log.error('Failed to attach to SMTC helper stdout')
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
				log.warn({ stderr: data.toString() }, 'SMTC helper stderr output')
			})

			this.process.on('close', (code) => {
				log.info({ code }, 'SMTC helper process exited')
				this.process = null
				if (this.isRunning) {
					// Restart after 3s if unexpectedly closed
					setTimeout(() => {
						if (this.isRunning) {
							this.start()
						}
					}, 3000)
				}
			})
		} catch (err) {
			log.error({ err }, 'Failed to spawn SMTC helper process')
		}
	}

	private handleLine(line: string) {
		if (!line || !line.startsWith('{')) return

		try {
			const data = JSON.parse(line)
			if (data.error) {
				log.warn({ error: data.error }, 'SMTC helper reported error')
				return
			}

			const status = data.status
			if (status === 'Playing' || status === 'Paused') {
				const isPaused = status === 'Paused'
				const isPlaying = status === 'Playing'
				let title = (data.title || '').trim() || 'Unknown Title'

				// Append " ⏸️" to the title when paused
				if (isPaused && !title.endsWith('⏸️')) {
					title = `${title} ⏸️`
				}

				const newTrack: MediaTrackInfo = {
					title,
					artist: (data.artist || '').trim() || 'Unknown Artist',
					album: (data.album || '').trim() || 'Unknown Album',
					trackNumber: data.track_number || 0,
					isPlaying,
					isPaused,
					source: 'Local'
				}

				this.updateCurrentTrack(newTrack)
			} else {
				this.updateCurrentTrack(null)
			}
		} catch (err) {
			log.debug({ err, line }, 'Failed to parse JSON from SMTC helper')
		}
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
		if (this.process) {
			try {
				this.process.kill()
			} catch (err) {
				log.warn({ err }, 'Error killing SMTC helper process')
			}
			this.process = null
		}
		this.currentTrack = null
	}
}
