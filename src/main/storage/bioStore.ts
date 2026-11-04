import fs from 'node:fs'
import { getBioStorePath } from '../paths.js'
import { getLogger } from '../logger.js'

const log = getLogger('bioStore')

export interface BioRecord {
	bio: string
	savedAt: string
	restored: boolean
}

export function loadBioRecord(filePath: string = getBioStorePath()): BioRecord | null {
	try {
		if (!fs.existsSync(filePath)) {
			return null
		}
		const content = fs.readFileSync(filePath, 'utf-8')
		const parsed = JSON.parse(content) as BioRecord
		if (typeof parsed.bio === 'string' && typeof parsed.restored === 'boolean') {
			return parsed
		}
	} catch (err) {
		log.warn({ err }, 'Failed to parse existing bio store record')
	}
	return null
}

export function saveOriginalBio(bio: string, filePath: string = getBioStorePath()): void {
	const record: BioRecord = {
		bio,
		savedAt: new Date().toISOString(),
		restored: false
	}
	try {
		fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8')
		log.info({ bio }, 'Original bio saved to local store')
	} catch (err) {
		log.error({ err }, 'Failed to save original bio record')
	}
}

export function markBioRestored(filePath: string = getBioStorePath()): void {
	const current = loadBioRecord(filePath)
	if (!current) return
	current.restored = true
	try {
		fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf-8')
		log.info('Marked original bio as restored')
	} catch (err) {
		log.error({ err }, 'Failed to update bio record as restored')
	}
}

export function clearBioRecord(filePath: string = getBioStorePath()): void {
	try {
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath)
		}
	} catch (err) {
		log.error({ err }, 'Failed to delete bio store file')
	}
}
