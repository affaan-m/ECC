import type { JobHandler, JobType } from './types'

const handlers = new Map<JobType, JobHandler>()

export function registerHandler(type: JobType, handler: JobHandler) {
  handlers.set(type, handler)
}

export function getHandler(type: JobType): JobHandler | undefined {
  return handlers.get(type)
}

export function listRegisteredTypes(): JobType[] {
  return Array.from(handlers.keys())
}
