import { describe, it, expect, afterEach } from 'vitest'
import { PluginSource } from './plugin.js'

describe('PluginSource', () => {
	let plugin: PluginSource | null = null

	afterEach(async () => {
		if (plugin) {
			await plugin.stop()
			plugin = null
		}
	})

	it('should start server and handle media and clear requests', async () => {
		// Use a random port in ephemeral range for testing
		const testPort = 18970
		plugin = new PluginSource(testPort)
		await plugin.start()

		let trackChanged = false
		plugin.on('track_change', () => {
			trackChanged = true
		})

		// 1. Check GET /api/status
		const statusRes = await fetch(`http://127.0.0.1:${testPort}/api/status`)
		expect(statusRes.status).toBe(200)
		const statusJson = await statusRes.json()
		expect(statusJson.status).toBe('online')
		expect(statusJson.source).toBe('Plugin')

		// 2. POST /api/media
		trackChanged = false
		const postRes = await fetch(`http://127.0.0.1:${testPort}/api/media`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: 'Test Song',
				artist: 'Test Artist',
				album: 'Test Album',
				is_playing: true,
				is_paused: false,
				app: 'Spotify Mobile',
				device: 'Pixel 9'
			})
		})

		expect(postRes.status).toBe(200)
		const postJson = await postRes.json()
		expect(postJson.success).toBe(true)
		expect(trackChanged).toBe(true)

		// Check current track
		const track = await plugin.getCurrentTrack()
		expect(track).not.toBeNull()
		expect(track?.title).toBe('Test Song')
		expect(track?.artist).toBe('Test Artist')
		expect(track?.customFields?.app).toBe('Spotify Mobile')
		expect(track?.customFields?.device).toBe('Pixel 9')

		// Check available placeholders
		const placeholders = plugin.getAvailablePlaceholders()
		expect(placeholders).toContain('[artist]')
		expect(placeholders).toContain('[title]')
		expect(placeholders).toContain('[app]')
		expect(placeholders).toContain('[device]')

		// 3. POST /api/clear
		trackChanged = false
		const clearRes = await fetch(`http://127.0.0.1:${testPort}/api/clear`, {
			method: 'POST'
		})
		expect(clearRes.status).toBe(200)
		expect(trackChanged).toBe(true)
		const clearedTrack = await plugin.getCurrentTrack()
		expect(clearedTrack).toBeNull()
	})

	it('should cleanly stop and release port so another server can listen on same port', async () => {
		const testPort = 18971
		const p1 = new PluginSource(testPort)
		await p1.start()
		const res1 = await fetch(`http://127.0.0.1:${testPort}/api/status`)
		expect(res1.status).toBe(200)

		await p1.stop()

		// Start second instance on exact same port immediately
		const p2 = new PluginSource(testPort)
		await p2.start()
		const res2 = await fetch(`http://127.0.0.1:${testPort}/api/status`)
		expect(res2.status).toBe(200)
		await p2.stop()
	})

	it('should reject start promise if port is occupied rather than hanging', async () => {
		const testPort = 18972
		const p1 = new PluginSource(testPort)
		await p1.start()

		// Attempt to start p2 on same port while p1 is still listening
		const p2 = new PluginSource(testPort)
		await expect(p2.start()).rejects.toThrow(/EADDRINUSE|Failed to bind/)

		await p1.stop()
	})
})