/* Client for the app's own API (server/index.mjs). Relative URLs only: keys never reach the browser. */

export type ApiWorld = 'moon' | 'mars';

/** Cesium ion endpoint, as ion returns it (what the 3D Tiles ion auth plugin reads). */
export interface TileEndpoint {
  type: string | null;
  url: string;
  accessToken: string;
  attributions: { html: string; collapsible?: boolean }[];
  fetchedAt: string;
}

export interface AskSource {
  title: string;
  url: string | null;
}

export interface AskAnswer {
  answer: string;
  sources: AskSource[];
  grounded: boolean;
  /** link to Ginny speaking this answer (Kokoro voice on the server); it plays once */
  speechUrl?: string;
}

export type ApiErrorCode =
  | 'offline'
  | 'timeout'
  | 'invalid-question'
  | 'ask-not-configured'
  | 'too-many-questions'
  | 'ask-timeout'
  | 'ask-busy'
  | 'ask-failed'
  | 'tiles-not-configured'
  | 'tiles-unavailable'
  | 'not-found'
  | 'server-error';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode | string,
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const CLIENT_TIMEOUT_MS = 15_000; // the server gives the model 12 s

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  // caller's cancel + our timeout on one signal (no AbortSignal.any: older iPad Safari lacks it)
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, CLIENT_TIMEOUT_MS);
  const onCancel = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', onCancel, { once: true });

  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: ctrl.signal, credentials: 'same-origin' });
  } catch (e) {
    if (signal?.aborted) throw e; // the caller cancelled: let them see their own AbortError
    if (timedOut) throw new ApiError('timeout', 'That took too long. Try again.');
    throw new ApiError('offline', 'Can’t reach Ginny right now.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON: the API itself is not running behind the proxy */
  }
  if (res.ok && body) return body as T;
  const err = (body ?? {}) as { error?: string; message?: string };
  if (typeof err.error === 'string') throw new ApiError(err.error, err.message || 'Something went wrong.', res.status);
  throw new ApiError('offline', 'Can’t reach Ginny right now.', res.status);
}

/** Absolute URL of the tiles route, for the 3D Tiles ion auth plugin's authURL. */
export const tilesAuthUrl = (world: ApiWorld) => new URL(`/api/tiles/${world}`, window.location.origin).toString();

export function getTiles(world: ApiWorld, signal?: AbortSignal): Promise<TileEndpoint> {
  return request<TileEndpoint>(`/api/tiles/${world}`, {}, signal);
}

export function ask(question: string, world: ApiWorld, signal?: AbortSignal): Promise<AskAnswer> {
  return request<AskAnswer>(
    '/api/ask',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, world }) },
    signal,
  );
}

export interface ApiHealth {
  ok: boolean;
  ask: boolean;
  tiles: boolean;
}

export function getHealth(signal?: AbortSignal): Promise<ApiHealth> {
  return request<ApiHealth>('/api/health', {}, signal);
}
