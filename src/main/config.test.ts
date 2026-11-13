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
	DEFAULT_FORMAT_LOCAL,
	DEFAULT_FORMAT_SPOTIFY,
	DEFAULT_FORMAT_PLUGIN,
	DEFAULT_SOURCE,
	DEFAULT_REDIRECT_URI,
	DEFAULT_THEME,
	DEFAULT_START_WITH_OS,
	DEFAULT_APPEND_PAUSE_EMOJI,
	DEFAULT_PLUGIN_PORT,
	DEFAULT_BLACKLIST_APPS,
	DEFAULT_EXCLUDE_REGEX,
	DEFAULT_PAUSED_TIMEOUT,
	DEFAULT_NOTIFY_ON_MINIMIZE,
	DEFAULT_NOTIFY_ON_CONNECTION
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
			formatLocal: DEFAULT_FORMAT_LOCAL,
			formatSpotify: DEFAULT_FORMAT_SPOTIFY,
			formatPlugin: DEFAULT_FORMAT_PLUGIN,
			source: DEFAULT_SOURCE,
			clientID: '',
			redirectURI: DEFAULT_REDIRECT_URI,
			theme: DEFAULT_THEME,
			startWithOS: DEFAULT_START_WITH_OS,
			appendPauseEmoji: DEFAULT_APPEND_PAUSE_EMOJI,
			pluginPort: DEFAULT_PLUGIN_PORT,
			blacklistApps: DEFAULT_BLACKLIST_APPS,
			excludeRegex: DEFAULT_EXCLUDE_REGEX,
			pausedTimeout: DEFAULT_PAUSED_TIMEOUT,
			notifyOnMinimize: DEFAULT_NOTIFY_ON_MINIMIZE,
			notifyOnConnection: DEFAULT_NOTIFY_ON_CONNECTION
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

[LocalMedia]
BlacklistApps = chrome.exe, vlc
ExcludeRegex = (ad|sponsor)
PausedTimeout = 45

[Notifications]
NotifyOnMinimize = true
NotifyOnConnection = false

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
		expect(cfg.blacklistApps).toEqual(['chrome.exe', 'vlc'])
		expect(cfg.excludeRegex).toBe('(ad|sponsor)')
		expect(cfg.pausedTimeout).toBe(45)
		expect(cfg.notifyOnMinimize).toBe(true)
		expect(cfg.notifyOnConnection).toBe(false)
		expect(cfg.clientID).toBe('test-client-id')
		expect(cfg.redirectURI).toBe('http://127.0.0.1:6969/callback')
	})

	it('loads and saves independent bio format text for each media source', () => {
		const iniContent = `[Configuration]
Format = Fallback
FormatLocal = Local: [title]
FormatSpotify = Spotify: [artist] - [title]
FormatPlugin = Plugin: [device] [title]
Source = Plugin
`
		fs.writeFileSync(tempConfigFile, iniContent, 'utf-8')
		const cfg = loadConfig(tempConfigFile)
		expect(cfg.formatLocal).toBe('Local: [title]')
		expect(cfg.formatSpotify).toBe('Spotify: [artist] - [title]')
		expect(cfg.formatPlugin).toBe('Plugin: [device] [title]')
		expect(cfg.format).toBe('Plugin: [device] [title]')

		// Switch to Local and save
		cfg.source = 'Local'
		cfg.format = cfg.formatLocal
		saveConfig(tempConfigFile, cfg)

		const reloaded = loadConfig(tempConfigFile)
		expect(reloaded.source).toBe('Local')
		expect(reloaded.format).toBe('Local: [title]')
		expect(reloaded.formatLocal).toBe('Local: [title]')
		expect(reloaded.formatSpotify).toBe('Spotify: [artist] - [title]')
		expect(reloaded.formatPlugin).toBe('Plugin: [device] [title]')
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
		expect(() => validateConfig({ pausedTimeout: -5 })).toThrow(/Paused Timeout must be a non-negative number/)
		expect(() => validateConfig({ excludeRegex: '[invalid(' })).toThrow(/Invalid exclude regex pattern/)

		// Valid values should not throw
		expect(() => validateConfig({
			updateEvery: 1,
			format: 'valid format',
			source: 'Plugin',
			theme: 'System',
			pluginPort: 6970,
			pausedTimeout: 60,
			excludeRegex: 'test.*'
		})).not.toThrow()
	})
})
