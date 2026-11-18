import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { getLogger } from './logger.js'

const log = getLogger('autostart')

export const MAC_LAUNCH_AGENT_LABEL = 'com.wapresence.app'

export interface AutoStartStatus {
	openAtLogin: boolean
	executableWillLaunchAtLogin: boolean
	executablePath: string
}

export function isAutoStartSupported(): boolean {
	return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux'
}

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

export function getMacLaunchAgentPath(homeDir?: string): string {
	return path.join(homeDir || os.homedir(), 'Library', 'LaunchAgents', `${MAC_LAUNCH_AGENT_LABEL}.plist`)
}

export function getMacProgramArgs(execPath: string, isPackaged: boolean, cwd: string): string[] {
	return isPackaged ? [execPath, '--hidden'] : [execPath, cwd, '--hidden']
}

export function buildMacLaunchAgentPlist(programArgs: string[], label: string = MAC_LAUNCH_AGENT_LABEL): string {
	const argsXml = programArgs.map((arg) => `\t\t<string>${escapeXml(arg)}</string>`).join('\n')
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		'<dict>',
		'\t<key>Label</key>',
		`\t<string>${escapeXml(label)}</string>`,
		'\t<key>ProgramArguments</key>',
		'\t<array>',
		argsXml,
		'\t</array>',
		'\t<key>RunAtLoad</key>',
		'\t<true/>',
		'\t<key>KeepAlive</key>',
		'\t<false/>',
		'\t<key>ProcessType</key>',
		'\t<string>Interactive</string>',
		'</dict>',
		'</plist>',
		''
	].join('\n')
}

function writeMacLaunchAgent(execPath: string, isPackaged: boolean): boolean {
	try {
		const plistPath = getMacLaunchAgentPath()
		const launchAgentsDir = path.dirname(plistPath)
		fs.mkdirSync(launchAgentsDir, { recursive: true })

		const programArgs = getMacProgramArgs(execPath, isPackaged, process.cwd())
		const plistContent = buildMacLaunchAgentPlist(programArgs)

		// Avoid rewriting if identical so macOS does not re-trigger the "Background Items Added" notification on every launch
		if (fs.existsSync(plistPath)) {
			try {
				const existing = fs.readFileSync(plistPath, 'utf-8')
				if (existing === plistContent) {
					return true
				}
			} catch {}
		}

		fs.writeFileSync(plistPath, plistContent, { encoding: 'utf-8', mode: 0o644 })
		log.info({ plistPath, programArgs }, 'Wrote macOS LaunchAgent plist for login startup')
		return true
	} catch (err) {
		log.error({ err }, 'Failed to write macOS LaunchAgent plist')
		return false
	}
}

function removeMacLaunchAgent(): void {
	try {
		const plistPath = getMacLaunchAgentPath()
		if (fs.existsSync(plistPath)) {
			fs.unlinkSync(plistPath)
			log.info({ plistPath }, 'Removed macOS LaunchAgent plist')
		}
	} catch (err) {
		log.warn({ err }, 'Failed to remove macOS LaunchAgent plist')
	}
}

export function getAutoStartStatus(): AutoStartStatus {
	try {
		const isPackaged = app.isPackaged
		const execPath = process.execPath

		if (process.platform === 'darwin') {
			const settings = app.getLoginItemSettings()
			const hasLaunchAgent = fs.existsSync(getMacLaunchAgentPath())
			const enabled = Boolean(settings.openAtLogin || hasLaunchAgent)
			return {
				openAtLogin: enabled,
				executableWillLaunchAtLogin: Boolean(settings.executableWillLaunchAtLogin || hasLaunchAgent),
				executablePath: execPath
			}
		}

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

		if (process.platform === 'darwin') {
			// Modern macOS (13+ Ventura/Sonoma/Sequoia) uses SMAppService via setLoginItemSettings
			// without deprecated openAsHidden. Unsigned builds fail silently in SMAppService, so
			// verify registration and fall back to ~/Library/LaunchAgents/com.wapresence.app.plist,
			// which registers in System Settings -> Login Items & triggers the native notification.
			let nativeRegistered = false
			try {
				app.setLoginItemSettings({ openAtLogin: enable })
				if (enable) {
					nativeRegistered = Boolean(app.getLoginItemSettings().openAtLogin)
				}
			} catch (err) {
				log.warn({ err, enable }, 'Electron setLoginItemSettings failed on macOS; using LaunchAgent fallback')
			}

			if (enable) {
				if (nativeRegistered) {
					removeMacLaunchAgent()
					log.info({ enable, platform: 'darwin', method: 'SMAppService' }, 'Updated macOS auto-start settings')
					return true
				}
				const plistOk = writeMacLaunchAgent(execPath, isPackaged)
				log.info({ enable, platform: 'darwin', method: 'LaunchAgent', plistOk }, 'Updated macOS auto-start settings')
				return plistOk
			} else {
				removeMacLaunchAgent()
				log.info({ enable, platform: 'darwin' }, 'Disabled macOS auto-start settings')
				return true
			}
		}

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
		}

		app.setLoginItemSettings(options)
		log.info({ enable, platform: process.platform, args: options.args }, 'Updated OS auto-start settings')
		return true
	} catch (err) {
		log.error({ err, enable }, 'Error updating auto-start settings')
		return false
	}
}
