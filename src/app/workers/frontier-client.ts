import type { DealFile } from '../../core/schema'
import type { FrontierComputation } from './frontier-analysis'

type WorkerPort = Pick<
  Worker,
  'onerror' | 'onmessageerror' | 'onmessage' | 'postMessage' | 'terminate'
>
/** Owns one synchronous worker run. Termination and closed checks also suppress queued replies. */
export function startFrontierRequest(
  deal: DealFile,
  identity: string,
  generation: number,
  onResult: (result: FrontierComputation) => void,
  onError: (message: string) => void,
  create: () => WorkerPort,
) {
  let worker: WorkerPort | null = null
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    worker?.terminate()
  }
  const fail = (message: string) => {
    if (closed) return
    close()
    onError(message)
  }
  try {
    worker = create()
    worker.onerror = () => fail('Frontier worker failed. Retry the computation.')
    worker.onmessageerror = () =>
      fail('Frontier worker response could not be read. Retry the computation.')
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (closed) return
      const raw = event.data as {
        generation?: unknown
        identity?: unknown
        result?: FrontierComputation
      }
      if (
        !raw ||
        raw.generation !== generation ||
        raw.identity !== identity ||
        !raw.result ||
        !Number.isFinite(raw.result.elapsed) ||
        !Array.isArray(raw.result.skipped) ||
        !(raw.result.error === null || typeof raw.result.error === 'string') ||
        (raw.result.error === null &&
          (!raw.result.result ||
            !Array.isArray(raw.result.result.points) ||
            !raw.result.current ||
            !raw.result.value))
      ) {
        fail('Invalid frontier worker response. Retry the computation.')
        return
      }
      close()
      onResult(raw.result)
    }
    worker.postMessage({ generation, identity, deal: structuredClone(deal) })
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : 'Frontier worker could not start. Retry the computation.',
    )
  }
  return close
}
