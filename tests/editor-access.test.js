import { afterEach, describe, expect, it } from 'vitest';
import * as access from '../src/background/editor-access.js';
afterEach(() => { document.body.innerHTML = ''; });
describe('page-world editor access', () => {
  it('writes and reads back Ace and its submission textarea', () => {
    expect(access.editorAccess).toBeTypeOf('function');
    document.body.innerHTML = '<div class="que" id="q1"><div class="ace_editor"></div><textarea name="answer"></textarea></div>';
    let code = 'template';
    document.querySelector('.ace_editor').env = { editor: { getValue: () => code, setValue: v => { code = v; } } };
    expect(access.editorAccess({ id: 'q1', kind: 'ace', value: 'if True:\n    print(4)' }).value).toBe('if True:\n    print(4)');
    expect(document.querySelector('textarea').value).toBe('if True:\n    print(4)');
  });
  it('does not report success for a missing editor', () => {
    expect(access.editorAccess).toBeTypeOf('function');
    document.body.innerHTML = '<div class="que" id="q1"><div class="ace_editor"></div></div>';
    expect(access.editorAccess({ id: 'q1', kind: 'ace', value: 'print(4)' }).ok).toBe(false);
  });
  it('does not bypass a visible Ace editor by only filling its hidden textarea', () => {
    document.body.innerHTML = '<div class="que" id="q1"><div class="ace_editor"></div><textarea name="answer">template</textarea></div>';
    expect(access.editorAccess({ id: 'q1', kind: 'ace', value: 'print(4)' }).ok).toBe(false);
    expect(document.querySelector('textarea').value).toBe('template');
  });
});
