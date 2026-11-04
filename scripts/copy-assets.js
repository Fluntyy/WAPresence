import fs from 'node:fs'
import path from 'node:path'

const projectRoot = process.cwd()

// Ensure dist/main/media exists and copy smtc-helper.ps1
const smtcSrc = path.join(projectRoot, 'src', 'main', 'media', 'smtc-helper.ps1')
const smtcDist = path.join(projectRoot, 'dist', 'main', 'media', 'smtc-helper.ps1')
if (fs.existsSync(smtcSrc)) {
	fs.mkdirSync(path.dirname(smtcDist), { recursive: true })
	fs.copyFileSync(smtcSrc, smtcDist)
	console.log(`Copied smtc-helper.ps1 -> ${smtcDist}`)
}

// Ensure assets/fonts are copied to renderer assets
const fontsSrc = path.join(projectRoot, 'assets', 'fonts')
const fontsRendererSrc = path.join(projectRoot, 'src', 'renderer', 'assets', 'fonts')
const fontsRendererDist = path.join(projectRoot, 'dist', 'renderer', 'assets', 'fonts')
const fontsDist = path.join(projectRoot, 'dist', 'assets', 'fonts')

if (fs.existsSync(fontsSrc)) {
	fs.mkdirSync(fontsRendererSrc, { recursive: true })
	fs.cpSync(fontsSrc, fontsRendererSrc, { recursive: true })

	fs.mkdirSync(fontsRendererDist, { recursive: true })
	fs.cpSync(fontsSrc, fontsRendererDist, { recursive: true })

	fs.mkdirSync(fontsDist, { recursive: true })
	fs.cpSync(fontsSrc, fontsDist, { recursive: true })
	console.log(`Copied offline fonts -> renderer assets`)
}

// Copy icon files to renderer assets
for (const iconFile of ['icon.ico', 'icon.png']) {
	const iconSrc = path.join(projectRoot, 'assets', iconFile)
	const iconRendererDest = path.join(projectRoot, 'src', 'renderer', 'assets', iconFile)
	const iconDistDest = path.join(projectRoot, 'dist', 'renderer', 'assets', iconFile)
	if (fs.existsSync(iconSrc)) {
		fs.mkdirSync(path.dirname(iconRendererDest), { recursive: true })
		fs.copyFileSync(iconSrc, iconRendererDest)
		fs.mkdirSync(path.dirname(iconDistDest), { recursive: true })
		fs.copyFileSync(iconSrc, iconDistDest)
		console.log(`Copied ${iconFile} -> renderer assets`)
	}
}

// Copy renderer files to dist/renderer
const rendererSrc = path.join(projectRoot, 'src', 'renderer')
const rendererDist = path.join(projectRoot, 'dist', 'renderer')
if (fs.existsSync(rendererSrc)) {
	fs.cpSync(rendererSrc, rendererDist, { recursive: true })
	console.log(`Copied renderer -> ${rendererDist}`)
}

// Copy preload index.cjs to dist/preload/index.cjs
const preloadSrc = path.join(projectRoot, 'src', 'preload', 'index.cjs')
const preloadDist = path.join(projectRoot, 'dist', 'preload', 'index.cjs')
if (fs.existsSync(preloadSrc)) {
	fs.mkdirSync(path.dirname(preloadDist), { recursive: true })
	fs.copyFileSync(preloadSrc, preloadDist)
	console.log(`Copied preload -> ${preloadDist}`)
}
