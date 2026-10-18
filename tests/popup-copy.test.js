import { describe, it, expect } from 'vitest';
import { sessionCopy, friendlyError } from '../src/shared/ui-copy.js';

describe('popup presentation', () => {
  it('turns internal phases into short user-facing copy', () => {
    expect(sessionCopy({ phase: 'waiting_for_answer', stats: { solved: 0 } })).toEqual({
      title: 'Nunggu AI', detail: 'Belum masuk.', tone: 'working',
    });
    expect(sessionCopy({ phase: 'done', stats: { solved: 3 } })).toEqual({
      title: 'Kelar', detail: '3 soal. Cek sebelum kirim.', tone: 'done',
    });
  });
  it('does not expose internal errors or identifiers to the user', () => {
    expect(friendlyError('Session changed; refresh before continuing')).toBe('Soalnya berubah. Buka lagi.');
    expect(friendlyError('TypeError: Cannot read properties of undefined')).toBe('Nggak bisa lanjut.');
  });
  it('keeps the next action relevant for login, answer and grading problems', () => {
    expect(friendlyError('Elemen AI belum siap. Periksa login atau coba kembali.')).toBe('Login dulu di tab AI.');
    expect(friendlyError('Jawaban tidak dapat diterapkan ke elemen Moodle.')).toBe('Jawaban nggak keisi.');
    expect(friendlyError('Moodle belum memberi nilai CHECK')).toBe('Nilai belum keluar.');
  });
  it('explains image problems instead of a generic failure', () => {
    expect(friendlyError('Gambar soal tidak dapat dibaca: Gambar soal gagal dimuat (403).')).toBe('Gambar soal nggak kebaca.');
    expect(friendlyError('Gambar soal gagal dilampirkan ke tab AI. Coba AI lain.')).toBe('Gambar nggak masuk ke AI. Coba AI lain.');
  });
});

describe('popup copy for provider failures', () => {
  it('names the step that failed instead of a generic error', () => {
    expect(friendlyError('Prompt tidak masuk dengan lengkap. Pengiriman dihentikan.')).toBe('Soal nggak masuk ke AI.');
    expect(friendlyError('Tab AI ditutup sebelum selesai.')).toBe('Tab AI ketutup.');
    expect(friendlyError('Jawaban AI tidak valid.')).toBe('Jawaban AI nggak kebaca.');
  });
});
