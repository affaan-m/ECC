import { createHmac } from 'node:crypto'
import { registerHandler } from '../registry'
import type { JobPayload, JobResult } from '../types'

function signPayload(secret: string, timestamp: number, body: string): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
  return `t=${timestamp},v1=${signature}`
}

async function handleWebhookDeliver(payload: JobPayload): Promise<JobResult> {
  const { endpointId, url, secret, eventType, eventId, eventPayload } = payload as {
    endpointId: string
    url: string
    secret: string
    eventType: string
    eventId: string
    eventPayload: Record<string, unknown>
  }

  try {
    const body = JSON.stringify(eventPayload)
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = signPayload(secret, timestamp, body)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-StageFlow-Signature': signature,
        'X-StageFlow-Event': eventType,
        'X-StageFlow-Delivery': eventId,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    })

    const responseBody = await response.text().catch(() => '')

    if (response.ok) {
      return {
        success: true,
        metadata: {
          endpointId,
          eventType,
          responseStatus: response.status,
          responseBody: responseBody.slice(0, 4096),
        },
      }
    }

    return {
      success: false,
      error: `HTTP ${response.status}: ${responseBody.slice(0, 500)}`,
      metadata: { endpointId, eventType, responseStatus: response.status },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Webhook delivery failed',
      metadata: { endpointId, eventType },
    }
  }
}

registerHandler('webhook.deliver', handleWebhookDeliver)
