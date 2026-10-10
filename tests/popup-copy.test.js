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
    expect(friendlyError('Gemini API 401: invalid key')).toBe('API key ditolak.');
  });
  it('keeps the next action relevant for login, answer and grading problems', () => {
    expect(friendlyError('Elemen AI belum siap. Periksa login atau coba kembali.')).toBe('Login dulu di tab AI.');
    expect(friendlyError('Jawaban tidak dapat diterapkan ke elemen Moodle.')).toBe('Jawaban nggak keisi.');
    expect(friendlyError('Moodle belum memberi nilai CHECK')).toBe('Nilai belum keluar.');
    expect(friendlyError('API key belum diisi. Isi key atau pilih mode tab AI.')).toBe('API key kosong. Isi di Pengaturan.');
  });
});
