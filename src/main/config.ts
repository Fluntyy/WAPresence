import fs from 'node:fs'
import path from 'node:path'
import ini from 'ini'
import { getConfigPath } from './paths.js'

export const DEFAULT_UPDATE_EVERY = 1
export const DEFAULT_FORMAT = 'Listening to [artist] - [title] | [bio]'
export const DEFAULT_SOURCE = 'Local'
export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:6969/callback'
export const DEFAULT_CONFIG_FILE = 'config.ini'
export const DEFAULT_THEME = 'System'
export const DEFAULT_START_WITH_OS = false
export const DEFAULT_APPEND_PAUSE_EMOJI = true
export const DEFAULT_PLUGIN_PORT = 6970

export const MIN_UPDATE_EVERY = 1
export const MAX_UPDATE_EVERY = 60

export type AppSource = 'Local' | 'Spotify' | 'Plugin'
export type AppTheme = 'System' | 'Light' | 'Dark'

export interface AppConfig {
	updateEvery: number
	format: string
	source: AppSource
	clientID: string
	redirectURI: string
	theme: AppTheme
	startWithOS: boolean
	appendPauseEmoji: boolean
	pluginPort: number
}

export function getDefaultConfig(): AppConfig {
	return {
		updateEvery: DEFAULT_UPDATE_EVERY,
		format: DEFAULT_FORMAT,
		source: DEFAULT_SOURCE,
		clientID: '',
		redirectURI: DEFAULT_REDIRECT_URI,
		theme: DEFAULT_THEME,
		startWithOS: DEFAULT_START_WITH_OS,
		appendPauseEmoji: DEFAULT_APPEND_PAUSE_EMOJI,
		pluginPort: DEFAULT_PLUGIN_PORT
	}
}

export function validateConfig(config: Partial<AppConfig>): void {
	if (config.updateEvery !== undefined) {
		if (typeof config.updateEvery !== 'number' || isNaN(config.updateEvery) || config.updateEvery < MIN_UPDATE_EVERY || config.updateEvery > MAX_UPDATE_EVERY) {
			throw new Error(`Update interval must be between ${MIN_UPDATE_EVERY} and ${MAX_UPDATE_EVERY} seconds`)
		}
	}

	if (config.format !== undefined) {
		if (typeof config.format !== 'string' || config.format.trim().length === 0) {
			throw new Error('Format text cannot be empty')
		}
	}

	if (config.source !== undefined) {
		const src = String(config.source).toLowerCase()
		if (src !== 'local' && src !== 'spotify' && src !== 'plugin') {
			throw new Error(`Source must be 'Local', 'Spotify', or 'Plugin', got '${config.source}'`)
		}
	}

	if (config.theme !== undefined) {
		const theme = String(config.theme).toLowerCase()
		if (theme !== 'system' && theme !== 'light' && theme !== 'dark') {
			throw new Error(`Theme must be 'System', 'Light', or 'Dark', got '${config.theme}'`)
		}
	}

	if (config.pluginPort !== undefined) {
		if (typeof config.pluginPort !== 'number' || isNaN(config.pluginPort) || config.pluginPort < 1024 || config.pluginPort > 65535) {
			throw new Error('Plugin Port must be a valid port number between 1024 and 65535')
		}
	}
}

function parseBoolean(val: any, defaultVal: boolean): boolean {
	if (typeof val === 'boolean') return val
	if (typeof val === 'string') {
		const lower = val.trim().toLowerCase()
		if (lower === 'true' || lower === '1' || lower === 'yes') return true
		if (lower === 'false' || lower === '0' || lower === 'no') return false
	}
	return defaultVal
}

export function loadConfig(filePath?: string): AppConfig {
	const current = getDefaultConfig()
	const targetPath = filePath || getConfigPath()

	if (!fs.existsSync(targetPath)) {
		saveConfig(targetPath, current)
		return current
	}

	try {
		const rawContent = fs.readFileSync(targetPath, 'utf-8')
		const parsed = ini.parse(rawContent)

		const configuration = parsed.Configuration || {}
		if (configuration.UpdateEvery !== undefined) {
			const parsedInterval = parseInt(configuration.UpdateEvery, 10)
			if (!isNaN(parsedInterval) && parsedInterval >= MIN_UPDATE_EVERY && parsedInterval <= MAX_UPDATE_EVERY) {
				current.updateEvery = parsedInterval
			}
		}

		if (configuration.Format !== undefined && typeof configuration.Format === 'string' && configuration.Format.trim().length > 0) {
			current.format = configuration.Format
		}

		if (configuration.Source !== undefined && typeof configuration.Source === 'string') {
			const srcLower = configuration.Source.toLowerCase()
			if (srcLower === 'spotify') current.source = 'Spotify'
			else if (srcLower === 'plugin') current.source = 'Plugin'
			else current.source = 'Local'
		}

		if (configuration.Theme !== undefined && typeof configuration.Theme === 'string') {
			const themeLower = configuration.Theme.toLowerCase()
			if (themeLower === 'dark') current.theme = 'Dark'
			else if (themeLower === 'light') current.theme = 'Light'
			else current.theme = 'System'
		}

		if (configuration.StartWithOS !== undefined) {
			current.startWithOS = parseBoolean(configuration.StartWithOS, DEFAULT_START_WITH_OS)
		}

		if (configuration.AppendPauseEmoji !== undefined) {
			current.appendPauseEmoji = parseBoolean(configuration.AppendPauseEmoji, DEFAULT_APPEND_PAUSE_EMOJI)
		}

		if (configuration.PluginPort !== undefined) {
			const port = parseInt(configuration.PluginPort, 10)
			if (!isNaN(port) && port >= 1024 && port <= 65535) {
				current.pluginPort = port
			}
		}

		const spotify = parsed.Spotify || {}
		if (spotify.ClientID !== undefined && typeof spotify.ClientID === 'string') {
			current.clientID = spotify.ClientID.trim()
		}

		if (spotify.RedirectURI !== undefined && typeof spotify.RedirectURI === 'string') {
			let red = spotify.RedirectURI.trim()
			if (red.includes('localhost')) {
				red = red.replace('localhost', '127.0.0.1')
			}
			current.redirectURI = red || DEFAULT_REDIRECT_URI
		}
	} catch (err) {
		// If corrupted, return defaults
		return current
	}

	return current
}

export function saveConfig(filePath?: string, config?: AppConfig): void {
	const targetPath = filePath || getConfigPath()
	const targetConfig = config || getDefaultConfig()
	validateConfig(targetConfig)

	const data: Record<string, Record<string, any>> = {
		Configuration: {
			UpdateEvery: targetConfig.updateEvery,
			Format: targetConfig.format,
			Source: targetConfig.source,
			Theme: targetConfig.theme || DEFAULT_THEME,
			StartWithOS: targetConfig.startWithOS ?? DEFAULT_START_WITH_OS,
			AppendPauseEmoji: targetConfig.appendPauseEmoji ?? DEFAULT_APPEND_PAUSE_EMOJI,
			PluginPort: targetConfig.pluginPort || DEFAULT_PLUGIN_PORT
		},
		Spotify: {
			ClientID: targetConfig.clientID,
			RedirectURI: targetConfig.redirectURI || DEFAULT_REDIRECT_URI
		}
	}

	// ClientSecret is intentionally dropped if present
	const iniString = ini.stringify(data)
	fs.writeFileSync(targetPath, iniString, 'utf-8')
}

export function resetConfig(filePath?: string): AppConfig {
	const targetPath = filePath || getConfigPath()
	if (fs.existsSync(targetPath)) {
		fs.unlinkSync(targetPath)
	}
	const defaults = getDefaultConfig()
	saveConfig(targetPath, defaults)
	return defaults
}
