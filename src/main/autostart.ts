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
		const isPackaged = app.isPackaged
		const execPath = process.execPath
		const args = isPackaged ? ['--hidden'] : [process.cwd(), '--hidden']

		let settings = app.getLoginItemSettings({ path: execPath, args })
		if (!settings.openAtLogin) {
			const fallback = app.getLoginItemSettings({ path: execPath })
			if (fallback.openAtLogin) {
				settings = fallback
			}
		}

		return {
			openAtLogin: settings.openAtLogin,
			executableWillLaunchAtLogin: Boolean(settings.executableWillLaunchAtLogin),
			executablePath: execPath
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

export function isStartedHidden(): boolean {
	if (process.argv.includes('--hidden') || process.argv.includes('--minimized')) {
		return true
	}
	try {
		const settings = app.getLoginItemSettings() as any
		if (settings?.wasOpenedAsHidden || settings?.wasOpenedAtLogin) {
			return true
		}
	} catch {}
	return false
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
			// On Windows, pass path and --hidden arg
			options.path = execPath
			options.args = enable ? (isPackaged ? ['--hidden'] : [process.cwd(), '--hidden']) : []
		} else if (process.platform === 'linux') {
			// On Linux, Electron writes ~/.config/autostart/
			options.path = execPath
			;(options as any).args = enable ? ['--hidden'] : []
		} else if (process.platform === 'darwin') {
			;(options as any).openAsHidden = enable
		}

		app.setLoginItemSettings(options)
		log.info({ enable, platform: process.platform, args: options.args }, 'Updated OS auto-start settings')
		return true
	} catch (err) {
		log.error({ err, enable }, 'Error updating auto-start settings')
		return false
	}
}
