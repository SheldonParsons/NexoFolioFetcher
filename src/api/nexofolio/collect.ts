import { NexoFolioClient } from './client'
import type { CollectBatch } from '../../upload/contracts'
// Collect needs no login: the batch names its own project and environment, the server only checks them.
export const submitBatch = (base: string, batch: CollectBatch) =>
  new NexoFolioClient(base).request('/v1/collect/batches', { method:'POST', body:batch, timeoutMs:30000 })
