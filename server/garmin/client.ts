// Minimal client for the Garmin Connect Personal API.
// Docs: https://developer.garmin.com/gc-developer-program/personal/personal-api/
//
// The personal key is exchanged for a 24h OAuth2 access token (no refresh tokens);
// the token is then sent as a Bearer token to https://personal.connectapi.garmin.com.

const TOKEN_URL =
  'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token'
const API_BASE = 'https://personal.connectapi.garmin.com'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class GarminApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class GarminClient {
  private token: string | null = null
  private tokenExpires = 0
  private lastRequest = 0
  private readonly apiKey: string
  /** minimum spacing between requests, ms — be a polite single user */
  private readonly spacingMs: number

  constructor(apiKey: string, spacingMs = 250) {
    this.apiKey = apiKey
    this.spacingMs = spacingMs
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpires) return this.token
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${this.apiKey}`, Accept: 'application/json' },
    })
    const text = await res.text()
    if (!res.ok) {
      throw new GarminApiError(
        res.status,
        res.status === 401 || res.status === 403
          ? 'Garmin rejected the API key (expired, deleted or mistyped?). Create a new one in Garmin Connect → Personal API Key.'
          : `Token request failed (${res.status}): ${text.slice(0, 200)}`,
      )
    }
    const token = parseToken(text)
    if (!token) throw new GarminApiError(500, `Unexpected token response: ${text.slice(0, 200)}`)
    this.token = token.value
    // Tokens live 24h; refresh a bit early.
    this.tokenExpires = Date.now() + Math.min(token.expiresInS ?? 86400, 86400) * 1000 - 10 * 60 * 1000
    return this.token
  }

  async get<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T | null> {
    const url = new URL(path, API_BASE)
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v))

    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequest + this.spacingMs - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastRequest = Date.now()

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.getToken()}`, Accept: 'application/json' },
      })
      if (res.status === 204 || res.status === 404) return null
      if (res.ok) {
        const text = await res.text()
        return text ? (JSON.parse(text) as T) : null
      }
      if (res.status === 401 && attempt === 0) {
        this.token = null // token expired or revoked — fetch a fresh one once
        continue
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const retryAfter = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt)
        continue
      }
      const body = await res.text()
      throw new GarminApiError(res.status, `GET ${url.pathname} → ${res.status}: ${body.slice(0, 200)}`)
    }
  }
}

/** Accepts the common OAuth2 shapes since Garmin only documents the request side. */
export function parseToken(text: string): { value: string; expiresInS: number | null } | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    const raw = text.trim()
    return raw && !raw.includes(' ') ? { value: raw, expiresInS: null } : null
  }
  if (typeof body === 'string') return { value: body, expiresInS: null }
  if (!body || typeof body !== 'object') return null
  const o = body as Record<string, unknown>
  const value = o.access_token ?? o.accessToken ?? o.token
  if (typeof value !== 'string') return null
  const exp = o.expires_in ?? o.expiresIn
  return { value, expiresInS: typeof exp === 'number' ? exp : null }
}
