import { createAdminClient } from '@/lib/supabase/admin'

export interface EmitParams {
  /** Event name, e.g. "entry.created", "event.published" */
  event: string
  /** Organization that owns the event */
  organizationId: string
  /** JSON-serializable payload to deliver */
  payload: Record<string, unknown>
}

/**
 * Emit a webhook event for an organization.
 *
 * Looks up all active webhook endpoints subscribed to this event type,
 * then queues a `webhook.deliver` job for each one.
 *
 * Delivery is async — the actual HTTP POST to the endpoint URL happens
 * in the background job worker.
 */
export async function emit(params: EmitParams): Promise<void> {
  const { event, organizationId, payload } = params
  const supabase = createAdminClient()

  // Find active webhook endpoints subscribed to this event
  interface WebhookEndpointRow {
    id: string
    url: string
    secret: string
    subscribed_events: string[]
  }

  const { data: rawEndpoints, error: fetchError } = await supabase
    .from('webhook_endpoints')
    .select('id, url, secret, subscribed_events')
    .eq('organization_id', organizationId)
    .eq('active', true)

  if (fetchError) {
    console.error('[Webhooks] Failed to fetch endpoints:', fetchError.message)
    return
  }

  const endpoints = (rawEndpoints ?? []) as unknown as WebhookEndpointRow[]

  if (endpoints.length === 0) {
    return
  }

  // Filter to endpoints subscribed to this specific event (or wildcard "*")
  const matchingEndpoints = endpoints.filter((endpoint) => {
    return endpoint.subscribed_events.includes(event) || endpoint.subscribed_events.includes('*')
  })

  if (matchingEndpoints.length === 0) {
    return
  }

  // Queue delivery jobs
  const deliveryJobs = matchingEndpoints.map((endpoint) => ({
    name: 'webhook.deliver',
    data: {
      endpointId: endpoint.id,
      endpointUrl: endpoint.url,
      endpointSecret: endpoint.secret,
      event,
      organizationId,
      payload,
      timestamp: new Date().toISOString(),
    },
  }))

  const { error: jobError } = await supabase
    .from('job_queue')
    .insert(deliveryJobs)

  if (jobError) {
    console.error('[Webhooks] Failed to queue delivery jobs:', jobError.message)
  }
}
