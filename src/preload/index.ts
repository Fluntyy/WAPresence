import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
	getConfig: () => ipcRenderer.invoke('config:get'),
	saveConfig: (cfg: any) => ipcRenderer.invoke('config:save', cfg),
	resetConfig: () => ipcRenderer.invoke('config:reset'),
	verifyNow: () => ipcRenderer.invoke('whatsapp:verify-now'),
	startSpotifyAuth: (clientID: string, redirectURI: string) =>
		ipcRenderer.invoke('spotify:auth', { clientID, redirectURI }),
	exitApp: () => ipcRenderer.invoke('app:exit'),
	minimizeToTray: () => ipcRenderer.invoke('app:minimize-to-tray'),
	logoutWhatsApp: () => ipcRenderer.invoke('whatsapp:logout'),
	openSpotifySetup: () => ipcRenderer.invoke('spotify:open-setup'),
	closeSpotifySetup: (confirmed: boolean, clientID?: string, redirectURI?: string) =>
		ipcRenderer.invoke('spotify:close-setup', { confirmed, clientID, redirectURI }),

	getQrCode: () => ipcRenderer.invoke('whatsapp:get-qr'),
	getPresenceStatus: () => ipcRenderer.invoke('presence:get-status'),

	// Autostart & System Settings
	getAutostart: () => ipcRenderer.invoke('autostart:get'),
	setAutostart: (enabled: boolean) => ipcRenderer.invoke('autostart:set', enabled),
	setTheme: (theme: string) => ipcRenderer.invoke('theme:set', theme),
	getThemeInfo: () => ipcRenderer.invoke('theme:get'),

	// Dynamic Plugin Placeholders
	getPluginPlaceholders: () => ipcRenderer.invoke('plugin:get-placeholders'),
	onPluginPlaceholders: (cb: (placeholders: string[]) => void) => {
		const listener = (_: any, data: string[]) => cb(data)
		ipcRenderer.on('plugin:placeholders', listener)
		return () => ipcRenderer.removeListener('plugin:placeholders', listener)
	},

	// Auto-updater
	getUpdaterStatus: () => ipcRenderer.invoke('updater:get-status'),
	checkForUpdates: () => ipcRenderer.invoke('updater:check'),
	downloadUpdate: () => ipcRenderer.invoke('updater:download'),
	installUpdate: () => ipcRenderer.invoke('updater:install'),

	onUpdateAvailable: (cb: (info: any) => void) => {
		const listener = (_: any, data: any) => cb(data)
		ipcRenderer.on('updater:available', listener)
		return () => ipcRenderer.removeListener('updater:available', listener)
	},
	onUpdateNotAvailable: (cb: (info: any) => void) => {
		const listener = (_: any, data: any) => cb(data)
		ipcRenderer.on('updater:not-available', listener)
		return () => ipcRenderer.removeListener('updater:not-available', listener)
	},
	onUpdateProgress: (cb: (progress: any) => void) => {
		const listener = (_: any, data: any) => cb(data)
		ipcRenderer.on('updater:progress', listener)
		return () => ipcRenderer.removeListener('updater:progress', listener)
	},
	onUpdateDownloaded: (cb: (info: any) => void) => {
		const listener = (_: any, data: any) => cb(data)
		ipcRenderer.on('updater:downloaded', listener)
		return () => ipcRenderer.removeListener('updater:downloaded', listener)
	},
	onUpdateError: (cb: (err: any) => void) => {
		const listener = (_: any, data: any) => cb(data)
		ipcRenderer.on('updater:error', listener)
		return () => ipcRenderer.removeListener('updater:error', listener)
	},

	onQrCode: (cb: (dataUrl: string) => void) => {
		const listener = (_: any, data: string) => cb(data)
		ipcRenderer.on('whatsapp:qr', listener)
		return () => ipcRenderer.removeListener('whatsapp:qr', listener)
	},
	onConnectionStatus: (cb: (status: string) => void) => {
		const listener = (_: any, data: string) => cb(data)
		ipcRenderer.on('whatsapp:status', listener)
		return () => ipcRenderer.removeListener('whatsapp:status', listener)
	},
	onPresenceStatus: (cb: (data: any) => void) => {
		const listener = (_: any, data: any) => cb(data)
		ipcRenderer.on('presence:status', listener)
		return () => ipcRenderer.removeListener('presence:status', listener)
	},
	onVerificationResult: (cb: (data: any) => void) => {
		const listener = (_: any, data: any) => cb(data)
		ipcRenderer.on('whatsapp:verification-result', listener)
		return () => ipcRenderer.removeListener('whatsapp:verification-result', listener)
	}
})
