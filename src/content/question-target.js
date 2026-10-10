// Stable identity for a Moodle question across async provider work and reloads.

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function questionText(queEl) {
  const clean = queEl?.cloneNode(true);
  clean?.querySelectorAll('.accesshide, .sr-only, .feedback, .specificfeedback, .outcome, .info, .state, .grade, .mark, textarea, .ace_editor, [contenteditable], .coderunner-test-results, .CodeRunner-test-results, .precheck-results')
    .forEach(n => n.remove());
  const body = clean?.querySelector('.qtext, .formulation')?.textContent || clean?.textContent || '';
  const options = [...(clean?.querySelectorAll('label, option') || [])].map(el => el.textContent || '').join(' ');
  const images = [...(clean?.querySelectorAll('img') || [])].map(el => el.src).join('|');
  return (body + ' ' + options + ' ' + images)
    .replace(/\s+/g, ' ')
    .trim();
}

export function getQuestionKey(queEl, index = -1) {
  if (!queEl) return '';
  if (queEl.id) return `id:${queEl.id}:text:${hashText(questionText(queEl))}`;
  const dataId = queEl.getAttribute?.('data-question-id') || queEl.getAttribute?.('data-questionid');
  if (dataId) return `data:${dataId}:text:${hashText(questionText(queEl))}`;
  return `pos:${index}:text:${hashText(questionText(queEl))}`;
}

export function findQuestionByKey(questions, key) {
  if (!key) return null;
  return [...(questions || [])].find((question, index) => getQuestionKey(question, index) === key) || null;
}

export function getQuestionInputSignature(queEl) {
  if (!queEl) return '';
  const controls = [...queEl.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea:not(.ace_text-input), select, [contenteditable="true"]')];
  return controls.map((el, index) => {
    const tag = el.tagName?.toLowerCase() || 'node';
    const type = el.getAttribute?.('type') || '';
    const value = tag === 'select'
      ? [...el.selectedOptions].map(option => option.value).join(',')
      : tag === 'input' && /radio|checkbox/i.test(type)
        ? `${el.checked ? '1' : '0'}:${el.value || ''}`
        : tag === 'textarea' || tag === 'input'
          ? el.value || ''
          : el.textContent || '';
    return `${index}:${tag}:${type}:${value}`;
  }).join('|');
}
