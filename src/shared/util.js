// Util bersama lintas surface. Hanya fungsi yang BENAR-BENAR identik di semua tempat.
// Catatan: waitFor TIDAK di sini — versi content sadar __sabetAborted, versi injector
// tidak; menyatukannya akan mengubah perilaku.

// Escape karakter HTML untuk cegah XSS saat menyisipkan data ke innerHTML.
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Dua URL menunjuk halaman attempt kuis yang sama? Moodle menambah/mengubah
// parameter query saat submit form (page, cmid, graded, urutan param), jadi
// perbandingan string mentah salah menyebut halaman yang sama sebagai berbeda.
// Identitas halaman = pathname + attempt + page (default 0).
export function sameQuizPage(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.pathname !== ub.pathname) return false;
    const attemptA = ua.searchParams.get('attempt');
    if (!attemptA || attemptA !== ub.searchParams.get('attempt')) return false;
    return (ua.searchParams.get('page') || '0') === (ub.searchParams.get('page') || '0');
  } catch { return false; }
}
