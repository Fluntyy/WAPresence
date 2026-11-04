import { EventEmitter } from 'node:events'
import { IMediaSource, MediaTrackInfo } from './types.js'
import { getLogger } from '../logger.js'

const log = getLogger('media:unsupported')

export class UnsupportedMediaSource extends EventEmitter implements IMediaSource {
	readonly name = 'Local'

	public start(): void {
		log.warn('Local media is not supported on this platform')
	}

	public stop(): void {}

	public async getCurrentTrack(): Promise<MediaTrackInfo | null> {
		return null
	}
}
