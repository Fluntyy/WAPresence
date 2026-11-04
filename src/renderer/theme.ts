import {
	argbFromHex,
	themeFromSourceColor,
	applyTheme,
	hexFromArgb
} from '@material/material-color-utilities'

/**
 * Generates and applies the full MD3 color scheme directly onto document.documentElement
 * @param hexColor Seed color (e.g. WhatsApp emerald "#00a884", "#059669", or Windows accent color)
 * @param dark Whether to render Dark Mode or Light Mode
 */
export function applyMaterialTheme(hexColor: string, dark: boolean) {
	let argb: number
	try {
		argb = argbFromHex(hexColor)
	} catch {
		argb = argbFromHex('#059669') // Default emerald seed
	}

	const theme = themeFromSourceColor(argb)

	// 1. Core tokens injected by the official utility
	applyTheme(theme, { target: document.documentElement, dark })

	// 2. Set dark mode classes and colorScheme
	document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
	document.documentElement.classList.toggle('dark', dark)

	// 3. Inject explicit --md-sys-color-* kebab-case tokens
	const scheme = dark ? theme.schemes.dark : theme.schemes.light
	const json = scheme.toJSON()
	for (const [key, value] of Object.entries(json)) {
		const kebab = key.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase()
		document.documentElement.style.setProperty(`--md-sys-color-${kebab}`, hexFromArgb(value as number))
	}

	// 4. Populate MD3.2 Surface Containers (color-mixed with surface + onSurface)
	const surfaceHex = hexFromArgb(scheme.surface)
	const onSurfaceHex = hexFromArgb(scheme.onSurface)

	document.documentElement.style.setProperty(
		'--md-sys-color-surface-container',
		dark
			? `color-mix(in srgb, ${surfaceHex} 88%, ${onSurfaceHex})`
			: `color-mix(in srgb, ${surfaceHex} 94%, ${onSurfaceHex})`
	)
	document.documentElement.style.setProperty(
		'--md-sys-color-surface-container-low',
		dark
			? `color-mix(in srgb, ${surfaceHex} 94%, ${onSurfaceHex})`
			: `color-mix(in srgb, ${surfaceHex} 96%, ${onSurfaceHex})`
	)
	document.documentElement.style.setProperty(
		'--md-sys-color-surface-container-high',
		dark
			? `color-mix(in srgb, ${surfaceHex} 82%, ${onSurfaceHex})`
			: `color-mix(in srgb, ${surfaceHex} 92%, ${onSurfaceHex})`
	)
	document.documentElement.style.setProperty(
		'--md-sys-color-surface-container-highest',
		dark
			? `color-mix(in srgb, ${surfaceHex} 76%, ${onSurfaceHex})`
			: `color-mix(in srgb, ${surfaceHex} 88%, ${onSurfaceHex})`
	)
}
