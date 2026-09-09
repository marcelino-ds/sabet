const PHASE_COPY = {
  solving: ['Sedang mengerjakan', 'Membaca soal yang terbuka.', 'working'],
  waiting_for_answer: ['Sedang mengerjakan', 'Menunggu jawaban untuk soal ini.', 'working'],
  answer_ready: ['Sedang mengerjakan', 'Menyiapkan jawaban.', 'working'],
  applying: ['Mengisi jawaban', 'Menaruh jawaban ke soal.', 'working'],
  apply_ready: ['Memeriksa jawaban', 'Menyiapkan pemeriksaan.', 'working'],
  prechecking: ['Memeriksa jawaban', 'Menunggu hasil pemeriksaan.', 'working'],
  checking: ['Memeriksa jawaban', 'Menunggu hasil pemeriksaan.', 'working'],
  retrying: ['Mencoba lagi', 'Memperbaiki jawaban soal ini.', 'working'],
  navigating: ['Lanjut', 'Membuka soal berikutnya.', 'working'],
};

export function sessionCopy(session) {
  const solved = Number(session?.stats?.solved) || 0;
  if (session?.phase === 'done') return { title: 'Selesai', detail: `${solved} soal selesai. Periksa jawabanmu sebelum kirim.`, tone: 'done' };
  if (session?.phase === 'aborted') return { title: 'Dihentikan', detail: 'Sesi dihentikan.', tone: 'muted' };
  if (session?.phase === 'error') return { title: 'Perlu diperiksa', detail: friendlyError(session.error), tone: 'error' };
  const [title, detail, tone] = PHASE_COPY[session?.phase] || ['Menyiapkan', 'Sebentar.', 'working'];
  return { title, detail, tone };
}

export function friendlyError(error) {
  const text = String(error || '').toLowerCase();
  if (/elemen ai|provider.*siap|login/.test(text)) return 'Buka akun AI kamu dan pastikan sudah masuk.';
  if (/api key belum|isi key|key belum/.test(text)) return 'Isi kunci AI di Pengaturan untuk melanjutkan.';
  if (/belum memberi nilai|hasil pemeriksaan/.test(text)) return 'Hasil pemeriksaan belum tersedia. Periksa jawabanmu di halaman kuis.';
  if (/jawaban.*(diterapkan|diisi)|jumlah jawaban|editor/.test(text)) return 'Jawaban belum bisa diisi. Periksa soal ini lalu coba lagi.';
  if (/api\s*(401|403)|invalid\s*(api )?key|kunci ai/.test(text)) return 'Kunci AI tidak bisa dipakai. Periksa Pengaturan.';
  if (/rate[ -]?limit|429|terlalu banyak|busy/.test(text)) return 'AI sedang sibuk. Coba lagi sebentar.';
  if (/session changed|question changed|soal berubah|jawaban diubah/.test(text)) return 'Halaman kuis berubah. Buka kembali soal yang ingin dikerjakan.';
  if (/not found|tidak ditemukan|belum tersedia|bukan halaman|moodle/.test(text)) return 'Buka halaman soal kuis Moodle terlebih dahulu.';
  if (/timeout|batas waktu|tidak mendapat respons|tidak memberi jawaban/.test(text)) return 'AI belum memberi jawaban. Coba lagi sebentar.';
  if (/empty|kosong|tidak dapat diterapkan/.test(text)) return 'Jawaban belum bisa diisi. Periksa soal ini lalu coba lagi.';
  if (/budget|batas .*permintaan|retry/.test(text)) return 'Sabet sudah mencoba beberapa kali. Periksa soal ini dulu.';
  if (/network|fetch|sambungan|respons sabet/.test(text)) return 'Sambungan terputus. Muat ulang halaman lalu coba lagi.';
  return 'Sabet belum bisa melanjutkan. Coba lagi dari halaman kuis.';
}
