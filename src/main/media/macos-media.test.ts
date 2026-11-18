import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { MacosMediaSource, parseMacosHelperPayload } from './macos-media.js'

describe('MacosMediaSource', () => {
	it('resolves existing macos-media-helper.js script path', () => {
		const source = new MacosMediaSource()
		const scriptPath = source.getScriptPath()
		expect(scriptPath).toContain('macos-media-helper.js')
		expect(fs.existsSync(scriptPath)).toBe(true)
	})

	it('parses Playing track payloads cleanly', () => {
		const track = parseMacosHelperPayload({
			title: 'Instant Crush',
			artist: 'Daft Punk',
			album: 'Random Access Memories',
			track_number: 5,
			status: 'Playing',
			app: 'Music (com.apple.Music)'
		})

		expect(track).toEqual({
			title: 'Instant Crush',
			artist: 'Daft Punk',
			album: 'Random Access Memories',
			trackNumber: 5,
			isPlaying: true,
			isPaused: false,
			source: 'Local',
			app: 'Music (com.apple.Music)'
		})
	})

	it('parses Paused track payloads cleanly without mutating title', () => {
		const track = parseMacosHelperPayload({
			title: 'Midnight City',
			artist: 'M83',
			album: '',
			track_number: 0,
			status: 'Paused',
			app: 'Spotify (com.spotify.client)'
		})

		expect(track).toEqual({
			title: 'Midnight City',
			artist: 'M83',
			album: 'Unknown Album',
			trackNumber: 0,
			isPlaying: false,
			isPaused: true,
			source: 'Local',
			app: 'Spotify (com.spotify.client)'
		})
	})

	it('returns null for None/Stopped statuses', () => {
		expect(parseMacosHelperPayload({ status: 'None' })).toBeNull()
		expect(parseMacosHelperPayload({ status: 'Stopped' })).toBeNull()
	})

	it('emits track_change only when state actually changes and ignores errors/non-JSON lines', async () => {
		const source = new MacosMediaSource()
		const listener = vi.fn()
		source.on('track_change', listener)

		// Ignore noise and error payloads
		source.handleLine('')
		source.handleLine('not json')
		source.handleLine('{"error":"transient error"}')
		expect(listener).not.toHaveBeenCalled()

		// Playing track emits once
		const playingLine = JSON.stringify({
			title: 'Starboy',
			artist: 'The Weeknd',
			album: 'Starboy',
			track_number: 1,
			status: 'Playing',
			app: 'Safari (com.apple.Safari)'
		})
		source.handleLine(playingLine)
		source.handleLine(playingLine) // duplicate ignored
		expect(listener).toHaveBeenCalledTimes(1)
		expect(await source.getCurrentTrack()).toMatchObject({
			title: 'Starboy',
			artist: 'The Weeknd',
			isPlaying: true,
			isPaused: false
		})

		// Paused state emits update
		source.handleLine(
			JSON.stringify({
				title: 'Starboy',
				artist: 'The Weeknd',
				album: 'Starboy',
				track_number: 1,
				status: 'Paused',
				app: 'Safari (com.apple.Safari)'
			})
		)
		expect(listener).toHaveBeenCalledTimes(2)
		expect(await source.getCurrentTrack()).toMatchObject({
			isPlaying: false,
			isPaused: true
		})

		// Stopped/None clears track
		source.handleLine('{"status":"None"}')
		expect(listener).toHaveBeenCalledTimes(3)
		expect(await source.getCurrentTrack()).toBeNull()
	})
})
