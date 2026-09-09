// Browser message boundary.
export function rpc(message, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Sabet tidak mendapat respons')); } }, timeoutMs);
    try {
      chrome.runtime.sendMessage(message, response => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        if (!response?.ok) return reject(new Error(response?.error || 'Respons Sabet tidak valid'));
        resolve(Object.prototype.hasOwnProperty.call(response, 'value') ? response.value : response.state ?? response);
      });
    } catch (error) { clearTimeout(timer); settled = true; reject(error); }
  });
}

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new DOMException('Aborted', 'AbortError')); return; }
    let timer;
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
    timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
