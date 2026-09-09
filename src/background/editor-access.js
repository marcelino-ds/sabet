// This function can be serialized by chrome.scripting into the page's MAIN world.
export function editorAccess({ id, kind = 'ace', value } = {}) {
  const question = document.getElementById(id);
  if (!question) return { ok: false, value: '' };
  const textarea = question.querySelector('textarea[name*="answer"], textarea');
  let editor = null;
  const aceElement = question.querySelector('.ace_editor');
  if (kind === 'ace') editor = aceElement?.env?.editor || aceElement?.__ace_editor || null;
  if (kind === 'essay') editor = window.tinymce?.get(textarea?.id) || null;

  const read = () => {
    try {
      if (kind === 'essay' && editor?.getContent) return editor.getContent({ format: 'text' });
      if (editor?.getValue) return String(editor.getValue());
    } catch { /* fallback */ }
    return textarea?.value || '';
  };
  if (value === undefined) return { ok: true, value: read() };

  try {
    if (kind === 'ace' && aceElement && !editor) return { ok: false, value: read() };
    if (kind === 'essay' && question.querySelector('iframe') && !editor) return { ok: false, value: read() };
    if (kind === 'essay' && editor?.setContent) {
      const div = document.createElement('div');
      div.textContent = String(value);
      editor.setContent(div.innerHTML.replace(/\n/g, '<br>'));
      editor.save();
      return { ok: read().trim() === String(value).trim(), value: read() };
    } else if (editor?.setValue) {
      editor.setValue(String(value), -1);
      editor.clearSelection?.();
    } else if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter ? setter.call(textarea, String(value)) : (textarea.value = String(value));
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    } else return { ok: false, value: read() };

    const actual = read();
    if (textarea && actual !== textarea.value) textarea.value = actual;
    return { ok: actual === String(value), value: actual };
  } catch { return { ok: false, value: read() }; }
}
