import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

let electronApp: any = null
if (process.versions && process.versions.electron) {
	try {
		const electron = await import('electron')
		electronApp = electron.app || (electron.default && electron.default.app)
	} catch {
		electronApp = null
	}
}

export function getAppDataDir(): string {
	if (electronApp && typeof electronApp.getPath === 'function') {
		const dir = electronApp.getPath('userData')
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		return dir
	}

	const platform = process.platform
	let baseDir = ''

	if (platform === 'win32') {
		baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
	} else if (platform === 'darwin') {
		baseDir = path.join(os.homedir(), 'Library', 'Application Support')
	} else {
		baseDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
	}

	const appDir = path.join(baseDir, 'WAPresence')
	if (!fs.existsSync(appDir)) {
		fs.mkdirSync(appDir, { recursive: true })
	}
	return appDir
}

export function getAuthDir(): string {
	const dir = path.join(getAppDataDir(), 'baileys_auth')
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
	return dir
}

export function getBioStorePath(): string {
	return path.join(getAppDataDir(), 'original_bio.json')
}

export function getSpotifyTokensPath(): string {
	return path.join(getAppDataDir(), 'spotify_tokens.json')
}

export function getLogFilePath(): string {
	return path.join(getAppDataDir(), 'wapresence.log')
}

export function getConfigPath(): string {
	const cwdConfig = path.resolve(process.cwd(), 'config.ini')
	if (fs.existsSync(cwdConfig) && (!electronApp || !electronApp.isPackaged)) {
		return cwdConfig
	}
	return path.join(getAppDataDir(), 'config.ini')
}
