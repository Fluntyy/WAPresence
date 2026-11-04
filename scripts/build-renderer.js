import esbuild from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'

const root = process.cwd()
const entry = path.join(root, 'src', 'renderer', 'md3-bundle.ts')
const outSrc = path.join(root, 'src', 'renderer', 'md3.bundle.js')
const outDist = path.join(root, 'dist', 'renderer', 'md3.bundle.js')

console.log('Building Material Design 3 offline web bundle...')

await esbuild.build({
	entryPoints: [entry],
	bundle: true,
	minify: true,
	format: 'iife',
	target: ['chrome120', 'es2022'],
	outfile: outSrc
})

// Ensure dist/renderer exists and copy there too
fs.mkdirSync(path.dirname(outDist), { recursive: true })
fs.copyFileSync(outSrc, outDist)

console.log('MD3 bundle built successfully -> src/renderer/md3.bundle.js & dist/renderer/md3.bundle.js')
