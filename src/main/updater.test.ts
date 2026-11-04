import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PresenceUpdater } from './updater.js'
import { AppConfig, getDefaultConfig } from './config.js'
import { IMediaSource, MediaTrackInfo } from './media/types.js'

class FakeMediaSource extends EventEmitter implements IMediaSource {
	readonly name = 'Fake'
	public currentTrack: MediaTrackInfo | null = null

	async start() {}
	async stop() {}
	async getCurrentTrack() {
		return this.currentTrack
	}

	setTrack(track: MediaTrackInfo | null) {
		this.currentTrack = track
		this.emit('track_change', track)
	}
}

describe('PresenceUpdater', () => {
	let fakeClient: any
	let fakeMedia: FakeMediaSource
	let config: AppConfig
	let updater: PresenceUpdater

	beforeEach(() => {
		fakeClient = {
			getState: vi.fn().mockReturnValue('connected'),
			getOriginalBio: vi.fn().mockReturnValue('My Default Bio'),
			updateAboutWithVerification: vi.fn().mockImplementation(async (text: string) => {
				return {
					verified: true,
					expectedText: text,
					serverText: text
				}
			}),
			restoreOriginalBio: vi.fn().mockResolvedValue(true)
		}

		fakeMedia = new FakeMediaSource()
		config = {
			...getDefaultConfig(),
			updateEvery: 1,
			format: 'Listening to [artist] - [title]'
		}

		updater = new PresenceUpdater(fakeClient, config, fakeMedia)
	})

	afterEach(async () => {
		await updater.stop()
	})

	it('updates WhatsApp About when a track is playing and verified', async () => {
		fakeMedia.currentTrack = {
			artist: 'The Beatles',
			title: 'Yesterday',
			album: 'Help!',
			trackNumber: 13,
			isPlaying: true,
			isPaused: false
		}

		await updater.start()
		// Wait for initial tick
		await new Promise((r) => setTimeout(r, 50))

		expect(fakeClient.updateAboutWithVerification).toHaveBeenCalledWith('Listening to The Beatles - Yesterday')
		expect(updater.getStatus().lastWrittenText).toBe('Listening to The Beatles - Yesterday')
	})

	it('skips writing to WhatsApp if the formatted text is unchanged', async () => {
		fakeMedia.currentTrack = {
			artist: 'The Beatles',
			title: 'Yesterday',
			album: 'Help!',
			isPlaying: true,
			isPaused: false
		}

		await updater.start()
		await new Promise((r) => setTimeout(r, 50))
		expect(fakeClient.updateAboutWithVerification).toHaveBeenCalledTimes(1)

		// Second tick with identical track
		await updater.tick()
		expect(fakeClient.updateAboutWithVerification).toHaveBeenCalledTimes(1)
	})

	it('applies exponential backoff when verification fails', async () => {
		fakeClient.updateAboutWithVerification.mockResolvedValueOnce({
			verified: false,
			expectedText: 'Listening to Queen - Bohemian Rhapsody',
			serverText: 'Stale Server Status',
			error: 'Mismatch'
		})

		fakeMedia.currentTrack = {
			artist: 'Queen',
			title: 'Bohemian Rhapsody',
			isPlaying: true,
			isPaused: false
		}

		await updater.start()
		await new Promise((r) => setTimeout(r, 50))

		const status = updater.getStatus()
		expect(status.isBackingOff).toBe(true)
		expect(status.lastWrittenText).toBeNull() // Not recorded because verification failed

		// Immediate second tick should be skipped due to backoff
		await updater.tick()
		expect(fakeClient.updateAboutWithVerification).toHaveBeenCalledTimes(1)
	})

	it('reverts to original bio when media is stopped or null', async () => {
		fakeMedia.currentTrack = null

		await updater.start()
		await new Promise((r) => setTimeout(r, 50))

		expect(fakeClient.updateAboutWithVerification).toHaveBeenCalledWith('My Default Bio')
	})

	it('clears/removes status when media is stopped and original bio is empty', async () => {
		fakeClient.getOriginalBio.mockReturnValue('')
		fakeMedia.currentTrack = null

		await updater.start()
		await new Promise((r) => setTimeout(r, 50))

		expect(fakeClient.updateAboutWithVerification).toHaveBeenCalledWith('')
	})
})
