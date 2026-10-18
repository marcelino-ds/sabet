import { describe, expect, it } from 'vitest';
import { fetchImageDataUrl } from '../src/background/image-fetch.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const response = (bytes, type, status = 200) => ({
  ok: status < 300, status,
  headers: new Headers(type ? { 'content-type': type } : {}),
  arrayBuffer: async () => bytes.buffer,
});

describe('fetchImageDataUrl', () => {
  it('returns the bytes as a data URL and sends cookies', async () => {
    const calls = [];
    const url = await fetchImageDataUrl('https://cdn.test/a.png', { fetch: async (href, init) => { calls.push([href, init.credentials]); return response(PNG, 'image/png'); } });
    expect(url).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(calls).toEqual([['https://cdn.test/a.png', 'include']]);
  });
  it('upgrades http like the HTTPS page does', async () => {
    let requested;
    await fetchImageDataUrl('http://cdn.test/a.png', { fetch: async href => { requested = href; return response(PNG, 'image/png'); } });
    expect(requested).toBe('https://cdn.test/a.png');
  });
  it('recognises images served as octet-stream', async () => {
    const url = await fetchImageDataUrl('https://lms.test/pluginfile.php/a', { fetch: async () => response(PNG, 'application/octet-stream') });
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });
  it('rejects pages, failed requests and other schemes', async () => {
    const html = new TextEncoder().encode('<html>login</html>');
    await expect(fetchImageDataUrl('https://lms.test/login', { fetch: async () => response(html, 'text/html') })).rejects.toThrow('bukan file gambar');
    await expect(fetchImageDataUrl('https://lms.test/a.png', { fetch: async () => response(PNG, 'image/png', 404) })).rejects.toThrow('(404)');
    await expect(fetchImageDataUrl('file:///c:/a.png', { fetch: async () => response(PNG, 'image/png') })).rejects.toThrow('tidak didukung');
  });
});
