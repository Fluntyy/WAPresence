import { describe, it, expect } from 'vitest'
import {
	truncateText,
	formatLengthCounter,
	formatMediaStatus,
	MAX_ABOUT_LENGTH,
	MediaTrackInfo
} from './format.js'

describe('format', () => {
	describe('truncateText', () => {
		it('leaves strings shorter than or equal to max length untouched', () => {
			expect(truncateText('Hello', 10)).toBe('Hello')
			expect(truncateText('A'.repeat(50), 50)).toBe('A'.repeat(50))
		})

		it('truncates strings exceeding max length and appends ellipsis to total length', () => {
			const str = 'This is a very long string that definitely exceeds fifty characters in total length'
			const truncated = truncateText(str, 50)
			expect(truncated.length).toBe(50)
			expect(truncated.endsWith('...')).toBe(true)
			expect(truncated).toBe(str.slice(0, 47) + '...')
		})

		it('handles short max length edge cases gracefully', () => {
			expect(truncateText('Hello', 3)).toBe('Hel')
			expect(truncateText('Hello', 2)).toBe('He')
			expect(truncateText('Hello', 1)).toBe('H')
			expect(truncateText('Hello', 0)).toBe('')
		})
	})

	describe('formatLengthCounter', () => {
		it('returns length formatted as X/50', () => {
			expect(formatLengthCounter('abc')).toBe('3/50')
			expect(formatLengthCounter('a'.repeat(50))).toBe('50/50')
			expect(formatLengthCounter('test', 100)).toBe('4/100')
		})
	})

	describe('formatMediaStatus', () => {
		it('returns original bio when media is null or not playing', () => {
			const originalBio = 'My personal bio'
			expect(formatMediaStatus('Listening to [title]', null, originalBio)).toBe(originalBio)

			const stoppedMedia: MediaTrackInfo = {
				title: 'Song',
				isPlaying: false,
				isPaused: false
			}
			expect(formatMediaStatus('Listening to [title]', stoppedMedia, originalBio)).toBe(originalBio)
		})

		it('removes status (returns empty string) when music stops and there is no original bio', () => {
			expect(formatMediaStatus('Listening to [title]', null, '')).toBe('')
			expect(formatMediaStatus('Listening to [title]', null, '   ')).toBe('')
		})

		it('appends ⏸️ emoji when music is paused', () => {
			const pausedMedia: MediaTrackInfo = {
				title: 'Midnight City',
				artist: 'M83',
				isPlaying: false,
				isPaused: true
			}
			const result = formatMediaStatus('[title]', pausedMedia, '', 50, true)
			expect(result).toBe('Midnight City ⏸️')
		})

		it('does not append ⏸️ emoji when appendPauseEmoji is false', () => {
			const pausedMedia: MediaTrackInfo = {
				title: 'Midnight City',
				artist: 'M83',
				isPlaying: false,
				isPaused: true
			}
			const result = formatMediaStatus('[title]', pausedMedia, '', 50, false)
			expect(result).toBe('Midnight City')
		})

		it('substitutes dynamic custom plugin fields', () => {
			const pluginMedia: MediaTrackInfo = {
				title: 'Song',
				artist: 'Singer',
				isPlaying: true,
				isPaused: false,
				source: 'Plugin',
				customFields: {
					device: 'Pixel 9 Pro',
					app: 'YouTube Music'
				}
			}
			const template = '[title] on [device] via [app]'
			const result = formatMediaStatus(template, pluginMedia, '', 100)
			expect(result).toBe('Song on Pixel 9 Pro via YouTube Music')
		})

		it('substitutes all placeholders correctly', () => {
			const media: MediaTrackInfo = {
				artist: 'Daft Punk',
				title: 'Get Lucky',
				album: 'Random Access Memories',
				trackNumber: 8,
				isPlaying: true,
				isPaused: false
			}
			const template = '[tracknum]. [artist] - [title] ([album]) | [bio]'
			const originalBio = 'Coding'
			const result = formatMediaStatus(template, media, originalBio, 100)
			expect(result).toBe('8. Daft Punk - Get Lucky (Random Access Memories) | Coding')
		})

		it('replaces missing metadata with default fallbacks', () => {
			const media: MediaTrackInfo = {
				title: 'Solo Track',
				isPlaying: true,
				isPaused: false
			}
			const template = '[tracknum] [artist] - [title] - [album]'
			const result = formatMediaStatus(template, media, '', 100)
			expect(result).toBe(' Unknown Artist - Solo Track - Unknown Album')
		})

		it('truncates result to 50 characters when exceeding limit', () => {
			const media: MediaTrackInfo = {
				artist: 'The Symphony Orchestra of London',
				title: 'Movement 1 in C Minor: An Epic Orchestral Piece',
				album: 'Complete Symphonies Edition 2026',
				isPlaying: true,
				isPaused: false
			}
			const template = 'Listening to [artist] - [title] | [bio]'
			const result = formatMediaStatus(template, media, 'Bio', MAX_ABOUT_LENGTH)
			expect(result.length).toBe(MAX_ABOUT_LENGTH)
			expect(result.endsWith('...')).toBe(true)
		})

		it('replaces placeholders case-insensitively', () => {
			const media: MediaTrackInfo = {
				artist: 'Artist',
				title: 'Title',
				isPlaying: true,
				isPaused: false
			}
			const template = '[ARTIST] - [Title]'
			const result = formatMediaStatus(template, media, '', 50)
			expect(result).toBe('Artist - Title')
		})
	})
})
