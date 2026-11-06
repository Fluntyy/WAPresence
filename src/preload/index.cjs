const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
	getConfig: () => ipcRenderer.invoke('config:get'),
	saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
	resetConfig: () => ipcRenderer.invoke('config:reset'),
	verifyNow: () => ipcRenderer.invoke('whatsapp:verify-now'),
	startSpotifyAuth: (clientID, redirectURI) =>
		ipcRenderer.invoke('spotify:auth', { clientID, redirectURI }),
	exitApp: () => ipcRenderer.invoke('app:exit'),
	minimizeToTray: () => ipcRenderer.invoke('app:minimize-to-tray'),
	logoutWhatsApp: () => ipcRenderer.invoke('whatsapp:logout'),
	openSpotifySetup: () => ipcRenderer.invoke('spotify:open-setup'),
	closeSpotifySetup: (confirmed, clientID, redirectURI) =>
		ipcRenderer.invoke('spotify:close-setup', { confirmed, clientID, redirectURI }),
	openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

	getQrCode: () => ipcRenderer.invoke('whatsapp:get-qr'),
	requestPairingCode: (phoneNumber) =>
		ipcRenderer.invoke('whatsapp:request-pairing-code', phoneNumber),
	getPresenceStatus: () => ipcRenderer.invoke('presence:get-status'),

	// Autostart & System Settings
	getAutostart: () => ipcRenderer.invoke('autostart:get'),
	setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
	setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
	getThemeInfo: () => ipcRenderer.invoke('theme:get'),

	// Dynamic Plugin Placeholders
	getPluginPlaceholders: () => ipcRenderer.invoke('plugin:get-placeholders'),
	onPluginPlaceholders: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('plugin:placeholders', listener)
		return () => ipcRenderer.removeListener('plugin:placeholders', listener)
	},

	// Auto-updater
	getUpdaterStatus: () => ipcRenderer.invoke('updater:get-status'),
	checkForUpdates: () => ipcRenderer.invoke('updater:check'),
	downloadUpdate: () => ipcRenderer.invoke('updater:download'),
	installUpdate: () => ipcRenderer.invoke('updater:install'),

	onUpdateAvailable: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('updater:available', listener)
		return () => ipcRenderer.removeListener('updater:available', listener)
	},
	onUpdateNotAvailable: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('updater:not-available', listener)
		return () => ipcRenderer.removeListener('updater:not-available', listener)
	},
	onUpdateProgress: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('updater:progress', listener)
		return () => ipcRenderer.removeListener('updater:progress', listener)
	},
	onUpdateDownloaded: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('updater:downloaded', listener)
		return () => ipcRenderer.removeListener('updater:downloaded', listener)
	},
	onUpdateError: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('updater:error', listener)
		return () => ipcRenderer.removeListener('updater:error', listener)
	},

	onQrCode: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('whatsapp:qr', listener)
		return () => ipcRenderer.removeListener('whatsapp:qr', listener)
	},
	onConnectionStatus: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('whatsapp:status', listener)
		return () => ipcRenderer.removeListener('whatsapp:status', listener)
	},
	onPresenceStatus: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('presence:status', listener)
		return () => ipcRenderer.removeListener('presence:status', listener)
	},
	onVerificationResult: (cb) => {
		const listener = (_, data) => cb(data)
		ipcRenderer.on('whatsapp:verification-result', listener)
		return () => ipcRenderer.removeListener('whatsapp:verification-result', listener)
	},
	onOpenPreferencesAndCheckUpdates: (cb) => {
		const listener = () => cb()
		ipcRenderer.on('app:open-preferences-and-check-updates', listener)
		return () => ipcRenderer.removeListener('app:open-preferences-and-check-updates', listener)
	}
})
