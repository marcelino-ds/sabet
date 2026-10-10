// Shared, bounded panel for Moodle and the AI page.
export function createStatusWidget({ id, side = 'right', stop }) {
  document.getElementById(id)?.remove();
  const host = document.createElement('aside');
  host.id = id;
  host.setAttribute('aria-label', 'Sabet');
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{all:initial;position:fixed;bottom:12px;${side === 'left' ? 'left' : 'right'}:12px;z-index:2147483647;width:min(304px,calc(100vw - 24px));max-height:calc(100vh - 24px);color:#232826;font:13px/1.5 'Trebuchet MS',sans-serif}
    *{box-sizing:border-box}[hidden]{display:none!important}
    section{display:grid;grid-template-rows:auto minmax(0,1fr);max-height:calc(100vh - 24px);padding:14px;background:linear-gradient(125deg,#f5f8f1,#fdfdfa);border:1px solid #dce3d7;border-radius:14px;box-shadow:0 8px 32px #1f342c20}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;min-width:0}
    .brand{display:flex;align-items:center;gap:4px;font-size:17px;font-weight:700;letter-spacing:-.6px}
    .cut{display:inline-block;width:3px;height:14px;background:#2b7055;transform:skew(-20deg);border-radius:1px}
    button{font:inherit;font-size:12px;line-height:1.4;cursor:pointer;padding:6px 10px;border:1px solid #d9dfd4;border-radius:7px;background:#fff;color:#34473a;flex-shrink:0;min-height:31px}
    button:hover{border-color:#96b29d}button:focus-visible{outline:2px solid #2b7055;outline-offset:3px}
    button:disabled{opacity:.6;cursor:default}
    .copy{min-height:0;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain}
    p{margin:0;overflow-wrap:anywhere}p[role=status]{font-weight:600}.detail{margin-top:4px;font-size:12px;color:#6b736e}
    section[data-tone=error]{background:#fdf7f2;border-color:#ead8cc}section[data-tone=error] .detail{color:#9a4638}
    @media(max-height:220px){section{padding:10px}header{margin-bottom:5px}}
  </style>
  <section><header><span class="brand">Sabet<span class="cut" aria-hidden="true"></span></span><button type="button">Hentikan</button></header>
  <div class="copy"><p role="status" aria-live="polite"></p><p class="detail" hidden></p></div></section>`;
  const message = root.querySelector('[role="status"]');
  const detail = root.querySelector('.detail');
  const button = root.querySelector('button');
  const section = root.querySelector('section');
  let finished = false;
  let pending = false;

  button.addEventListener('click', async () => {
    if (finished) { host.remove(); return; }
    if (pending) return;
    pending = true;
    button.disabled = true;
    message.textContent = 'Berhenti...';
    detail.hidden = true;
    try { await stop(); }
    finally { pending = false; button.disabled = false; }
  });
  return {
    show({ title, detail: description = '', tone = '', finished: done = false, revive = false }) {
      if (revive && !host.isConnected) document.documentElement.appendChild(host);
      finished = done;
      section.dataset.tone = tone;
      message.textContent = title;
      detail.textContent = description;
      detail.hidden = !description;
      button.textContent = finished ? 'Tutup' : 'Hentikan';
    },
  };
}
