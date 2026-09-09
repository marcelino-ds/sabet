import { describe, it, expect } from 'vitest';
import { sessionCopy, friendlyError } from '../src/shared/ui-copy.js';

describe('popup presentation', () => {
  it('turns internal phases into short user-facing copy', () => {
    expect(sessionCopy({ phase: 'waiting_for_answer', stats: { solved: 0 } })).toEqual({
      title: 'Sedang mengerjakan', detail: 'Menunggu jawaban untuk soal ini.', tone: 'working',
    });
    expect(sessionCopy({ phase: 'done', stats: { solved: 3 } })).toEqual({
      title: 'Selesai', detail: '3 soal selesai. Periksa jawabanmu sebelum kirim.', tone: 'done',
    });
  });
  it('does not expose internal errors or identifiers to the user', () => {
    expect(friendlyError('Session changed; refresh before continuing')).toBe('Halaman kuis berubah. Buka kembali soal yang ingin dikerjakan.');
    expect(friendlyError('TypeError: Cannot read properties of undefined')).toBe('Sabet belum bisa melanjutkan. Coba lagi dari halaman kuis.');
    expect(friendlyError('Gemini API 401: invalid key')).toBe('Kunci AI tidak bisa dipakai. Periksa Pengaturan.');
  });
  it('keeps the next action relevant for login, answer and grading problems', () => {
    expect(friendlyError('Elemen AI belum siap. Periksa login atau coba kembali.')).toBe('Buka akun AI kamu dan pastikan sudah masuk.');
    expect(friendlyError('Jawaban tidak dapat diterapkan ke elemen Moodle.')).toBe('Jawaban belum bisa diisi. Periksa soal ini lalu coba lagi.');
    expect(friendlyError('Moodle belum memberi nilai CHECK')).toBe('Hasil pemeriksaan belum tersedia. Periksa jawabanmu di halaman kuis.');
    expect(friendlyError('API key belum diisi. Isi key atau pilih mode tab AI.')).toBe('Isi kunci AI di Pengaturan untuk melanjutkan.');
  });
});
