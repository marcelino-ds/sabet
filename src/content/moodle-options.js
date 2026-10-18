// Pembacaan opsi multichoice/truefalse — satu sumber kebenaran untuk extract & fill.
import { mathToTex } from './html-to-markdown.js';

// Find label text for a radio/checkbox (robust for Moodle DOM)
export function getRadioLabelText(radio, queEl) {
  // Bersihkan noise Moodle yang meracuni teks opsi (teks a11y "Correct/Incorrect",
  // nomor opsi "a.", ikon feedback, duplikasi MathJax) lalu ubah math → LaTeX.
  const cleanText = el => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'input, .accesshide, .sr-only, .answernumber, .icon, .feedback, .specificfeedback, [aria-hidden="true"]'
    ).forEach(n => n.remove());
    mathToTex(clone, { inline: true });
    // Opsi bergambar: tanpa penanda ini teksnya kosong lalu jatuh ke value ("0", "1").
    clone.querySelectorAll('img').forEach(img => {
      const alt = (img.getAttribute('alt') || '').trim();
      img.replaceWith(document.createTextNode(alt ? ` [gambar: ${alt}] ` : ' [gambar] '));
    });
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  };

  // Strategy 1: Cari parent row (wrapper) dari jawaban ini
  const row = radio.closest('.r0, .r1, .r2, .r3, .r4, .d-flex, .align-items-center, div[class*="answer"] > div');
  if (row && row.querySelectorAll('input[type="radio"], input[type="checkbox"]').length === 1) {
    const txt = cleanText(row);
    if (txt) return txt;
  }

  // Strategy 2: label[for="radio.id"]
  if (radio.id) {
    const label = queEl.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
    if (label) {
      const txt = cleanText(label);
      if (txt) return txt;
    }
  }

  // Strategy 3: Parent atau Sibling label/div
  const parentLabel = radio.closest('label');
  if (parentLabel) {
    const txt = cleanText(parentLabel);
    if (txt) return txt;
  }

  let sibling = radio.nextElementSibling;
  while (sibling) {
    if (sibling.tagName === 'LABEL' || sibling.tagName === 'DIV' || sibling.tagName === 'SPAN') {
      const txt = cleanText(sibling);
      if (txt) return txt;
    }
    sibling = sibling.nextElementSibling;
  }

  // Default fallback text kalau nge-blank
  return radio.value || '';
}

// Single source of truth untuk opsi multichoice/truefalse.
// Teks opsi diturunkan dari elemen INPUT yang SAMA yang nanti diklik saat fill.
// Ini menjamin urutan enumerasi (yang dikirim ke AI) == urutan saat klik, sehingga
// index_pilihan dari AI bisa dipercaya sebagai sinyal utama (bukan tebakan).
export function getMoodleOptions(queEl) {
  if (!queEl) return [];
  const inputs = [...queEl.querySelectorAll('input[type="radio"], input[type="checkbox"]')]
    .filter(input => input.value !== '-1');
  return inputs.map((input, index) => ({
    input,
    index,                                  // 0-based; index_pilihan AI = index + 1
    // Penanda gambar diberi nomor opsi: cocok dengan label komposit gambar dan
    // mencegah beberapa opsi bergambar punya teks identik "[gambar]".
    text: getRadioLabelText(input, queEl).replace(/\[gambar(?=[\]:])/g, `[gambar Opsi ${index + 1}`),
  }));
}

// Soal MATCH (menjodohkan): tiap baris punya teks stem + satu <select> pilihan.
// Satu sumber kebenaran untuk extract (kirim ke AI) & fill (set tiap <select>),
// sehingga urutan baris yang dilihat AI identik dengan urutan saat diisi.
export function getMatchRows(queEl) {
  if (!queEl) return [];
  const selects = [...queEl.querySelectorAll('select')];
  return selects.map((select, index) => {
    // Stem = teks baris di sebelah kiri <select>. Coba beberapa pola DOM Moodle.
    const row = select.closest('tr, .answer > div, .d-flex, p') || select.parentElement;
    let stem = '';
    if (row) {
      const clone = row.cloneNode(true);
      // Catatan: <select>.remove() adalah varian HTMLSelectElement (hapus <option> by
      // index), BUKAN ChildNode.remove(). Pakai removeChild via parent agar select &
      // option benar-benar terbuang dari clone.
      clone.querySelectorAll('select, option, .accesshide, .sr-only').forEach(n => n.parentNode?.removeChild(n));
      mathToTex(clone, { inline: true });
      // Stem bergambar: penanda ini cocok dengan label "Baris N" di gambar komposit.
      clone.querySelectorAll('img').forEach(img => {
        const alt = (img.getAttribute('alt') || '').trim();
        img.replaceWith(document.createTextNode(` [gambar Baris ${index + 1}${alt ? ': ' + alt : ''}] `));
      });
      stem = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    const options = [...select.options]
      .map(o => (o.textContent || '').trim())
      .filter(t => t && !/^(choose|pilih|\.\.\.|—)/i.test(t)); // buang placeholder
    return { select, index, row, stem, options };
  });
}
