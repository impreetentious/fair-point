import { DealFileSchema } from '../../core/schema'
import { computeFrontier, frontierIdentity } from './frontier-analysis'
self.onmessage = (event: MessageEvent<unknown>) => {
  const raw = event.data as { generation?: unknown; identity?: unknown; deal?: unknown }
  if (!raw || !Number.isSafeInteger(raw.generation) || typeof raw.identity !== 'string')
    throw new Error('Invalid frontier request')
  const deal = DealFileSchema.parse(raw.deal)
  if (frontierIdentity(deal) !== raw.identity) throw new Error('Frontier request identity mismatch')
  self.postMessage({
    generation: raw.generation,
    identity: raw.identity,
    result: computeFrontier(deal),
  })
}
