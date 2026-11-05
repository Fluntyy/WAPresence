import { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, nativeImage, nativeTheme } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig, resetConfig, AppConfig } from './config.js'
import { getConfigPath } from './paths.js'
import { WhatsAppClient } from './whatsapp/client.js'
import { PresenceUpdater } from './updater.js'
import { SpotifySource } from './media/spotify.js'
import { getAutoStartStatus, setAutoStart } from './autostart.js'
import { UpdaterService } from './updater-service.js'
import { getLogger } from './logger.js'

app.name = 'WAPresence'

const log = getLogger('main')
const updaterService = new UpdaterService()

// Set Windows Application User Model ID so Windows taskbar groups and shows WAPresence's icon instead of default Electron
if (process.platform === 'win32') {
	app.setAppUserModelId('com.wapresence.app')
}

// Prevent Chromium from throttling timers when windows are closed/unloaded, and expose GC
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('js-flags', '--expose-gc')

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
	log.warn('Another instance is already running. Quitting...')
	app.quit()
	process.exit(0)
}

let loginWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let spotifyDialog: BrowserWindow | null = null
let tray: Tray | null = null

let config: AppConfig = loadConfig()

function applyTheme(theme: 'System' | 'Light' | 'Dark') {
	if (theme === 'Dark') {
		nativeTheme.themeSource = 'dark'
	} else if (theme === 'Light') {
		nativeTheme.themeSource = 'light'
	} else {
		nativeTheme.themeSource = 'system'
	}
}
applyTheme(config.theme)

const whatsappClient = new WhatsAppClient()
let presenceUpdater: PresenceUpdater | null = null

let isQuitting = false
let spotifySetupResolver: ((value: any) => void) | null = null

function getIconPath(): string {
	const rootIcon = path.resolve(process.cwd(), 'assets', 'icon.ico')
	if (fs.existsSync(rootIcon)) return rootIcon
	return path.join(app.getAppPath(), 'assets', 'icon.ico')
}

function getAppIcon(): Electron.NativeImage {
	const iconPath = getIconPath()
	return nativeImage.createFromPath(iconPath)
}

function getHtmlPath(subPath: string): string {
	const srcPath = path.resolve(process.cwd(), 'src', 'renderer', subPath)
	if (fs.existsSync(srcPath)) return srcPath
	return path.join(app.getAppPath(), 'src', 'renderer', subPath)
}

function getPreloadPath(): string {
	const currentFile = fileURLToPath(import.meta.url)
	const currentDir = path.dirname(currentFile)
	const candidateCjs = path.resolve(currentDir, '..', 'preload', 'index.cjs')
	if (fs.existsSync(candidateCjs)) return candidateCjs
	const srcCjs = path.resolve(process.cwd(), 'src', 'preload', 'index.cjs')
	if (fs.existsSync(srcCjs)) return srcCjs
	const distCjs = path.join(app.getAppPath(), 'dist', 'preload', 'index.cjs')
	if (fs.existsSync(distCjs)) return distCjs
	const candidateJs = path.resolve(currentDir, '..', 'preload', 'index.js')
	if (fs.existsSync(candidateJs)) return candidateJs
	return path.join(app.getAppPath(), 'dist', 'preload', 'index.js')
}

function createLoginWindow() {
	if (loginWindow && !loginWindow.isDestroyed()) {
		loginWindow.show()
		loginWindow.focus()
		return
	}

	const appIcon = getAppIcon()

	loginWindow = new BrowserWindow({
		width: 360,
		height: 490,
		resizable: false,
		title: 'WAPresence - Log in to WhatsApp',
		icon: appIcon,
		backgroundColor: '#121413',
		autoHideMenuBar: true,
		webPreferences: {
			preload: getPreloadPath(),
			contextIsolation: true,
			nodeIntegration: false
		}
	})

	if (process.platform === 'win32') {
		loginWindow.setIcon(appIcon)
	}

	loginWindow.webContents.on('preload-error', (event, preloadPath, error) => {
		log.error({ preloadPath, error }, 'Preload error in loginWindow')
	})

	loginWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
		log.info({ level, message, line, sourceId }, 'LoginWindow console')
	})

	loginWindow.loadFile(getHtmlPath('login/index.html'))

	loginWindow.webContents.on('did-finish-load', () => {
		const qr = whatsappClient.getLastQr()
		if (qr && loginWindow && !loginWindow.isDestroyed()) {
			loginWindow.webContents.send('whatsapp:qr', qr)
		}
	})

	loginWindow.on('closed', () => {
		loginWindow = null
		if (!settingsWindow && !isQuitting && whatsappClient.getState() !== 'connected') {
			gracefulExit()
		}
	})
}

function createSettingsWindow() {
	if (settingsWindow && !settingsWindow.isDestroyed()) {
		settingsWindow.show()
		settingsWindow.focus()
		return
	}

	const appIcon = getAppIcon()

	settingsWindow = new BrowserWindow({
		width: 600,
		height: 750,
		resizable: false,
		title: 'WAPresence',
		icon: appIcon,
		backgroundColor: '#121413',
		autoHideMenuBar: true,
		webPreferences: {
			preload: getPreloadPath(),
			contextIsolation: true,
			nodeIntegration: false
		}
	})

	if (process.platform === 'win32') {
		settingsWindow.setIcon(appIcon)
	}

	settingsWindow.loadFile(getHtmlPath('settings/index.html'))

	settingsWindow.webContents.on('did-finish-load', () => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			if (presenceUpdater) {
				settingsWindow.webContents.send('presence:status', presenceUpdater.getStatus())
				settingsWindow.webContents.send('plugin:placeholders', presenceUpdater.getAvailablePlaceholders())
			}
			settingsWindow.webContents.send('whatsapp:status', whatsappClient.getState())
		}
	})

	settingsWindow.on('close', (event) => {
		if (!isQuitting) {
			// Do NOT preventDefault! Allow window to destroy its renderer process
			// to reclaim memory while running in the system tray.
			log.info('Settings window closed; unloading renderer to save RAM')
			if (Notification.isSupported()) {
				new Notification({
					title: 'WAPresence',
					body: 'Minimized to system tray'
				}).show()
			}
		}
	})

	settingsWindow.on('closed', () => {
		settingsWindow = null
		if (spotifyDialog && !spotifyDialog.isDestroyed()) {
			spotifyDialog.close()
			spotifyDialog = null
		}
		if (typeof global.gc === 'function') {
			try {
				global.gc()
			} catch {}
		}
	})
}

function createSpotifyDialog(): Promise<any> {
	return new Promise((resolve) => {
		spotifySetupResolver = resolve

		if (spotifyDialog) {
			spotifyDialog.show()
			spotifyDialog.focus()
			return
		}

		const appIcon = getAppIcon()

		spotifyDialog = new BrowserWindow({
			width: 480,
			height: 300,
			resizable: false,
			title: 'WAPresence - Spotify API Setup',
			icon: appIcon,
			parent: settingsWindow || undefined,
			modal: true,
			backgroundColor: '#121413',
			autoHideMenuBar: true,
			webPreferences: {
				preload: getPreloadPath(),
				contextIsolation: true,
				nodeIntegration: false
			}
		})

		if (process.platform === 'win32') {
			spotifyDialog.setIcon(appIcon)
		}

		spotifyDialog.loadFile(getHtmlPath('spotify-setup/index.html'))

		spotifyDialog.on('closed', () => {
			spotifyDialog = null
			if (spotifySetupResolver) {
				spotifySetupResolver({ confirmed: false })
				spotifySetupResolver = null
			}
		})
	})
}

function createTray() {
	if (tray) return

	const appIcon = getAppIcon()
	tray = new Tray(appIcon)
	tray.setToolTip('WAPresence')

	const contextMenu = Menu.buildFromTemplate([
		{
			label: 'Settings',
			click: () => {
				if (settingsWindow) {
					settingsWindow.show()
					settingsWindow.focus()
				} else {
					createSettingsWindow()
				}
			}
		},
		{
			label: 'Check for Updates',
			click: async () => {
				if (!settingsWindow) {
					createSettingsWindow()
				} else {
					settingsWindow.show()
					settingsWindow.focus()
				}
				await updaterService.checkForUpdates()
			}
		},
		{
			label: 'Log out',
			click: async () => {
				log.info('User triggered WhatsApp log out from tray')
				await handleLogout()
			}
		},
		{ type: 'separator' },
		{
			label: 'Quit',
			click: () => {
				gracefulExit()
			}
		}
	])

	tray.setContextMenu(contextMenu)

	tray.on('double-click', () => {
		if (settingsWindow) {
			settingsWindow.show()
			settingsWindow.focus()
		} else {
			createSettingsWindow()
		}
	})
}

async function handleLogout() {
	if (presenceUpdater) {
		await presenceUpdater.stop()
		presenceUpdater = null
	}

	await whatsappClient.logout()

	if (settingsWindow && !settingsWindow.isDestroyed()) {
		settingsWindow.close()
		settingsWindow = null
	}
	createLoginWindow()
}

async function gracefulExit() {
	if (isQuitting) return
	isQuitting = true
	log.info('Initiating graceful shutdown')

	if (presenceUpdater) {
		try {
			await presenceUpdater.stop()
		} catch (err) {
			log.warn({ err }, 'Error stopping presence updater')
		}
	}

	try {
		await whatsappClient.disconnect()
	} catch (err) {
		log.warn({ err }, 'Error disconnecting WhatsApp client')
	}

	app.quit()
}

// IPC Handlers
function setupIpcHandlers() {
	ipcMain.handle('config:get', () => config)

	ipcMain.handle('config:save', async (_, newConfig: AppConfig) => {
		try {
			if (newConfig.theme && newConfig.theme !== config.theme) {
				applyTheme(newConfig.theme)
			}
			if (typeof newConfig.startWithOS === 'boolean' && newConfig.startWithOS !== config.startWithOS) {
				setAutoStart(newConfig.startWithOS)
			}
			saveConfig(getConfigPath(), newConfig)
			config = newConfig
			if (presenceUpdater) {
				await presenceUpdater.updateConfig(newConfig)
			}
			return { success: true }
		} catch (err: any) {
			log.error({ err }, 'Failed to save config')
			return { success: false, error: err.message }
		}
	})

	ipcMain.handle('config:reset', async () => {
		config = resetConfig(getConfigPath())
		applyTheme(config.theme)
		setAutoStart(config.startWithOS)
		if (presenceUpdater) {
			await presenceUpdater.updateConfig(config)
		}
		return config
	})

	ipcMain.handle('autostart:get', () => {
		return getAutoStartStatus()
	})

	ipcMain.handle('autostart:set', (_, enabled: boolean) => {
		const res = setAutoStart(enabled)
		if (res) {
			config.startWithOS = enabled
			saveConfig(getConfigPath(), config)
		}
		return res
	})

	ipcMain.handle('theme:set', (_, theme: 'System' | 'Light' | 'Dark') => {
		applyTheme(theme)
		config.theme = theme
		saveConfig(getConfigPath(), config)
		return { success: true, theme, shouldUseDarkColors: nativeTheme.shouldUseDarkColors }
	})

	ipcMain.handle('theme:get', () => {
		return {
			theme: config.theme,
			shouldUseDarkColors: nativeTheme.shouldUseDarkColors
		}
	})

	ipcMain.handle('plugin:get-placeholders', () => {
		if (presenceUpdater) {
			return presenceUpdater.getAvailablePlaceholders()
		}
		return ['[artist]', '[title]', '[album]', '[tracknum]', '[bio]']
	})

	ipcMain.handle('updater:get-status', () => updaterService.getState())
	ipcMain.handle('updater:check', async () => updaterService.checkForUpdates())
	ipcMain.handle('updater:download', async () => updaterService.downloadUpdate())
	ipcMain.handle('updater:install', async () => updaterService.quitAndInstall())

	ipcMain.handle('whatsapp:verify-now', async () => {
		try {
			return await whatsappClient.fetchCurrentServerStatus()
		} catch (err: any) {
			return { error: err.message || String(err) }
		}
	})

	ipcMain.handle('whatsapp:get-qr', () => {
		return whatsappClient.getLastQr()
	})

	ipcMain.handle('spotify:auth', async (_, { clientID, redirectURI }) => {
		const spotifySource = new SpotifySource(clientID, redirectURI)
		try {
			const { authUrl, completionPromise } = await spotifySource.startAuthFlow()
			shell.openExternal(authUrl)
			const success = await completionPromise
			return { success }
		} catch (err: any) {
			log.error({ err }, 'Failed to start Spotify auth')
			return { success: false, error: err.message }
		}
	})

	ipcMain.handle('spotify:open-setup', async () => {
		return await createSpotifyDialog()
	})

	ipcMain.handle('spotify:close-setup', async (_, { confirmed, clientID, redirectURI }) => {
		if (spotifyDialog) {
			spotifyDialog.close()
			spotifyDialog = null
		}

		if (confirmed && clientID) {
			config.clientID = clientID
			config.redirectURI = redirectURI || 'http://127.0.0.1:6969/callback'
			saveConfig(getConfigPath(), config)

			// Trigger PKCE authorization in browser
			const spotifySource = new SpotifySource(config.clientID, config.redirectURI)
			try {
				const { authUrl } = await spotifySource.startAuthFlow()
				shell.openExternal(authUrl)
			} catch (err) {
				log.error({ err }, 'Error launching Spotify auth from setup dialog')
			}

			if (spotifySetupResolver) {
				spotifySetupResolver({ confirmed: true, clientID, redirectURI })
				spotifySetupResolver = null
			}
		} else {
			if (spotifySetupResolver) {
				spotifySetupResolver({ confirmed: false })
				spotifySetupResolver = null
			}
		}
	})

	ipcMain.handle('app:exit', () => {
		gracefulExit()
	})

	ipcMain.handle('app:minimize-to-tray', () => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.close()
		}
	})

	ipcMain.handle('whatsapp:logout', async () => {
		await handleLogout()
	})
}

// WhatsApp client event bridging
function setupWhatsAppEvents() {
	whatsappClient.on('qr', (dataUrl: string) => {
		createLoginWindow()
		if (loginWindow && !loginWindow.isDestroyed()) {
			if (!loginWindow.webContents.isLoading()) {
				loginWindow.webContents.send('whatsapp:qr', dataUrl)
			}
		}
		settingsWindow?.webContents.send('whatsapp:status', 'qr')
	})

	whatsappClient.on('connected', async () => {
		log.info('WhatsApp connected event received in main process')
		if (loginWindow && !loginWindow.isDestroyed()) {
			loginWindow.close()
			loginWindow = null
		}
		createSettingsWindow()
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.webContents.send('whatsapp:status', 'connected')
		}

		// Initialize presence updater loop
		if (!presenceUpdater) {
			presenceUpdater = new PresenceUpdater(whatsappClient, config)
			presenceUpdater.on('presence_updated', (data) => {
				if (settingsWindow && !settingsWindow.isDestroyed()) {
					settingsWindow.webContents.send('presence:status', presenceUpdater?.getStatus())
					settingsWindow.webContents.send('whatsapp:verification-result', data.verification)
				}
			})
			presenceUpdater.on('verification_failed', (data) => {
				if (settingsWindow && !settingsWindow.isDestroyed()) {
					settingsWindow.webContents.send('presence:status', presenceUpdater?.getStatus())
					settingsWindow.webContents.send('whatsapp:verification-result', data.verification)
				}
			})
			presenceUpdater.on('placeholders_change', (placeholders) => {
				if (settingsWindow && !settingsWindow.isDestroyed()) {
					settingsWindow.webContents.send('plugin:placeholders', placeholders)
				}
			})
			presenceUpdater.start().catch((err) => {
				log.error({ err }, 'Error starting presence updater')
			})
		}

		// Automatic "Verify now" verification after initial login
		try {
			log.info('Running automatic "Verify now" check after first login')
			const serverStatus = await whatsappClient.fetchCurrentServerStatus()
			if (settingsWindow && !settingsWindow.isDestroyed()) {
				settingsWindow.webContents.send('whatsapp:verification-result', {
					verified: true,
					serverText: serverStatus.text,
					expectedText: serverStatus.text,
					emoji: serverStatus.emoji,
					ephemeralDurationSeconds: serverStatus.ephemeralDurationSeconds,
					lastUpdateTime: serverStatus.lastUpdateTime
				})
			}
		} catch (err) {
			log.warn({ err }, 'Automatic first-login verification error')
		}
	})

	whatsappClient.on('disconnected', () => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.webContents.send('whatsapp:status', 'disconnected')
		}
	})

	whatsappClient.on('logged_out', () => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.close()
			settingsWindow = null
		}
		createLoginWindow()
	})
}

function setupUpdaterEvents() {
	updaterService.setBeforeQuitCallback(async () => {
		if (presenceUpdater) {
			try {
				await presenceUpdater.stop()
			} catch {}
		}
		try {
			await whatsappClient.disconnect()
		} catch {}
	})

	updaterService.on('update-available', (info) => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.webContents.send('updater:available', info)
		}
	})
	updaterService.on('update-not-available', (info) => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.webContents.send('updater:not-available', info)
		}
	})
	updaterService.on('download-progress', (progress) => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.webContents.send('updater:progress', progress)
		}
	})
	updaterService.on('update-downloaded', (info) => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.webContents.send('updater:downloaded', info)
		}
	})
	updaterService.on('error', (err) => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.webContents.send('updater:error', err)
		}
	})
}

app.on('second-instance', () => {
	if (settingsWindow) {
		if (settingsWindow.isMinimized()) settingsWindow.restore()
		settingsWindow.show()
		settingsWindow.focus()
	} else if (loginWindow) {
		if (loginWindow.isMinimized()) loginWindow.restore()
		loginWindow.show()
		loginWindow.focus()
	}
})

app.whenReady().then(async () => {
	log.info('WAPresence starting up')
	setupIpcHandlers()
	setupWhatsAppEvents()
	setupUpdaterEvents()
	createTray()

	// Open login window immediately so user sees loading state
	createLoginWindow()

	// Connect to WhatsApp
	await whatsappClient.connect()

	// Check for updates in the background after startup
	setTimeout(() => {
		updaterService.checkForUpdates().catch(() => {})
	}, 4000)
})

app.on('window-all-closed', () => {
	// Keep running in tray when windows are closed
})

process.on('SIGINT', () => {
	gracefulExit()
})

process.on('SIGTERM', () => {
	gracefulExit()
})
