const PHASE_COPY = {
  solving: ['Baca soal', 'Lagi dibaca.', 'working'],
  waiting_for_answer: ['Nunggu AI', 'Belum masuk.', 'working'],
  answer_ready: ['Ada jawaban', 'Lagi disiapin.', 'working'],
  applying: ['Ngisi', 'Ditaruh ke soal.', 'working'],
  apply_ready: ['Mau dicek', 'Lagi disiapin.', 'working'],
  prechecking: ['Ngecek', 'Nunggu Moodle.', 'working'],
  checking: ['Ngecek', 'Nunggu nilai.', 'working'],
  retrying: ['Coba lagi', 'Lagi dibenerin.', 'working'],
  navigating: ['Lanjut', 'Pindah soal.', 'working'],
};

export function sessionCopy(session) {
  const solved = Number(session?.stats?.solved) || 0;
  if (session?.phase === 'done') return { title: 'Kelar', detail: `${solved} soal. Cek sebelum kirim.`, tone: 'done' };
  if (session?.phase === 'aborted') return { title: 'Berhenti', detail: 'Dihentikan.', tone: 'muted' };
  if (session?.phase === 'error') return { title: 'Error', detail: friendlyError(session.error), tone: 'error' };
  const [title, detail, tone] = PHASE_COPY[session?.phase] || ['Bentar', 'Lagi disiapin.', 'working'];
  return { title, detail, tone };
}

export function friendlyError(error) {
  const text = String(error || '').toLowerCase();
  if (/navigasi tidak selesai/.test(text)) return 'Halaman berikutnya nggak kebuka. Lanjutin manual.';
  if (/target soal tidak ditemukan/.test(text)) return 'Soal targetnya nggak ketemu. Refresh halaman soalnya.';
  if (/soal belum tersedia/.test(text)) return 'Soalnya belum kebuka. Tunggu atau refresh.';
  if (/buka halaman pengerjaan/.test(text)) return 'Buka halaman pengerjaan kuisnya dulu.';
  if (/gambar.*dilampirkan/.test(text)) return 'Gambar nggak masuk ke AI. Coba AI lain.';
  if (/gambar soal/.test(text)) return 'Gambar soal nggak kebaca.';
  if (/prompt tidak masuk/.test(text)) return 'Soal nggak masuk ke AI.';
  if (/tab ai ditutup/.test(text)) return 'Tab AI ketutup.';
  if (/jawaban ai tidak valid/.test(text)) return 'Jawaban AI nggak kebaca.';
  if (/elemen ai|provider.*siap|login/.test(text)) return 'Login dulu di tab AI.';
  if (/belum memberi nilai|hasil pemeriksaan/.test(text)) return 'Nilai belum keluar.';
  if (/jawaban.*(diterapkan|diisi)|jumlah jawaban|editor/.test(text)) return 'Jawaban nggak keisi.';
  if (/rate[ -]?limit|429|terlalu banyak|busy/.test(text)) return 'AI lagi penuh.';
  if (/session changed|question changed|soal berubah|jawaban diubah/.test(text)) return 'Soalnya berubah. Buka lagi.';
  if (/not found|tidak ditemukan|belum tersedia|bukan halaman|moodle/.test(text)) return 'Buka halaman soalnya dulu.';
  if (/timeout|batas waktu|tidak mendapat respons|tidak memberi jawaban/.test(text)) return 'AI belum jawab.';
  if (/empty|kosong|tidak dapat diterapkan/.test(text)) return 'Jawaban nggak keisi.';
  if (/budget|batas .*permintaan|retry/.test(text)) return 'Udah dicoba berkali-kali.';
  if (/network|fetch|sambungan|respons sabet/.test(text)) return 'Putus. Refresh dulu.';
  return 'Nggak bisa lanjut.';
}
