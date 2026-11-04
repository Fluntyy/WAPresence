import { IMediaSource } from './types.js'
import { WindowsSmtcSource } from './windows-smtc.js'
import { LinuxMprisSource } from './linux-mpris.js'
import { UnsupportedMediaSource } from './unsupported.js'
import { SpotifySource } from './spotify.js'
import { PluginSource } from './plugin.js'
import { AppConfig } from '../config.js'

export * from './types.js'
export * from './spotify.js'
export * from './windows-smtc.js'
export * from './linux-mpris.js'
export * from './unsupported.js'
export * from './plugin.js'

export function createMediaSource(config: AppConfig): IMediaSource {
	if (config.source === 'Spotify') {
		const spotify = new SpotifySource(config.clientID, config.redirectURI)
		spotify.setPollInterval(config.updateEvery)
		return spotify
	}

	if (config.source === 'Plugin') {
		return new PluginSource(config.pluginPort)
	}

	// Local Media
	const platform = process.platform
	if (platform === 'win32') {
		return new WindowsSmtcSource()
	} else if (platform === 'linux') {
		return new LinuxMprisSource()
	} else {
		return new UnsupportedMediaSource()
	}
}
