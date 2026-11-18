import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

vi.mock('electron', () => ({
	app: {
		isPackaged: true,
		getLoginItemSettings: vi.fn(() => ({ openAtLogin: false, executableWillLaunchAtLogin: false })),
		setLoginItemSettings: vi.fn()
	}
}))

import {
	MAC_LAUNCH_AGENT_LABEL,
	escapeXml,
	getMacLaunchAgentPath,
	getMacProgramArgs,
	buildMacLaunchAgentPlist
} from './autostart.js'

describe('autostart macOS LaunchAgent helpers', () => {
	it('escapes XML special characters safely', () => {
		expect(escapeXml(`/Applications/Tom & Jerry's <"App">/WAPresence`)).toBe(
			'/Applications/Tom &amp; Jerry&apos;s &lt;&quot;App&quot;&gt;/WAPresence'
		)
	})

	it('resolves ~/Library/LaunchAgents/com.wapresence.app.plist path', () => {
		const plistPath = getMacLaunchAgentPath('/Users/tester')
		expect(plistPath).toBe(path.join('/Users/tester', 'Library', 'LaunchAgents', `${MAC_LAUNCH_AGENT_LABEL}.plist`))
	})

	it('builds packaged and unpackaged program arguments with --hidden', () => {
		expect(getMacProgramArgs('/Applications/WAPresence.app/Contents/MacOS/WAPresence', true, '/work')).toEqual([
			'/Applications/WAPresence.app/Contents/MacOS/WAPresence',
			'--hidden'
		])
		expect(getMacProgramArgs('/usr/local/bin/electron', false, '/work/WAPresence')).toEqual([
			'/usr/local/bin/electron',
			'/work/WAPresence',
			'--hidden'
		])
	})

	it('generates a valid LaunchAgent plist XML document', () => {
		const xml = buildMacLaunchAgentPlist([
			'/Applications/WAPresence.app/Contents/MacOS/WAPresence',
			'--hidden'
		])

		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
		expect(xml).toContain('<key>Label</key>')
		expect(xml).toContain(`<string>${MAC_LAUNCH_AGENT_LABEL}</string>`)
		expect(xml).toContain('<string>/Applications/WAPresence.app/Contents/MacOS/WAPresence</string>')
		expect(xml).toContain('<string>--hidden</string>')
		expect(xml).toContain('<key>RunAtLoad</key>\n\t<true/>')
		expect(xml).toContain('<key>KeepAlive</key>\n\t<false/>')
		expect(xml).toContain('<key>ProcessType</key>\n\t<string>Interactive</string>')
	})
})
