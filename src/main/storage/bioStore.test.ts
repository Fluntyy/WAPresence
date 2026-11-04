import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadBioRecord, saveOriginalBio, markBioRestored, clearBioRecord } from './bioStore.js'

describe('bioStore', () => {
	let tempDir: string
	let tempFile: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biostore-test-'))
		tempFile = path.join(tempDir, 'original_bio.json')
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it('returns null if file does not exist', () => {
		expect(loadBioRecord(tempFile)).toBeNull()
	})

	it('saves original bio with restored=false', () => {
		saveOriginalBio('Hello World Bio', tempFile)
		const record = loadBioRecord(tempFile)
		expect(record).not.toBeNull()
		expect(record?.bio).toBe('Hello World Bio')
		expect(record?.restored).toBe(false)
		expect(record?.savedAt).toBeDefined()
	})

	it('marks bio as restored', () => {
		saveOriginalBio('Status update', tempFile)
		markBioRestored(tempFile)
		const record = loadBioRecord(tempFile)
		expect(record?.restored).toBe(true)
	})

	it('clears bio record', () => {
		saveOriginalBio('To be cleared', tempFile)
		expect(fs.existsSync(tempFile)).toBe(true)
		clearBioRecord(tempFile)
		expect(fs.existsSync(tempFile)).toBe(false)
	})
})
