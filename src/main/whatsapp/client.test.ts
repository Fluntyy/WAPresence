import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { WhatsAppClient } from './client.js'
import { saveOriginalBio, loadBioRecord } from '../storage/bioStore.js'

describe('WhatsAppClient verification logic', () => {
	let client: WhatsAppClient
	let mockSocket: any

	beforeEach(() => {
		client = new WhatsAppClient()
		mockSocket = {
			user: { id: '123456789:0@s.whatsapp.net' },
			updateProfileAbout: vi.fn().mockResolvedValue(undefined),
			fetchTextStatus: vi.fn().mockResolvedValue([
				{
					id: '123456789@s.whatsapp.net',
					text_status: {
						text: 'Listening to Daft Punk',
						emoji: undefined,
						ephemeralDurationSeconds: 86400,
						lastUpdateTime: new Date()
					}
				}
			]),
			logout: vi.fn().mockResolvedValue(undefined),
			end: vi.fn()
		}

		// Inject mock socket and ownJid for testing verification logic
		;(client as any).socket = mockSocket
		;(client as any).ownJid = '123456789@s.whatsapp.net'
	})

	it('successfully verifies when server returns expected status text', async () => {
		const result = await client.updateAboutWithVerification('Listening to Daft Punk')

		expect(mockSocket.updateProfileAbout).toHaveBeenCalledWith({
			text: 'Listening to Daft Punk',
			ephemeralDuration: 86400
		})
		expect(mockSocket.fetchTextStatus).toHaveBeenCalledWith('123456789@s.whatsapp.net')
		expect(result.verified).toBe(true)
		expect(result.serverText).toBe('Listening to Daft Punk')
	})

	it('fails verification and logs error when server returns mismatched text', async () => {
		mockSocket.fetchTextStatus.mockResolvedValueOnce([
			{
				id: '123456789@s.whatsapp.net',
				text_status: {
					text: 'Old Stale Status'
				}
			}
		])

		const result = await client.updateAboutWithVerification('Listening to Daft Punk')

		expect(result.verified).toBe(false)
		expect(result.expectedText).toBe('Listening to Daft Punk')
		expect(result.serverText).toBe('Old Stale Status')
		expect(result.error).toContain('Verification failed: wrote "Listening to Daft Punk", but server returned "Old Stale Status"')
	})

	it('truncates texts exceeding 50 characters before sending and verifying', async () => {
		const longText = 'A'.repeat(60)
		const expectedTruncated = 'A'.repeat(47) + '...'

		mockSocket.fetchTextStatus.mockResolvedValueOnce([
			{
				id: '123456789@s.whatsapp.net',
				text_status: {
					text: expectedTruncated
				}
			}
		])

		const result = await client.updateAboutWithVerification(longText)

		expect(mockSocket.updateProfileAbout).toHaveBeenCalledWith({
			text: expectedTruncated,
			ephemeralDuration: 86400
		})
		expect(result.verified).toBe(true)
		expect(result.expectedText).toBe(expectedTruncated)
	})

	it('gracefully handles server errors when updating status', async () => {
		mockSocket.updateProfileAbout.mockRejectedValueOnce(new Error('Connection reset by peer'))

		const result = await client.updateAboutWithVerification('Listening to music')

		expect(result.verified).toBe(false)
		expect(result.error).toBe('Connection reset by peer')
	})

	it('fetches current server status for manual "Verify now" action', async () => {
		const status = await client.fetchCurrentServerStatus()
		expect(status.text).toBe('Listening to Daft Punk')
		expect(status.ephemeralDurationSeconds).toBe(86400)
	})

	it('clears and removes status with text: null and duration: 0 when targetText is empty', async () => {
		mockSocket.fetchTextStatus.mockResolvedValueOnce([
			{
				id: '123456789@s.whatsapp.net',
				text_status: {
					text: undefined
				}
			}
		])

		const result = await client.updateAboutWithVerification('')

		expect(mockSocket.updateProfileAbout).toHaveBeenCalledWith({
			text: null,
			ephemeralDuration: 0
		})
		expect(result.verified).toBe(true)
		expect(result.serverText).toBe('')
	})

	it('stores and retrieves last QR data URL', () => {
		expect(client.getLastQr()).toBeNull()
		;(client as any).lastQrDataUrl = 'data:image/png;base64,test'
		expect(client.getLastQr()).toBe('data:image/png;base64,test')
	})

	it('requests pairing code with cleaned phone number', async () => {
		mockSocket.requestPairingCode = vi.fn().mockResolvedValue('ABCD1234')
		const code = await client.requestPairingCode('+62 (812) 3456-7890')
		expect(mockSocket.requestPairingCode).toHaveBeenCalledWith('6281234567890')
		expect(code).toBe('ABCD1234')
	})

	it('throws error when phone number is too short or invalid', async () => {
		await expect(client.requestPairingCode('123')).rejects.toThrow('too short')
	})
})

describe('WhatsAppClient bio crash recovery and restoration', () => {
	let client: WhatsAppClient
	let mockSocket: any
	let tempDir: string
	let tempBioFile: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-client-bio-'))
		tempBioFile = path.join(tempDir, 'original_bio.json')

		client = new WhatsAppClient(undefined, tempBioFile)
		mockSocket = {
			user: { id: '123456789:0@s.whatsapp.net' },
			updateProfileAbout: vi.fn().mockResolvedValue(undefined),
			fetchTextStatus: vi.fn().mockResolvedValue([
				{
					id: '123456789@s.whatsapp.net',
					text_status: {
						text: 'Listening to HIVI - Pelangi',
						emoji: undefined,
						ephemeralDurationSeconds: 86400,
						lastUpdateTime: new Date()
					}
				}
			]),
			logout: vi.fn().mockResolvedValue(undefined),
			end: vi.fn()
		}

		;(client as any).socket = mockSocket
		;(client as any).ownJid = '123456789@s.whatsapp.net'
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it('immediately restores blank bio on restart after crash and avoids querying server for song status', async () => {
		// Simulate crash: record exists with bio: "" and restored: false
		saveOriginalBio('', tempBioFile)

		await client.initializeBio()

		// Must NOT query server since server still has the song from the crashed session
		expect(mockSocket.fetchTextStatus).not.toHaveBeenCalled()
		// Must restore blank bio to WhatsApp (null text, duration 0)
		expect(mockSocket.updateProfileAbout).toHaveBeenCalledWith({
			text: null,
			ephemeralDuration: 0
		})
		expect(client.getOriginalBio()).toBe('')

		// Must keep record saved for current active session
		const record = loadBioRecord(tempBioFile)
		expect(record?.bio).toBe('')
		expect(record?.restored).toBe(false)
	})

	it('immediately restores custom text bio on restart after crash', async () => {
		// Simulate crash: record exists with custom bio and restored: false
		saveOriginalBio('Original Bio Before Crash', tempBioFile)

		await client.initializeBio()

		expect(mockSocket.fetchTextStatus).not.toHaveBeenCalled()
		expect(mockSocket.updateProfileAbout).toHaveBeenCalledWith({
			text: 'Original Bio Before Crash',
			ephemeralDuration: 86400
		})
		expect(client.getOriginalBio()).toBe('Original Bio Before Crash')

		const record = loadBioRecord(tempBioFile)
		expect(record?.bio).toBe('Original Bio Before Crash')
		expect(record?.restored).toBe(false)
	})

	it('queries server for bio on fresh session when no un-restored crash record exists', async () => {
		// No record in tempBioFile
		await client.initializeBio()

		expect(mockSocket.fetchTextStatus).toHaveBeenCalledWith('123456789@s.whatsapp.net')
		expect(client.getOriginalBio()).toBe('Listening to HIVI - Pelangi')

		const record = loadBioRecord(tempBioFile)
		expect(record?.bio).toBe('Listening to HIVI - Pelangi')
		expect(record?.restored).toBe(false)
	})

	it('queries server for bio if previous session was cleanly restored', async () => {
		saveOriginalBio('Cleanly Restored Bio', tempBioFile)
		const current = loadBioRecord(tempBioFile)!
		current.restored = true
		fs.writeFileSync(tempBioFile, JSON.stringify(current), 'utf-8')

		await client.initializeBio()

		// Since previous session was cleanly restored, it reads fresh bio from server
		expect(mockSocket.fetchTextStatus).toHaveBeenCalledWith('123456789@s.whatsapp.net')
	})

	it('restores bio cleanly with restoreOriginalBio()', async () => {
		;(client as any).originalBio = 'Custom Bio'
		const success = await client.restoreOriginalBio()

		expect(success).toBe(true)
		expect(mockSocket.updateProfileAbout).toHaveBeenCalledWith({
			text: 'Custom Bio',
			ephemeralDuration: 86400
		})
	})
})
