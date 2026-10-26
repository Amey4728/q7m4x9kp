// Typed fetch client. Request params and response bodies come from the generated OpenAPI types,
// so a backend contract change surfaces as a TypeScript error here (and CI checks the types are fresh).
import type { components, paths } from './schema'

type Schemas = components['schemas']
export type Meta = Schemas['Meta']
export type Decision = Schemas['Decision']
export type Accuracy = Schemas['Accuracy']
export type Explorer = Schemas['Explorer']
export type Evolution = Schemas['Evolution']
export type Summary = Schemas['Summary']

type GetPaths = { [P in keyof paths]: paths[P]['get'] extends never | undefined ? never : P }[keyof paths]
type Op<P extends GetPaths> = NonNullable<paths[P]['get']>
type QueryOf<P extends GetPaths> = Op<P> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never
type OkOf<P extends GetPaths> = Op<P> extends { responses: { 200: { content: { 'application/json': infer R } } } }
  ? R
  : never

/** Error in the API's single error shape, with the request id for support/log lookup. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  constructor(status: number, code: string, message: string, requestId?: string | null) {
    super(requestId ? `${message} (request ${requestId})` : message)
    this.status = status
    this.code = code
    this.requestId = requestId ?? null
  }
}

export async function apiGet<P extends GetPaths>(
  path: P,
  query?: QueryOf<P>,
  signal?: AbortSignal,
): Promise<OkOf<P>> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v != null) qs.set(k, String(v))
  const res = await fetch(`${path}${qs.size ? `?${qs}` : ''}`, { signal })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const err = body?.error
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? res.statusText, err?.request_id)
  }
  return res.json() as Promise<OkOf<P>>
}

export const exportUrl = (cutoff: string) => `/api/v1/export.csv?cutoff=${encodeURIComponent(cutoff)}`
