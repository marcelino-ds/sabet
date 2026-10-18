import { afterEach, describe, expect, it } from 'vitest';
import { findQuestionImages, isDecorativeImage, isMeaningfulSize } from '../src/content/question-images.js';

afterEach(() => { document.body.innerHTML = ''; });
function que(html) {
  document.body.innerHTML = `<div class="que multichoice" id="q1"><div class="formulation">${html}</div></div>`;
  return document.querySelector('.que');
}
const labels = q => findQuestionImages(q).map(item => item.label);

describe('findQuestionImages', () => {
  it('keeps images that have not loaded yet instead of treating them as icons', () => {
    const q = que('<div class="qtext">Soal <img src="/pluginfile.php/1/diagram.png" loading="lazy"></div>');
    expect(labels(q)).toEqual(['Gambar soal']);
  });
  it('labels option images with the option number used in the prompt', () => {
    const q = que('<div class="qtext"><img src="/pluginfile.php/1/q.png"></div><div class="answer">' +
      '<div class="r0"><input type="radio" value="0"><div><img src="/pluginfile.php/1/a.png"></div></div>' +
      '<div class="r1"><input type="radio" value="1"><div><img src="/pluginfile.php/1/b.png"></div></div></div>');
    expect(labels(q)).toEqual(['Gambar soal', 'Opsi 1', 'Opsi 2']);
  });
  it('finds images outside qtext and answer, such as a drag-drop background', () => {
    const q = que('<div class="qtext">Seret label</div><div class="ddarea"><img class="dropbackground" src="/pluginfile.php/1/bg.png"></div>');
    expect(labels(q)).toEqual(['Gambar jawaban']);
  });
  it('numbers repeated labels and removes duplicate sources', () => {
    const q = que('<div class="qtext"><img src="/pluginfile.php/1/a.png"><img src="/pluginfile.php/1/b.png"><img src="/pluginfile.php/1/a.png"></div>');
    expect(labels(q)).toEqual(['Gambar soal (1)', 'Gambar soal (2)']);
  });
  it('skips Moodle theme icons, feedback and flags', () => {
    const q = que('<div class="qtext"><img src="/theme/image.php/boost/core/1/i/completion"></div>' +
      '<div class="answer"><img class="icon" src="/pluginfile.php/1/x.png"><div class="feedback"><img src="/pluginfile.php/1/f.png"></div></div>');
    expect(labels(q)).toEqual([]);
  });
});

describe('image filters', () => {
  it('judges icon names by the file name, not the host', () => {
    const img = document.createElement('img');
    img.src = 'https://pixel.example.ac.id/pluginfile.php/1/rangkaian.png';
    expect(isDecorativeImage(img)).toBe(false);
    img.src = 'https://lms.test/pluginfile.php/1/bullet.png';
    expect(isDecorativeImage(img)).toBe(true);
  });
  it('accepts wide formula images and rejects small icons', () => {
    expect(isMeaningfulSize(200, 30)).toBe(true);
    expect(isMeaningfulSize(48, 48)).toBe(false);
    expect(isMeaningfulSize(400, 10)).toBe(false);
  });
});

describe('findQuestionImages — menjodohkan', () => {
  it('labels stem images with the row number used in the prompt', () => {
    const q = que('<div class="qtext">Pasangkan</div><table class="answer">' +
      '<tr class="r0"><td class="text"><img src="/pluginfile.php/1/x.png"></td><td><select><option>A</option></select></td></tr>' +
      '<tr class="r1"><td class="text"><img src="/pluginfile.php/1/y.png"></td><td><select><option>A</option></select></td></tr></table>');
    expect(labels(q)).toEqual(['Baris 1', 'Baris 2']);
  });
});
