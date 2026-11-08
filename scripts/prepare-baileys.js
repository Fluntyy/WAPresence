import fs from 'node:fs'
import path from 'node:path'

const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(process.cwd(), '..', 'Baileys')

const pkgPath = path.join(targetDir, 'package.json')
if (fs.existsSync(pkgPath)) {
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
	delete pkg.packageManager
	pkg.devDependencies = pkg.devDependencies || {}
	pkg.devDependencies['long'] = '^5.3.2'
	pkg.devDependencies['@types/long'] = '^5.0.0'
	fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
	console.log('Patched Baileys package.json successfully')
} else {
	console.warn('Baileys package.json not found at:', pkgPath)
}

const mediaPath = path.join(targetDir, 'src', 'Utils', 'messages-media.ts')
if (fs.existsSync(mediaPath)) {
	let content = fs.readFileSync(mediaPath, 'utf8')
	content = content.replace(
		'Math.abs(rawData[blockStart + j])',
		'Math.abs(rawData[blockStart + j]!)'
	)
	fs.writeFileSync(mediaPath, content)
	console.log('Patched Baileys messages-media.ts successfully')
} else {
	console.warn('Baileys messages-media.ts not found at:', mediaPath)
}

// Disable strict build checks for pnpm 11+
const npmrcPath = path.join(targetDir, '.npmrc')
fs.writeFileSync(npmrcPath, 'shamefully-hoist=true\nstrict-dep-builds=false\n')
console.log('Wrote Baileys .npmrc')

const workspacePath = path.join(targetDir, 'pnpm-workspace.yaml')
fs.writeFileSync(workspacePath, 'strictDepBuilds: false\n')
console.log('Wrote Baileys pnpm-workspace.yaml')
