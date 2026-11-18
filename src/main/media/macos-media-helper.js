// macos-media-helper.js - macOS Now Playing (MediaRemote) JXA Poller
// Executed via: /usr/bin/osascript -l JavaScript macos-media-helper.js
// Outputs single-line JSON to stdout for WAPresence (mirrors smtc-helper.ps1)

ObjC.import('Foundation')

var stdout = $.NSFileHandle.fileHandleWithStandardOutput

function writeLine(str) {
	var data = $(str + '\n').dataUsingEncoding($.NSUTF8StringEncoding)
	stdout.writeData(data)
}

function isObjCNil(obj) {
	if (obj === null || obj === undefined) return true
	try {
		if (typeof obj.isNil === 'function') return Boolean(obj.isNil())
		if (typeof obj.isNil === 'boolean') return obj.isNil
	} catch (e) {}
	return false
}

function unwrap(obj) {
	if (isObjCNil(obj)) return null
	try {
		var val = ObjC.unwrap(obj)
		if (val === undefined || val === null) return null
		return val
	} catch (e) {
		try {
			return obj.js
		} catch (e2) {
			return null
		}
	}
}

function toStringVal(obj) {
	var val = unwrap(obj)
	if (val === null || val === undefined) return ''
	return String(val).trim()
}

function toNumberVal(obj) {
	if (typeof obj === 'number') return isNaN(obj) ? 0 : obj
	var val = unwrap(obj)
	if (val === null || val === undefined) return 0
	var num = Number(val)
	return isNaN(num) ? 0 : num
}

function getNowPlayingSnapshot(MRNowPlayingRequest) {
	var nowPlayingItem = null
	try {
		nowPlayingItem = MRNowPlayingRequest.localNowPlayingItem
	} catch (e) {
		return { status: 'None' }
	}

	if (isObjCNil(nowPlayingItem)) {
		return { status: 'None' }
	}

	var title = ''
	var artist = ''
	var album = ''
	var trackNumber = 0
	var playbackRate = null

	var infoDict = null
	try {
		infoDict = nowPlayingItem.nowPlayingInfo
	} catch (e) {}

	if (!isObjCNil(infoDict)) {
		try { title = toStringVal(infoDict.valueForKey('kMRMediaRemoteNowPlayingInfoTitle')) } catch (e) {}
		try { artist = toStringVal(infoDict.valueForKey('kMRMediaRemoteNowPlayingInfoArtist')) } catch (e) {}
		try { album = toStringVal(infoDict.valueForKey('kMRMediaRemoteNowPlayingInfoAlbum')) } catch (e) {}
		try { trackNumber = Math.floor(toNumberVal(infoDict.valueForKey('kMRMediaRemoteNowPlayingInfoTrackNumber'))) } catch (e) {}
		try {
			var rateObj = infoDict.valueForKey('kMRMediaRemoteNowPlayingInfoPlaybackRate')
			if (!isObjCNil(rateObj)) {
				playbackRate = toNumberVal(rateObj)
			}
		} catch (e) {}
	} else {
		var meta = null
		try {
			meta = nowPlayingItem.metadata
		} catch (e) {}
		if (!isObjCNil(meta)) {
			try { title = toStringVal(meta.title) } catch (e) {}
			try { artist = toStringVal(meta.trackArtistName) } catch (e) {}
			try { album = toStringVal(meta.albumName) } catch (e) {}
			try { trackNumber = Math.floor(toNumberVal(meta.trackNumber)) } catch (e) {}
			try {
				var metaRate = meta.playbackRate
				if (typeof metaRate === 'number' && !isNaN(metaRate)) {
					playbackRate = metaRate
				} else if (!isObjCNil(metaRate)) {
					playbackRate = toNumberVal(metaRate)
				}
			} catch (e) {}
		}
	}

	if (!title && !artist) {
		return { status: 'None' }
	}

	var isPlaying = false
	if (playbackRate !== null) {
		isPlaying = playbackRate > 0
	} else {
		try {
			isPlaying = Boolean(unwrap(MRNowPlayingRequest.localIsPlaying))
		} catch (e) {
			isPlaying = false
		}
	}

	var appName = ''
	try {
		var playerPath = MRNowPlayingRequest.localNowPlayingPlayerPath
		if (!isObjCNil(playerPath)) {
			var client = playerPath.client
			if (!isObjCNil(client)) {
				var displayName = toStringVal(client.displayName)
				var bundleId = toStringVal(client.bundleIdentifier)
				if (displayName && bundleId && displayName.toLowerCase() !== bundleId.toLowerCase()) {
					appName = displayName + ' (' + bundleId + ')'
				} else {
					appName = displayName || bundleId || ''
				}
			}
		}
	} catch (e) {}

	return {
		title: title,
		artist: artist,
		album: album,
		track_number: trackNumber > 0 ? trackNumber : 0,
		status: isPlaying ? 'Playing' : 'Paused',
		app: appName
	}
}

function run() {
	try {
		var bundle = $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework')
		if (isObjCNil(bundle)) {
			writeLine(JSON.stringify({ error: 'MediaRemote.framework bundle not found' }))
			return
		}

		var loaded = false
		try {
			loaded = Boolean(bundle.loadAndReturnError(null))
		} catch (e) {
			try {
				loaded = Boolean(bundle.load)
			} catch (e2) {}
		}

		if (!loaded) {
			writeLine(JSON.stringify({ error: 'Failed to load MediaRemote.framework' }))
			return
		}

		var MRNowPlayingRequest = $.NSClassFromString('MRNowPlayingRequest')
		if (isObjCNil(MRNowPlayingRequest)) {
			writeLine(JSON.stringify({ error: 'MRNowPlayingRequest class unavailable' }))
			return
		}

		var lastOutput = ''
		// Recycle cleanly every 3600 ticks (~1 hour) so parent respawns fresh process with zero memory drift
		var maxTicks = 3600

		for (var tick = 0; tick < maxTicks; tick++) {
			try {
				var snapshot = getNowPlayingSnapshot(MRNowPlayingRequest)
				var json = JSON.stringify(snapshot)
				if (json !== lastOutput) {
					writeLine(json)
					lastOutput = json
				}
			} catch (e) {
				// Exit loop immediately if stdout pipe closed (parent terminated)
				var msg = String(e || '')
				if (msg.indexOf('FileHandle') !== -1 || msg.indexOf('pipe') !== -1 || msg.indexOf('EPIPE') !== -1) {
					break
				}
			}

			try {
				$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(1.0))
			} catch (e) {
				delay(1)
			}
		}
	} catch (err) {
		try {
			writeLine(JSON.stringify({ error: String(err && err.message ? err.message : err) }))
		} catch (e) {}
	}
}
