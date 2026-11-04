import fs from 'node:fs'
import pino from 'pino'
import { getLogFilePath } from './paths.js'

const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)

const streams: any[] = [
	{ stream: process.stdout }
]

if (!isTest) {
	const logFilePath = getLogFilePath()
	const fileStream = fs.createWriteStream(logFilePath, { flags: 'a' })
	streams.push({ stream: fileStream })
}

export const logger = pino(
	{
		level: isTest ? 'silent' : (process.env.LOG_LEVEL || 'info'),
		timestamp: pino.stdTimeFunctions.isoTime
	},
	pino.multistream(streams)
)

export function getLogger(moduleName: string) {
	return logger.child({ module: moduleName })
}
