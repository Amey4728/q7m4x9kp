import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiGet } from './client'

afterEach(() => vi.unstubAllGlobals())

describe('apiGet', () => {
  it('builds the query string and returns JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await apiGet('/api/v1/decision', { decision_date: '2026-01-15', cutoff: '11:00' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/decision?decision_date=2026-01-15&cutoff=11%3A00')
  })

  it("maps the API's error shape to ApiError, keeping the request id", async () => {
    const body = { error: { code: 'validation_error', message: 'bad day', request_id: 'r1' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 422 })))
    const err = await apiGet('/api/v1/meta').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 422, code: 'validation_error', requestId: 'r1' })
    expect(err.message).toContain('r1')
  })

  it('copes with a non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502, statusText: 'Bad Gateway' })))
    await expect(apiGet('/api/v1/meta')).rejects.toMatchObject({ status: 502, code: 'http_error' })
  })
})
