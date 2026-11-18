import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
	app: {
		getVersion: () => '1.2.1',
		isPackaged: true,
		exit: vi.fn()
	}
}))

vi.mock('electron-updater', () => ({
	default: {
		autoUpdater: {
			autoDownload: false,
			autoInstallOnAppQuit: true,
			setFeedURL: vi.fn(),
			on: vi.fn(),
			checkForUpdates: vi.fn(),
			downloadUpdate: vi.fn(),
			quitAndInstall: vi.fn()
		}
	}
}))

import {
	resolveMacAppBundlePath,
	selectMacZipAsset,
	isVersionGreater,
	buildMacInstallScript
} from './updater-service.js'

describe('updater-service macOS helpers', () => {
	it('resolves .app bundle path from macOS executable path', () => {
		expect(resolveMacAppBundlePath('/Applications/WAPresence.app/Contents/MacOS/WAPresence')).toBe(
			'/Applications/WAPresence.app'
		)
		expect(resolveMacAppBundlePath('/Users/me/My Apps/WAPresence.app/Contents/MacOS/WAPresence')).toBe(
			'/Users/me/My Apps/WAPresence.app'
		)
		expect(resolveMacAppBundlePath('/usr/local/bin/electron')).toBeNull()
	})

	it('selects matching macOS zip asset for x64 and arm64', () => {
		const assets = [
			{ name: 'WAPresence-1.2.2-x64.dmg', browser_download_url: 'https://example.com/x64.dmg' },
			{ name: 'WAPresence-1.2.2-x64.zip', browser_download_url: 'https://example.com/x64.zip' },
			{ name: 'WAPresence-1.2.2-x64.zip.blockmap', browser_download_url: 'https://example.com/x64.zip.blockmap' },
			{ name: 'WAPresence-1.2.2-arm64.zip', browser_download_url: 'https://example.com/arm64.zip' }
		]

		expect(selectMacZipAsset(assets, 'x64')?.name).toBe('WAPresence-1.2.2-x64.zip')
		expect(selectMacZipAsset(assets, 'arm64')?.name).toBe('WAPresence-1.2.2-arm64.zip')
	})

	it('compares semver versions accurately', () => {
		expect(isVersionGreater('1.2.2', '1.2.1')).toBe(true)
		expect(isVersionGreater('v1.3.0', '1.2.9')).toBe(true)
		expect(isVersionGreater('1.2.1', '1.2.1')).toBe(false)
		expect(isVersionGreater('1.2.0', '1.2.1')).toBe(false)
	})

	it('generates a safe macOS in-place app swap script with shell quoting', () => {
		const script = buildMacInstallScript(
			'/Applications/WAPresence.app',
			'/tmp/wapresence-update-123/extracted/WAPresence.app',
			4242,
			'/tmp/wapresence-update-123'
		)

		expect(script).toContain("OLD_APP='/Applications/WAPresence.app'")
		expect(script).toContain("NEW_APP='/tmp/wapresence-update-123/extracted/WAPresence.app'")
		expect(script).toContain('PARENT_PID=4242')
		expect(script).toContain('with administrator privileges')
		expect(script).toContain('/usr/bin/xattr -rd com.apple.quarantine "$OLD_APP"')
		expect(script).toContain('/usr/bin/open -n "$OLD_APP"')
	})
})
