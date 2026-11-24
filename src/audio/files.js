// Optional recorded audio. The system works with no files at all (everything is generated), but if you
// drop a recording at one of these paths it is used instead, and every problem is reported clearly.

/** Paths are relative to the site root (public/). `music` replaces the generated music with a looping recording. */
export const AUDIO_FILES = {
  music: { url: 'audio/music.mp3', loop: true },
};

const baseUrl = () => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';

/**
 * Fetches and decodes one file. Never throws: returns { name, url, ok, status, detail, ms, buffer? }
 * where status is 'ok' | 'missing' | 'invalid' | 'timeout' | 'error'.
 */
export async function loadAudioFile(ctx, name, spec, { fetchFn = fetch, timeoutMs = 12000, base = baseUrl() } = {}) {
  const url = base.replace(/\/?$/, '/') + spec.url.replace(/^\//, '');
  const started = performance.now();
  const result = (status, detail, extra = {}) => ({ name, url, ok: status === 'ok', status, detail, ms: Math.round(performance.now() - started), ...extra });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (res.status === 404) return result('missing', `HTTP 404, no file at ${url}`);
    if (!res.ok) return result('error', `HTTP ${res.status} ${res.statusText || ''}`.trim());
    const type = res.headers.get('content-type') || '';
    // Dev servers answer unknown paths with index.html and status 200; that is a wrong path, not audio.
    if (/text\/html/i.test(type)) return result('missing', `the server returned an HTML page instead of audio (the path ${url} is wrong or the file is missing)`);
    const data = await res.arrayBuffer();
    if (data.byteLength < 256) return result('invalid', `file is only ${data.byteLength} bytes`);
    let buffer;
    try {
      buffer = await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(data, resolve, reject); // callbacks for older Safari, promise for the rest
        p?.then?.(resolve, reject);
      });
    } catch (e) {
      return result('invalid', `could not decode (${e?.name || 'unsupported or corrupt file'}); try MP3 or AAC for the widest support`);
    }
    return result('ok', `${buffer.duration.toFixed(1)} s, ${buffer.numberOfChannels} ch, ${(data.byteLength / 1024).toFixed(0)} KB`, { buffer });
  } catch (e) {
    return e?.name === 'AbortError' ? result('timeout', `no response within ${timeoutMs / 1000} s`) : result('error', e?.message || String(e));
  } finally {
    clearTimeout(timer);
  }
}
