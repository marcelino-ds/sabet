// Ambil gambar soal lintas origin. Canvas di halaman Moodle jadi "tainted" untuk
// gambar CDN/Drive/redirect S3, tapi service worker punya host permission sehingga
// bisa membaca bytes-nya langsung lalu mengembalikannya sebagai data URL.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Beberapa server (pluginfile lama, Drive) mengirim application/octet-stream.
function sniffImageType(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  return null;
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function fetchImageDataUrl(rawUrl, { fetch: fetchImpl = fetch, signal } = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('Alamat gambar soal tidak valid.'); }
  // Halaman HTTPS meng-upgrade gambar http:// otomatis; host permission hanya https.
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') throw new Error('Alamat gambar soal tidak didukung.');
  const res = await fetchImpl(url.href, { credentials: 'include', signal });
  if (!res.ok) throw new Error(`Gambar soal gagal dimuat (${res.status}).`);
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_IMAGE_BYTES) throw new Error('Gambar soal terlalu besar.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Gambar soal terlalu besar.');
  const header = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const type = header.startsWith('image/') ? header : sniffImageType(bytes);
  if (!type) throw new Error('Alamat gambar soal bukan file gambar.');
  return `data:${type};base64,${toBase64(bytes)}`;
}
