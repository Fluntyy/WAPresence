import { EventEmitter } from 'node:events'
import { MediaTrackInfo } from '../format.js'

export type { MediaTrackInfo }

export interface IMediaSource extends EventEmitter {
	readonly name: string
	start(): Promise<void> | void
	stop(): Promise<void> | void
	getCurrentTrack(): Promise<MediaTrackInfo | null>
}
