import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
	loadConfig,
	saveConfig,
	resetConfig,
	validateConfig,
	getDefaultConfig,
	DEFAULT_UPDATE_EVERY,
	DEFAULT_FORMAT,
	DEFAULT_SOURCE,
	DEFAULT_REDIRECT_URI,
	DEFAULT_THEME,
	DEFAULT_START_WITH_OS,
	DEFAULT_APPEND_PAUSE_EMOJI,
	DEFAULT_PLUGIN_PORT
} from './config.js'

describe('config', () => {
	let tempDir: string
	let tempConfigFile: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wapresence-test-'))
		tempConfigFile = path.join(tempDir, 'test-config.ini')
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it('returns default config when file does not exist and saves it', () => {
		const cfg = loadConfig(tempConfigFile)
		expect(cfg).toEqual({
			updateEvery: DEFAULT_UPDATE_EVERY,
			format: DEFAULT_FORMAT,
			source: DEFAULT_SOURCE,
			clientID: '',
			redirectURI: DEFAULT_REDIRECT_URI,
			theme: DEFAULT_THEME,
			startWithOS: DEFAULT_START_WITH_OS,
			appendPauseEmoji: DEFAULT_APPEND_PAUSE_EMOJI,
			pluginPort: DEFAULT_PLUGIN_PORT
		})
		expect(fs.existsSync(tempConfigFile)).toBe(true)
	})

	it('loads valid existing config with all preferences', () => {
		const iniContent = `[Configuration]
UpdateEvery = 5
Format = Test [artist] - [title]
Source = Plugin
Theme = Dark
StartWithOS = true
AppendPauseEmoji = false
PluginPort = 7000

[Spotify]
ClientID = test-client-id
RedirectURI = http://127.0.0.1:6969/callback
`
		fs.writeFileSync(tempConfigFile, iniContent, 'utf-8')
		const cfg = loadConfig(tempConfigFile)
		expect(cfg.updateEvery).toBe(5)
		expect(cfg.format).toBe('Test [artist] - [title]')
		expect(cfg.source).toBe('Plugin')
		expect(cfg.theme).toBe('Dark')
		expect(cfg.startWithOS).toBe(true)
		expect(cfg.appendPauseEmoji).toBe(false)
		expect(cfg.pluginPort).toBe(7000)
		expect(cfg.clientID).toBe('test-client-id')
		expect(cfg.redirectURI).toBe('http://127.0.0.1:6969/callback')
	})

	it('migrates localhost to 127.0.0.1 in RedirectURI', () => {
		const iniContent = `[Spotify]
RedirectURI = http://localhost:8080/callback
`
		fs.writeFileSync(tempConfigFile, iniContent, 'utf-8')
		const cfg = loadConfig(tempConfigFile)
		expect(cfg.redirectURI).toBe('http://127.0.0.1:8080/callback')
	})

	it('drops ClientSecret when saving', () => {
		const iniContent = `[Configuration]
UpdateEvery = 2
Format = Playing [title]
Source = Local

[Spotify]
ClientID = my-id
ClientSecret = super-secret
RedirectURI = http://127.0.0.1:6969/callback
`
		fs.writeFileSync(tempConfigFile, iniContent, 'utf-8')
		const loaded = loadConfig(tempConfigFile)
		expect((loaded as any).clientSecret).toBeUndefined()

		saveConfig(tempConfigFile, loaded)
		const savedContent = fs.readFileSync(tempConfigFile, 'utf-8')
		expect(savedContent).not.toContain('ClientSecret')
		expect(savedContent).not.toContain('super-secret')
	})

	it('resets config to defaults', () => {
		const custom = {
			...getDefaultConfig(),
			updateEvery: 10,
			format: 'custom format',
			source: 'Plugin' as const,
			theme: 'Light' as const,
			pluginPort: 8888
		}
		saveConfig(tempConfigFile, custom)
		expect(fs.existsSync(tempConfigFile)).toBe(true)

		const reset = resetConfig(tempConfigFile)
		expect(reset).toEqual(getDefaultConfig())

		const reloaded = loadConfig(tempConfigFile)
		expect(reloaded).toEqual(getDefaultConfig())
	})

	it('validates config correctly', () => {
		expect(() => validateConfig({ updateEvery: 0 })).toThrow(/Update interval must be between/)
		expect(() => validateConfig({ updateEvery: 61 })).toThrow(/Update interval must be between/)
		expect(() => validateConfig({ format: '   ' })).toThrow(/Format text cannot be empty/)
		expect(() => validateConfig({ source: 'Invalid' as any })).toThrow(/Source must be 'Local', 'Spotify', or 'Plugin'/)
		expect(() => validateConfig({ theme: 'InvalidTheme' as any })).toThrow(/Theme must be 'System', 'Light', or 'Dark'/)
		expect(() => validateConfig({ pluginPort: 80 })).toThrow(/Plugin Port must be a valid port number/)

		// Valid values should not throw
		expect(() => validateConfig({
			updateEvery: 1,
			format: 'valid format',
			source: 'Plugin',
			theme: 'System',
			pluginPort: 6970
		})).not.toThrow()
	})
})
