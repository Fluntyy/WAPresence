export const MAX_ABOUT_LENGTH = 50

export interface MediaTrackInfo {
	title: string
	artist?: string
	album?: string
	trackNumber?: number | string
	isPlaying: boolean
	isPaused: boolean
	source?: 'Local' | 'Spotify' | 'Plugin'
	customFields?: Record<string, string | number>
}

/**
 * Truncate text to maxLength. If truncated and maxLength > 3, appends '...' so total length is maxLength.
 */
export function truncateText(text: string, maxLength: number = MAX_ABOUT_LENGTH): string {
	if (text.length <= maxLength) {
		return text
	}
	if (maxLength <= 3) {
		return text.slice(0, maxLength)
	}
	return text.slice(0, maxLength - 3) + '...'
}

/**
 * Returns a display string for the character length counter, e.g. "25/50".
 */
export function formatLengthCounter(text: string, maxLength: number = MAX_ABOUT_LENGTH): string {
	return `${text.length}/${maxLength}`
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Returns the list of standard and dynamic custom placeholders.
 */
export function getAvailablePlaceholders(customFields?: Record<string, any>): string[] {
	const standard = ['[artist]', '[title]', '[album]', '[tracknum]', '[bio]']
	if (!customFields) return standard

	const custom = Object.keys(customFields).map((k) => `[${k.toLowerCase()}]`)
	const set = new Set([...standard, ...custom])
	return Array.from(set)
}

/**
 * Formats the status string using media information, custom plugin fields, and placeholders:
 * [artist], [title], [album], [tracknum], [bio] + [custom_field]
 *
 * If no media is playing/paused, returns the original bio (or empty string if no bio exists).
 */
export function formatMediaStatus(
	formatTemplate: string,
	media: MediaTrackInfo | null,
	originalBio: string,
	maxLength: number = MAX_ABOUT_LENGTH,
	appendPauseEmoji: boolean = true
): string {
	const bio = (originalBio || '').trim()

	if (!media || !media.title || (!media.isPlaying && !media.isPaused)) {
		// When music stops playing, restore bio; if there is no bio, return empty string to remove status
		return bio.length > 0 ? truncateText(bio, maxLength) : ''
	}

	const artist = media.artist || 'Unknown Artist'
	let title = media.title || 'Unknown Title'

	// Pause emoji handling
	if (media.isPaused) {
		// Clean any legacy "(Paused)" or existing "⏸️"
		title = title.replace(/\s*\(Paused\)$/, '').replace(/\s*⏸️$/, '').trim()
		if (appendPauseEmoji) {
			title = `${title} ⏸️`
		}
	} else {
		// If actively playing, make sure no pause suffix remains
		title = title.replace(/\s*⏸️$/, '').replace(/\s*\(Paused\)$/, '').trim()
	}

	const album = media.album || 'Unknown Album'
	const tracknum = media.trackNumber !== undefined && media.trackNumber !== null && media.trackNumber !== 0
		? String(media.trackNumber)
		: ''

	let result = formatTemplate
		.replace(/\[artist\]/gi, artist)
		.replace(/\[title\]/gi, title)
		.replace(/\[album\]/gi, album)
		.replace(/\[tracknum\]/gi, tracknum)
		.replace(/\[bio\]/gi, bio)

	// Dynamically substitute any custom plugin fields, e.g. [app], [device], [genre]
	if (media.customFields) {
		for (const [key, val] of Object.entries(media.customFields)) {
			if (val !== undefined && val !== null) {
				const regex = new RegExp(`\\[${escapeRegex(key)}\\]`, 'gi')
				result = result.replace(regex, String(val))
			}
		}
	}

	return truncateText(result, maxLength)
}
