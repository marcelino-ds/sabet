// Delay committing a parsed answer until the provider response stops changing.

export function createStableAnswerGate(stableMs, onCommit) {
  let timer = null;
  let candidate = null;
  let cancelled = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const observe = (text, answer) => {
    if (cancelled) return;
    const source = String(text ?? '');
    if (!answer) {
      clear();
      candidate = null;
      return;
    }
    if (candidate?.text === source) return;
    clear();
    candidate = { text: source, answer };
    timer = setTimeout(() => {
      timer = null;
      if (cancelled || !candidate) return;
      const committed = candidate.answer;
      candidate = null;
      onCommit(committed);
    }, stableMs);
  };

  const cancel = () => {
    cancelled = true;
    candidate = null;
    clear();
  };

  return { observe, cancel };
}
