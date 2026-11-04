import { EventEmitter } from 'node:events'
import { IMediaSource, MediaTrackInfo } from './types.js'
import { getLogger } from '../logger.js'

const log = getLogger('media:linux')

export class LinuxMprisSource extends EventEmitter implements IMediaSource {
	readonly name = 'Local'
	private bus: any = null
	private currentTrack: MediaTrackInfo | null = null
	private isRunning: boolean = false
	private trackedPlayers: Map<string, any> = new Map()

	public async start(): Promise<void> {
		if (this.isRunning) return
		this.isRunning = true

		if (process.platform !== 'linux') {
			log.warn('Linux MPRIS is only supported on Linux')
			return
		}

		try {
			const dbus = await import('dbus-next')
			this.bus = dbus.sessionBus()

			await this.discoverPlayers()
			this.listenToNameOwnerChanged()
		} catch (err) {
			log.error({ err }, 'Failed to initialize Linux MPRIS D-Bus')
		}
	}

	private async discoverPlayers(): Promise<void> {
		if (!this.bus) return
		try {
			const dbusObj = await this.bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
			const dbusIface = dbusObj.getInterface('org.freedesktop.DBus')
			const names: string[] = await dbusIface.ListNames()

			const mprisNames = names.filter((n) => n.startsWith('org.mpris.MediaPlayer2.'))
			for (const name of mprisNames) {
				await this.attachToPlayer(name)
			}
			await this.refreshCurrentTrack()
		} catch (err) {
			log.error({ err }, 'Error discovering MPRIS players')
		}
	}

	private async listenToNameOwnerChanged(): Promise<void> {
		if (!this.bus) return
		try {
			const dbusObj = await this.bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')
			const dbusIface = dbusObj.getInterface('org.freedesktop.DBus')

			dbusIface.on('NameOwnerChanged', async (name: string, oldOwner: string, newOwner: string) => {
				if (!name.startsWith('org.mpris.MediaPlayer2.')) return

				if (newOwner && !oldOwner) {
					// Player appeared
					log.info({ name }, 'MPRIS player appeared')
					await this.attachToPlayer(name)
					await this.refreshCurrentTrack()
				} else if (!newOwner && oldOwner) {
					// Player exited
					log.info({ name }, 'MPRIS player disappeared')
					this.trackedPlayers.delete(name)
					await this.refreshCurrentTrack()
				}
			})
		} catch (err) {
			log.error({ err }, 'Failed to attach to NameOwnerChanged')
		}
	}

	private async attachToPlayer(serviceName: string): Promise<void> {
		if (this.trackedPlayers.has(serviceName) || !this.bus) return

		try {
			const playerObj = await this.bus.getProxyObject(serviceName, '/org/mpris/MediaPlayer2')
			const propertiesIface = playerObj.getInterface('org.freedesktop.DBus.Properties')

			const listener = async (ifaceName: string) => {
				if (ifaceName === 'org.mpris.MediaPlayer2.Player') {
					await this.refreshCurrentTrack()
				}
			}

			propertiesIface.on('PropertiesChanged', listener)
			this.trackedPlayers.set(serviceName, { playerObj, propertiesIface, listener })
		} catch (err) {
			log.debug({ err, serviceName }, 'Could not attach to player properties')
		}
	}

	public async refreshCurrentTrack(): Promise<void> {
		let activeTrack: MediaTrackInfo | null = null

		for (const [serviceName, entry] of this.trackedPlayers) {
			try {
				const playerIface = entry.playerObj.getInterface('org.mpris.MediaPlayer2.Player')
				const playbackStatusVariant = await playerIface.PlaybackStatus
				const playbackStatus = playbackStatusVariant?.value || playbackStatusVariant

				if (playbackStatus !== 'Playing' && playbackStatus !== 'Paused') {
					continue
				}

				const metadataVariant = await playerIface.Metadata
				const metadata = metadataVariant?.value || metadataVariant || {}

				const unwrap = (val: any) => (val && val.value !== undefined ? val.value : val)

				const rawTitle = unwrap(metadata['xesam:title']) || ''
				const rawArtist = unwrap(metadata['xesam:artist'])
				const rawAlbum = unwrap(metadata['xesam:album']) || ''
				const rawTrackNum = unwrap(metadata['xesam:trackNumber'])

				const artist = Array.isArray(rawArtist) ? rawArtist.join(', ') : (rawArtist || 'Unknown Artist')
				const album = rawAlbum || 'Unknown Album'
				const trackNumber = typeof rawTrackNum === 'number' ? rawTrackNum : 0
				const isPaused = playbackStatus === 'Paused'
				const isPlaying = playbackStatus === 'Playing'

				let title = rawTitle || 'Unknown Title'
				if (isPaused && !title.endsWith('⏸️')) {
					title = `${title} ⏸️`
				}

				activeTrack = {
					title,
					artist,
					album,
					trackNumber,
					isPlaying,
					isPaused,
					source: 'Local'
				}

				if (isPlaying) {
					// Prefer an actively playing player over paused
					break
				}
			} catch (err) {
				// Player might have closed
			}
		}

		this.updateTrack(activeTrack)
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
		this.trackedPlayers.clear()
		if (this.bus) {
			try {
				this.bus.disconnect()
			} catch {}
			this.bus = null
		}
		this.currentTrack = null
	}
}
