import { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, nativeImage, nativeTheme, powerMonitor, powerSaveBlocker } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig, resetConfig, AppConfig } from './config.js'
import { getConfigPath, getAuthDir } from './paths.js'
import { WhatsAppClient } from './whatsapp/client.js'
import { PresenceUpdater } from './updater.js'
import { SpotifySource } from './media/spotify.js'
import { getAutoStartStatus, setAutoStart, isStartedHidden } from './autostart.js'
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
let sessionWindow: BrowserWindow | null = null
let tray: Tray | null = null

let isLaunchedHidden = isStartedHidden()

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
let isLoggingOut = false
let spotifySetupResolver: ((value: any) => void) | null = null

function getIconPath(): string {
	const currentFile = fileURLToPath(import.meta.url)
	const currentDir = path.dirname(currentFile)

	// In packaged asar, assets/icon.ico is at root of app.asar
	const asarIcon = path.join(app.getAppPath(), 'assets', 'icon.ico')
	if (fs.existsSync(asarIcon)) return asarIcon

	// In dist/main/..., assets is ../../assets/icon.ico
	const distIcon = path.resolve(currentDir, '..', '..', 'assets', 'icon.ico')
	if (fs.existsSync(distIcon)) return distIcon

	const rootIcon = path.resolve(process.cwd(), 'assets', 'icon.ico')
	if (fs.existsSync(rootIcon)) return rootIcon

	return asarIcon
}

let activeNotification: Notification | null = null

function showNotification(title: string, body: string) {
	if (Notification.isSupported()) {
		if (activeNotification) {
			try {
				activeNotification.close()
			} catch {}
			activeNotification = null
		}
		activeNotification = new Notification({
			title,
			body,
			icon: getAppIcon()
		})
		activeNotification.show()
	}
}

function getAppIcon(): Electron.NativeImage {
	const iconPath = getIconPath()
	return nativeImage.createFromPath(iconPath)
}

function getHtmlPath(subPath: string): string {
	const currentFile = fileURLToPath(import.meta.url)
	const currentDir = path.dirname(currentFile)

	// 1. Candidate relative to dist/main -> dist/renderer (works in packaged asar & dist)
	const distRel = path.resolve(currentDir, '..', 'renderer', subPath)
	if (fs.existsSync(distRel)) return distRel

	// 2. Candidate inside app.getAppPath() dist/renderer
	const asarDist = path.join(app.getAppPath(), 'dist', 'renderer', subPath)
	if (fs.existsSync(asarDist)) return asarDist

	// 3. Candidate in project cwd dist/renderer
	const cwdDist = path.resolve(process.cwd(), 'dist', 'renderer', subPath)
	if (fs.existsSync(cwdDist)) return cwdDist

	// 4. Candidate in project cwd src/renderer (dev mode fallback)
	const srcPath = path.resolve(process.cwd(), 'src', 'renderer', subPath)
	if (fs.existsSync(srcPath)) return srcPath

	// 5. Candidate inside app.getAppPath() src/renderer
	const asarSrc = path.join(app.getAppPath(), 'src', 'renderer', subPath)
	if (fs.existsSync(asarSrc)) return asarSrc

	return distRel
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

function createSessionWindow() {
	if (sessionWindow && !sessionWindow.isDestroyed()) return

	sessionWindow = new BrowserWindow({
		width: 1,
		height: 1,
		show: false,
		frame: false,
		skipTaskbar: true,
		focusable: false,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false
		}
	})

	sessionWindow.loadURL('about:blank')

	sessionWindow.on('query-session-end', async (event: Electron.WindowSessionEndEvent) => {
		event.preventDefault()
		log.info({ reasons: event.reasons }, 'OS session ending on sessionWindow; preventing shutdown to restore bio')
		await gracefulExit()
	})

	sessionWindow.on('session-end', async () => {
		log.info('OS session-end received on sessionWindow; running graceful exit')
		await gracefulExit()
	})
}

function createLoginWindow() {
	if (loginWindow && !loginWindow.isDestroyed()) {
		loginWindow.show()
		loginWindow.focus()
		return
	}

	const appIcon = getAppIcon()

	loginWindow = new BrowserWindow({
		width: 390,
		height: 530,
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

	loginWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
		log.error({ errorCode, errorDescription, validatedURL }, 'LoginWindow failed to load')
	})

	loginWindow.loadFile(getHtmlPath('login/index.html'))

	loginWindow.webContents.on('did-finish-load', () => {
		const qr = whatsappClient.getLastQr()
		if (qr && loginWindow && !loginWindow.isDestroyed()) {
			loginWindow.webContents.send('whatsapp:qr', qr)
		}
	})

	loginWindow.on('query-session-end', async (event: Electron.WindowSessionEndEvent) => {
		event.preventDefault()
		log.info({ reasons: event.reasons }, 'OS query-session-end received on loginWindow; preventing shutdown to restore bio')
		await gracefulExit()
	})

	loginWindow.on('session-end', async () => {
		log.info('OS session-end received on loginWindow; running graceful exit')
		await gracefulExit()
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
		width: 610,
		height: 770,
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

	settingsWindow.webContents.on('preload-error', (event, preloadPath, error) => {
		log.error({ preloadPath, error }, 'Preload error in settingsWindow')
	})

	settingsWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
		log.info({ level, message, line, sourceId }, 'SettingsWindow console')
	})

	settingsWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
		log.error({ errorCode, errorDescription, validatedURL }, 'SettingsWindow failed to load')
	})

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
		if (!isQuitting && !isLoggingOut) {
			// Do NOT preventDefault! Allow window to destroy its renderer process
			// to reclaim memory while running in the system tray.
			log.info('Settings window closed; unloading renderer to save RAM')
			if (config.notifyOnMinimize) {
				showNotification('WAPresence', 'Minimized to system tray')
			}
		}
	})

	settingsWindow.on('query-session-end', async (event: Electron.WindowSessionEndEvent) => {
		event.preventDefault()
		log.info({ reasons: event.reasons }, 'OS query-session-end received on settingsWindow; preventing shutdown to restore bio')
		await gracefulExit()
	})

	settingsWindow.on('session-end', async () => {
		log.info('OS session-end received on settingsWindow; running graceful exit')
		await gracefulExit()
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
			height: 309,
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

		spotifyDialog.webContents.on('preload-error', (event, preloadPath, error) => {
			log.error({ preloadPath, error }, 'Preload error in spotifyDialog')
		})

		spotifyDialog.webContents.on('console-message', (event, level, message, line, sourceId) => {
			log.info({ level, message, line, sourceId }, 'SpotifyDialog console')
		})

		spotifyDialog.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
			log.error({ errorCode, errorDescription, validatedURL }, 'SpotifyDialog failed to load')
		})

		spotifyDialog.loadFile(getHtmlPath('spotify-setup/index.html'))

		spotifyDialog.on('query-session-end', async (event: Electron.WindowSessionEndEvent) => {
			event.preventDefault()
			log.info({ reasons: event.reasons }, 'OS query-session-end received on spotifyDialog; preventing shutdown to restore bio')
			await gracefulExit()
		})

		spotifyDialog.on('session-end', async () => {
			log.info('OS session-end received on spotifyDialog; running graceful exit')
			await gracefulExit()
		})

		spotifyDialog.on('closed', () => {
			spotifyDialog = null
			if (spotifySetupResolver) {
				spotifySetupResolver({ confirmed: false })
				spotifySetupResolver = null
			}
		})
	})
}

function openSettingsAndCheckUpdates() {
	if (settingsWindow && !settingsWindow.isDestroyed()) {
		if (settingsWindow.isMinimized()) settingsWindow.restore()
		settingsWindow.show()
		settingsWindow.focus()
		settingsWindow.webContents.send('app:open-preferences-and-check-updates')
	} else {
		createSettingsWindow()
		if (settingsWindow) {
			settingsWindow.webContents.once('did-finish-load', () => {
				setTimeout(() => {
					if (settingsWindow && !settingsWindow.isDestroyed()) {
						settingsWindow.webContents.send('app:open-preferences-and-check-updates')
					}
				}, 200)
			})
		}
	}
}

function updateTrayMenu() {
	if (!tray || tray.isDestroyed()) return

	const isPaused = presenceUpdater?.isPaused() ?? false
	const isConnected = whatsappClient.getState() === 'connected'

	const contextMenu = Menu.buildFromTemplate([
		{
			label: 'Settings',
			click: () => {
				if (settingsWindow && !settingsWindow.isDestroyed()) {
					if (settingsWindow.isMinimized()) settingsWindow.restore()
					settingsWindow.show()
					settingsWindow.focus()
				} else if (whatsappClient.getState() === 'connected') {
					createSettingsWindow()
				} else {
					createLoginWindow()
				}
			}
		},
		{
			label: isPaused ? 'Resume Presence' : 'Pause Presence',
			enabled: isConnected,
			click: async () => {
				if (presenceUpdater) {
					await presenceUpdater.togglePause()
					updateTrayMenu()
				}
			}
		},
		{
			label: 'Check for Updates',
			click: () => {
				openSettingsAndCheckUpdates()
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
}

function createTray() {
	if (tray) return

	const appIcon = getAppIcon()
	tray = new Tray(appIcon)
	tray.setToolTip('WAPresence')
	updateTrayMenu()

	tray.on('double-click', () => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			if (settingsWindow.isMinimized()) settingsWindow.restore()
			settingsWindow.show()
			settingsWindow.focus()
		} else if (whatsappClient.getState() === 'connected') {
			createSettingsWindow()
		} else {
			createLoginWindow()
		}
	})
}

async function handleLogout() {
	isLoggingOut = true
	try {
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
		// Start connecting immediately so loginWindow gets fresh QR
		whatsappClient.connect().catch((err) => {
			log.error({ err }, 'Error connecting to WhatsApp post-logout')
		})
	} finally {
		isLoggingOut = false
	}
}

let exitPromise: Promise<void> | null = null

async function gracefulExit() {
	if (exitPromise) return exitPromise
	isQuitting = true
	log.info('Initiating graceful shutdown; prioritizing WhatsApp bio restoration')

	exitPromise = (async () => {
		let blockerId: number | null = null
		try {
			blockerId = powerSaveBlocker.start('prevent-app-suspension')
		} catch {}

		// 1. Immediately stop presence update loop to prevent subsequent status overwrites
		if (presenceUpdater) {
			try {
				await presenceUpdater.stop()
			} catch (err) {
				log.warn({ err }, 'Error stopping presence updater')
			}
		}

		// 2. Immediately restore original WhatsApp bio and disconnect client
		try {
			const disconnectPromise = whatsappClient.disconnect()
			const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 4000))
			await Promise.race([disconnectPromise, timeoutPromise])
		} catch (err) {
			log.warn({ err }, 'Error disconnecting WhatsApp client')
		}

		if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
			try {
				powerSaveBlocker.stop(blockerId)
			} catch {}
		}

		// 3. Cleanly destroy UI elements and force fast exit
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.destroy()
			settingsWindow = null
		}
		if (loginWindow && !loginWindow.isDestroyed()) {
			loginWindow.destroy()
			loginWindow = null
		}
		if (spotifyDialog && !spotifyDialog.isDestroyed()) {
			spotifyDialog.destroy()
			spotifyDialog = null
		}
		if (sessionWindow && !sessionWindow.isDestroyed()) {
			sessionWindow.destroy()
			sessionWindow = null
		}
		if (tray && !tray.isDestroyed()) {
			tray.destroy()
			tray = null
		}

		app.exit(0)
	})()

	return exitPromise
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
		const status = getAutoStartStatus()
		return {
			...status,
			openAtLogin: status.openAtLogin || config.startWithOS
		}
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

	ipcMain.handle('presence:get-status', () => {
		return presenceUpdater ? presenceUpdater.getStatus() : null
	})

	ipcMain.handle('presence:toggle-pause', async () => {
		if (presenceUpdater) {
			const isPaused = await presenceUpdater.togglePause()
			updateTrayMenu()
			return isPaused
		}
		return false
	})

	ipcMain.handle('presence:get-pause-state', () => {
		return presenceUpdater ? presenceUpdater.isPaused() : false
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

	ipcMain.handle('whatsapp:request-pairing-code', async (_, phoneNumber: string) => {
		try {
			const code = await whatsappClient.requestPairingCode(phoneNumber)
			return { success: true, code }
		} catch (err: any) {
			log.error({ err, phoneNumber }, 'Failed to request pairing code')
			return { success: false, error: err.message || 'Failed to request pairing code' }
		}
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

	ipcMain.handle('app:open-external', (_, url: string) => {
		if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
			shell.openExternal(url).catch((err) => log.warn({ err, url }, 'Failed to open external url'))
		}
	})
}

function initPresenceUpdater() {
	if (!presenceUpdater) {
		presenceUpdater = new PresenceUpdater(whatsappClient, config)
		presenceUpdater.on('status_updated', (status) => {
			if (settingsWindow && !settingsWindow.isDestroyed()) {
				settingsWindow.webContents.send('presence:status', status)
			}
		})
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
		presenceUpdater.on('pause_change', (isPaused) => {
			updateTrayMenu()
			if (settingsWindow && !settingsWindow.isDestroyed()) {
				settingsWindow.webContents.send('presence:pause-changed', isPaused)
			}
		})
		presenceUpdater.start().catch((err) => {
			log.error({ err }, 'Error starting presence updater')
		})
	}
}

// WhatsApp client event bridging
function setupWhatsAppEvents() {
	let hasNotifiedDisconnected = false

	whatsappClient.on('qr', (dataUrl: string) => {
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.close()
			settingsWindow = null
		}
		if (!isLaunchedHidden) {
			if (!loginWindow || loginWindow.isDestroyed()) {
				createLoginWindow()
			}
		}
		if (loginWindow && !loginWindow.isDestroyed()) {
			if (!loginWindow.webContents.isLoading()) {
				loginWindow.webContents.send('whatsapp:qr', dataUrl)
			}
		}
		settingsWindow?.webContents.send('whatsapp:status', 'qr')
	})

	whatsappClient.on('connected', async () => {
		hasNotifiedDisconnected = false
		log.info('WhatsApp connected event received in main process')
		const hadLoginWindow = Boolean(loginWindow && !loginWindow.isDestroyed())
		if (hadLoginWindow) {
			loginWindow?.close()
			loginWindow = null
			if (!isLaunchedHidden) {
				createSettingsWindow()
			}
		} else if (isLaunchedHidden) {
			log.info('WAPresence started minimized with OS; staying in system tray')
			isLaunchedHidden = false
		}
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.webContents.send('whatsapp:status', 'connected')
		}
		updateTrayMenu()
		if (config.notifyOnConnection) {
			showNotification('WAPresence', 'Connected to WhatsApp')
		}

		// Initialize presence updater loop
		initPresenceUpdater()

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
		updateTrayMenu()
		if (config.notifyOnConnection && !hasNotifiedDisconnected) {
			hasNotifiedDisconnected = true
			showNotification('WAPresence', 'Disconnected from WhatsApp. Reconnecting...')
		}
	})

	whatsappClient.on('logged_out', () => {
		hasNotifiedDisconnected = false
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.close()
			settingsWindow = null
		}
		updateTrayMenu()
		if (config.notifyOnConnection) {
			showNotification('WAPresence', 'Logged out of WhatsApp')
		}
		createLoginWindow()
		whatsappClient.connect().catch((err) => {
			log.error({ err }, 'Error connecting to WhatsApp post-logout')
		})
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
	log.info('Second instance launch detected; focusing or restoring existing app')
	isLaunchedHidden = false
	if (settingsWindow && !settingsWindow.isDestroyed()) {
		if (settingsWindow.isMinimized()) settingsWindow.restore()
		settingsWindow.show()
		settingsWindow.focus()
	} else if (loginWindow && !loginWindow.isDestroyed()) {
		if (loginWindow.isMinimized()) loginWindow.restore()
		loginWindow.show()
		loginWindow.focus()
	} else {
		// Both windows unloaded/closed in tray: restore dashboard or login
		if (whatsappClient.getState() === 'connected') {
			createSettingsWindow()
		} else {
			createLoginWindow()
		}
	}
})

app.whenReady().then(async () => {
	log.info({ isLaunchedHidden }, 'WAPresence starting up')
	createSessionWindow()
	setupIpcHandlers()
	setupWhatsAppEvents()
	setupUpdaterEvents()
	createTray()
	initPresenceUpdater()

	// Register powerMonitor shutdown handler (cross-platform OS shutdown detection on Linux & macOS)
	try {
		;(powerMonitor as any).on('shutdown', (event: any) => {
			log.info('powerMonitor shutdown event received; preventing shutdown to restore bio')
			if (event && typeof event.preventDefault === 'function') {
				event.preventDefault()
			}
			gracefulExit()
		})
	} catch (err) {
		log.warn({ err }, 'Failed to attach powerMonitor shutdown handler')
	}

	// Synchronize autostart with config on startup
	if (config.startWithOS) {
		setAutoStart(true)
	}

	const hasExistingAuth = fs.existsSync(path.join(getAuthDir(), 'creds.json'))

	if (!isLaunchedHidden) {
		if (hasExistingAuth) {
			createSettingsWindow()
		} else {
			createLoginWindow()
		}
	} else {
		log.info('App launched minimized; starting silently in tray')
	}

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

app.on('before-quit', (event: Electron.Event) => {
	if (!isQuitting) {
		event.preventDefault()
		log.info('app before-quit event received; running graceful exit')
		gracefulExit()
	}
})

app.on('will-quit', (event: Electron.Event) => {
	if (!isQuitting) {
		event.preventDefault()
		log.info('app will-quit event received; running graceful exit')
		gracefulExit()
	}
})

const terminationSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP', 'SIGQUIT']
terminationSignals.forEach((sig) => {
	try {
		process.on(sig, () => {
			log.info({ sig }, 'Received termination signal; running graceful exit')
			gracefulExit()
		})
	} catch {
		// Ignore if signal not supported on this platform
	}
})

process.on('uncaughtException', async (err) => {
	log.error({ err }, 'Uncaught exception in main process; attempting emergency bio restore before exit')
	await gracefulExit()
})
