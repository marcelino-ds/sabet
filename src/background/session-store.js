// Persistent session ownership lives in the service worker. The store serializes
// mutations so two tabs/messages cannot spend the same retry budget twice.

const MAX_DISPATCHES = 40;
const MAX_REQUEST_FAILURES = 4;

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStats(stats) {
  const n = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
  return { solved: n(stats?.solved), correct: n(stats?.correct), failed: n(stats?.failed) };
}

function keyForTarget(target) { return `${target?.url || ''}#${target?.key || ''}`; }

function clone(value) { return value == null ? value : structuredClone(value); }

export function createSessionStore(storage) {
  let queue = Promise.resolve();
  const read = async () => clone(await storage.read());
  const write = async state => {
    const next = { ...state, revision: (state.revision || 0) + 1, updatedAt: Date.now() };
    if (['done', 'aborted', 'error'].includes(next.phase)) {
      next.payload = null;
      next.answer = null;
      next.deadline = null;
    }
    next.history = [...(state.history || []), { phase: state.phase, at: Date.now(), dispatches: state.dispatches }].slice(-60);
    await storage.write(clone(next));
    return clone(next);
  };

  const mutate = operation => {
    const task = queue.then(async () => operation(await read()));
    queue = task.catch(() => {});
    return task;
  };

  const requireSession = (state, sessionId) => {
    if (!state || state.id !== sessionId) throw new Error('Unknown session');
    return state;
  };

  const start = input => mutate(async current => {
    if (current?.id && current.id === input.sessionId) return current;
    if (current && !['done', 'aborted', 'error'].includes(current.phase)) throw new Error('Sesi masih berjalan. Hentikan sesi tersebut dahulu.');
    const now = input.now || Date.now();
    const state = {
      id: input.sessionId || id('sess'),
      tabId: input.tabId ?? null,
      url: input.url || '',
      provider: input.provider || 'gemini',
      prompt: input.prompt || '',
      transport: input.transport === 'api' ? 'api' : 'tab',
      model: input.model || '',
      phase: 'solving',
      target: null,
      requestId: null,
      questionKey: null,
      answer: null,
      beforeGrade: '',
      dispatches: 0,
      requestFailures: 0,
      checkRetries: 0,
      stats: normalizeStats(input.stats),
      completed: {},
      error: null,
      payload: null,
      deadline: null,
      navigationUrl: null,
      createdAt: now,
      updatedAt: now,
    };
    return write(state);
  });

  const event = (sessionId, type, payload = {}) => mutate(async current => {
    const state = requireSession(current, sessionId);
    if (payload.expectedRevision != null && payload.expectedRevision !== state.revision) throw new Error('Session changed; refresh before continuing');
    if (['done', 'aborted', 'error'].includes(state.phase) && type !== 'READ') throw new Error(`Session is terminal: ${state.phase}`);
    const next = { ...state, updatedAt: payload.now || Date.now() };
    if (type === 'QUESTION') {
      if (!['solving', 'navigating'].includes(state.phase)) throw new Error('Cannot change the active question');
      if (!payload.target?.key) throw new Error('Question target is required');
      if (keyForTarget(state.target) !== keyForTarget(payload.target)) {
        next.checkRetries = 0;
        next.requestFailures = 0;
        next.error = null;
      }
      next.target = clone(payload.target);
      next.questionKey = payload.target.key;
      next.answer = null;
      next.requestId = null;
      next.beforeGrade = '';
      next.navigationUrl = null;
      next.phase = 'solving';
      return write(next);
    }
    if (type === 'DISPATCH') {
      if (!['solving', 'retrying'].includes(state.phase)) throw new Error(`Cannot dispatch in phase ${state.phase}`);
      if (!state.target) throw new Error('Question target is required');
      if (state.dispatches >= MAX_DISPATCHES) return write({ ...next, phase: 'error', error: 'Batas 40 permintaan sesi tercapai.' });
      next.phase = 'waiting_for_answer';
      next.requestId = payload.requestId || id('req');
      next.dispatches += 1;
      next.payload = clone(payload.payload);
      next.target = { ...state.target, signature: payload.signature ?? state.target.signature };
      next.startedRequestId = null;
      next.providerTabId = null;
      next.deadline = Date.now() + 300000;
      return write(next);
    }
    if (type === 'PRECHECK') {
      if (!['applying', 'apply_ready'].includes(state.phase)) throw new Error('Cannot precheck now');
      return write({ ...next, phase: 'prechecking', beforeResult: payload.beforeResult || '', deadline: Date.now() + 30000 });
    }
    if (type === 'NAVIGATE') {
      if (!['solving', 'navigating'].includes(state.phase)) throw new Error('Cannot navigate now');
      return write({ ...next, phase: 'navigating', navigationUrl: payload.url, deadline: Date.now() + 30000 });
    }
    if (type === 'APPLY') {
      if (state.phase !== 'answer_ready') throw new Error(`Cannot apply in phase ${state.phase}`);
      next.phase = 'applying';
      return write(next);
    }
    if (type === 'APPLIED') {
      if (state.phase !== 'applying') throw new Error(`Cannot confirm apply in phase ${state.phase}`);
      if (payload.signature) next.target = { ...state.target, signature: payload.signature };
      next.phase = 'apply_ready';
      return write(next);
    }
    if (type === 'CHECK') {
      if (!['applying', 'apply_ready', 'prechecking'].includes(state.phase)) throw new Error(`Cannot check in phase ${state.phase}`);
      next.phase = 'checking';
      next.beforeGrade = payload.beforeGrade || '';
      next.deadline = Date.now() + 30000;
      return write(next);
    }
    if (type === 'COMPLETE') {
      if (!['applying', 'apply_ready', 'checking', 'prechecking'].includes(state.phase)) throw new Error(`Cannot complete in phase ${state.phase}`);
      const outcome = payload.outcome === 'correct' || payload.outcome === 'failed' ? payload.outcome : 'unknown';
      const stats = normalizeStats(state.stats);
      stats.solved += 1;
      if (outcome === 'correct') stats.correct += 1;
      if (outcome === 'failed') stats.failed += 1;
      next.stats = stats;
      next.completed = { ...state.completed, [keyForTarget(state.target)]: outcome };
      next.phase = payload.continue === false ? 'done' : 'navigating';
      next.answer = null;
      next.requestId = null;
      next.payload = null;
      next.deadline = null;
      next.error = null;
      return write(next);
    }
    if (type === 'RETRY') {
      if (state.phase !== 'checking') throw new Error(`Cannot retry in phase ${state.phase}`);
      if (state.checkRetries >= MAX_REQUEST_FAILURES - 1) {
        next.phase = 'error';
        next.error = payload.error || 'Check retry budget exhausted';
      } else {
        next.checkRetries += 1;
        next.phase = 'retrying';
        next.error = payload.error || null;
      }
      next.answer = null;
      next.requestId = null;
      next.deadline = null;
      return write(next);
    }
    if (type === 'ABORT') { next.phase = 'aborted'; next.error = payload.error || 'Aborted by user'; return write(next); }
    if (type === 'DONE') { next.phase = 'done'; return write(next); }
    if (type === 'FAIL') { next.phase = 'error'; next.error = payload.error || 'Session failed'; return write(next); }
    if (type === 'READ') return clone(state);
    throw new Error(`Unknown session event: ${type}`);
  });

  const normalizeIdentity = identity => ({
    sessionId: identity?.sessionId || identity?.id,
    requestId: identity?.requestId,
    questionKey: identity?.questionKey,
  });

  const answer = (identity, value) => mutate(async current => {
    const request = normalizeIdentity(identity);
    if (!current || current.phase !== 'waiting_for_answer' || current.id !== request.sessionId || current.requestId !== request.requestId || current.questionKey !== request.questionKey) return null;
    return write({ ...current, phase: 'answer_ready', answer: clone(value), deadline: null });
  });

  const failure = (identity, error) => mutate(async current => {
    const request = normalizeIdentity(identity);
    if (!current || current.phase !== 'waiting_for_answer' || current.id !== request.sessionId || current.requestId !== request.requestId || current.questionKey !== request.questionKey) return null;
    const next = { ...current, requestFailures: current.requestFailures + 1, error: error || 'Request failed', updatedAt: Date.now() };
    next.phase = next.requestFailures >= MAX_REQUEST_FAILURES ? 'error' : 'retrying';
    return write(next);
  });

  const claim = identity => mutate(async current => {
    const r = normalizeIdentity(identity);
    if (!current || current.phase !== 'waiting_for_answer' || current.id !== r.sessionId || current.requestId !== r.requestId || current.questionKey !== r.questionKey || current.startedRequestId === r.requestId) return null;
    return write({ ...current, startedRequestId: r.requestId });
  });

  const bindTab = (identity, tabId) => mutate(async current => {
    const r = normalizeIdentity(identity);
    if (!current || current.phase !== 'waiting_for_answer' || current.id !== r.sessionId || current.requestId !== r.requestId) return null;
    return write({ ...current, providerTabId: tabId });
  });

  const reclaim = identity => mutate(async current => {
    const r = normalizeIdentity(identity);
    if (!current || current.phase !== 'waiting_for_answer' || current.id !== r.sessionId || current.requestId !== r.requestId || current.questionKey !== r.questionKey) return null;
    return write({ ...current, startedRequestId: null });
  });

  return { read, start, event, answer, failure, claim, bindTab, reclaim };
}
