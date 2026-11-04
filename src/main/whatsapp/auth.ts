import fs from 'node:fs'
import { useMultiFileAuthState } from '@whiskeysockets/baileys'
import { getAuthDir } from '../paths.js'
import { getLogger } from '../logger.js'

const log = getLogger('whatsapp:auth')

export async function initAuthState(customAuthDir?: string) {
	const authDir = customAuthDir || getAuthDir()
	log.info({ authDir }, 'Initializing Baileys multi-file auth state')
	const authState = await useMultiFileAuthState(authDir)
	return {
		state: authState.state,
		saveCreds: authState.saveCreds,
		authDir
	}
}

export function clearAuthState(customAuthDir?: string) {
	const authDir = customAuthDir || getAuthDir()
	if (fs.existsSync(authDir)) {
		try {
			fs.rmSync(authDir, { recursive: true, force: true })
			log.info({ authDir }, 'Cleared auth state directory')
		} catch (err) {
			log.error({ err, authDir }, 'Failed to clear auth state directory')
		}
	}
}
