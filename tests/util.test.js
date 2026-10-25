import { describe, it, expect } from 'vitest';
import { escapeHtml, sleep, sameQuizPage } from '../src/shared/util.js';

describe('escapeHtml', () => {
  it('escape karakter HTML berbahaya', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"q"')).toBe('&quot;q&quot;');
    expect(escapeHtml("'s'")).toBe('&#39;s&#39;');
  });

  it('payload XSS umum dinetralkan', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('null/undefined → string kosong', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('teks biasa tidak berubah', () => {
    expect(escapeHtml('Halo dunia 123')).toBe('Halo dunia 123');
  });

  it('coerce non-string', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('sleep', () => {
  it('resolve setelah delay', async () => {
    const t0 = Date.now();
    await sleep(20);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
  });
});

describe('sameQuizPage', () => {
  const url = 'https://lms.test/mod/quiz/attempt.php?attempt=1';

  it('URL identik dianggap sama', () => {
    expect(sameQuizPage(url, url)).toBe(true);
  });

  it('param tambahan setelah submit form (graded, scrollpos) tetap halaman sama', () => {
    expect(sameQuizPage(url, url + '&graded=1&scrollpos=0')).toBe(true);
  });

  it('urutan param berbeda tetap halaman sama', () => {
    expect(sameQuizPage(url + '&cmid=5', 'https://lms.test/mod/quiz/attempt.php?cmid=5&attempt=1')).toBe(true);
  });

  it('page berbeda = halaman berbeda', () => {
    expect(sameQuizPage(url, url + '&page=1')).toBe(false);
    expect(sameQuizPage(url + '&page=1', url + '&page=2')).toBe(false);
  });

  it('page eksplisit 0 sama dengan tanpa page', () => {
    expect(sameQuizPage(url, url + '&page=0')).toBe(true);
  });

  it('attempt berbeda atau pathname berbeda = halaman berbeda', () => {
    expect(sameQuizPage(url, url.replace('attempt=1', 'attempt=2'))).toBe(false);
    expect(sameQuizPage(url, 'https://lms.test/mod/quiz/summary.php?attempt=1')).toBe(false);
  });

  it('URL tanpa param attempt dibandingkan ketat (false bila beda string)', () => {
    expect(sameQuizPage('https://lms.test/x', 'https://lms.test/x')).toBe(true);
    expect(sameQuizPage('https://lms.test/x', 'https://lms.test/y')).toBe(false);
  });

  it('null/undefined/URL rusak → false', () => {
    expect(sameQuizPage(null, url)).toBe(false);
    expect(sameQuizPage(url, undefined)).toBe(false);
    expect(sameQuizPage('bukan-url:::', url)).toBe(false);
  });
});
