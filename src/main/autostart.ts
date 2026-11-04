import { app } from 'electron'
import { getLogger } from './logger.js'

const log = getLogger('autostart')

export interface AutoStartStatus {
	openAtLogin: boolean
	executableWillLaunchAtLogin: boolean
	executablePath: string
}

export function isAutoStartSupported(): boolean {
	return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux'
}

export function getAutoStartStatus(): AutoStartStatus {
	try {
		const settings = app.getLoginItemSettings()
		return {
			openAtLogin: settings.openAtLogin,
			executableWillLaunchAtLogin: Boolean(settings.executableWillLaunchAtLogin),
			executablePath: process.execPath
		}
	} catch (err) {
		log.warn({ err }, 'Failed to query login item settings')
		return {
			openAtLogin: false,
			executableWillLaunchAtLogin: false,
			executablePath: process.execPath
		}
	}
}

export function setAutoStart(enable: boolean): boolean {
	if (!isAutoStartSupported()) {
		log.warn(`Auto-start is not supported on platform: ${process.platform}`)
		return false
	}

	try {
		const isPackaged = app.isPackaged
		const execPath = process.execPath

		const options: Electron.Settings = {
			openAtLogin: enable
		}

		if (process.platform === 'win32') {
			// On Windows, pass path and args
			options.path = execPath
			options.args = isPackaged ? [] : [process.cwd()]
		} else if (process.platform === 'linux') {
			// On Linux, Electron writes ~/.config/autostart/
			options.path = execPath
		}

		app.setLoginItemSettings(options)
		log.info({ enable, platform: process.platform }, 'Updated OS auto-start settings')
		return true
	} catch (err) {
		log.error({ err, enable }, 'Error updating auto-start settings')
		return false
	}
}
