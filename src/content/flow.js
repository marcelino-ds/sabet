import { makeId } from '../shared/id.js';
import { sleep } from '../shared/util.js';

const TERMINAL = new Set(['done', 'aborted', 'error']);

function sessionIdOf(state) { return state?.id || state?.sessionId; }

// The flow never performs a side effect before its phase is persisted. This makes
// a reload resume the current operation instead of starting a second one.
export async function runFlow({ session, adapter, read, event, launch, signal, status = () => {}, pause = sleep }) {
  let state = session;
  let launchedRequestId = null;
  const refresh = async () => {
    if (signal?.aborted) return null;
    const next = await read();
    if (signal?.aborted || !next || sessionIdOf(next) !== sessionIdOf(session)) { state = null; return null; }
    state = next;
    status(state);
    if (TERMINAL.has(next.phase)) return null;
    return state;
  };
  const transition = async (name, data = {}) => {
    if (signal?.aborted) return null;
    state = await event(state, name, { ...data, expectedRevision: state.revision });
    return refresh();
  };
  const target = () => adapter.resolve ? adapter.resolve(state.target) : state.target;

  try {
    await adapter.prepare?.(signal);
    if (!(await refresh())) return state;
    while (state && !TERMINAL.has(state.phase) && !signal?.aborted) {
      switch (state.phase) {
        case 'solving':
        case 'navigating': {
          const nextTarget = state.target && state.phase === 'solving'
            ? target()
            : await adapter.next(state, signal);
          if (nextTarget) {
            if (state.target && state.phase === 'solving') adapter.assertTarget(nextTarget, true, state.target);
            const snapshot = adapter.snapshot ? await adapter.snapshot(nextTarget) : nextTarget;
            if (!(await transition('QUESTION', { target: snapshot }))) return state;
            const payload = await adapter.payload(target(), state, signal);
            const signature = adapter.signature?.(target());
            if (!(await transition('DISPATCH', { requestId: makeId('req'), payload, signature }))) return state;
            launchedRequestId = state.requestId;
            await launch(state);
            await pause(0, signal);
            continue;
          }
          if (!(await transition('NAVIGATE', { url: adapter.url || '' }))) return state;
          if (await adapter.navigate(signal)) return state;
          await transition('DONE');
          return state;
        }
        case 'retrying': {
          const currentTarget = target();
          adapter.assertTarget(currentTarget, false, state.target);
          const payload = await adapter.payload(currentTarget, state, signal);
          const signature = adapter.signature?.(currentTarget);
          if (!(await transition('DISPATCH', { requestId: makeId('req'), payload, signature }))) return state;
          launchedRequestId = state.requestId;
          await launch(state);
          continue;
        }
        case 'waiting_for_answer':
          if (launchedRequestId !== state.requestId) {
            launchedRequestId = state.requestId;
            await launch(state);
          }
          await pause(500, signal);
          await refresh();
          continue;
        case 'answer_ready':
        case 'apply_ready': {
          const currentTarget = target();
          adapter.assertTarget(currentTarget, true, state.target);
          if (state.phase === 'answer_ready') {
            const answer = state.answer;
            if (!(await transition('APPLY'))) return state;
            await adapter.apply(currentTarget, answer, signal);
          }
          if (!(await refresh())) return state;
          if (adapter.persistApplied && state.phase === 'applying') {
            if (!(await transition('APPLIED', { signature: adapter.signature(currentTarget) }))) return state;
          }
          const precheck = adapter.precheckButton(currentTarget);
          if (precheck) {
            const beforeResult = adapter.resultSignature(currentTarget);
            if (!(await transition('PRECHECK', { beforeResult }))) return state;
            if (signal?.aborted) return state;
            adapter.click(precheck);
          } else {
            await checkCurrent();
          }
          continue;
        }
        case 'applying':
          throw new Error('Pengisian terputus saat reload; review jawaban manual diperlukan');
        case 'prechecking': {
          const currentTarget = target();
          adapter.assertTarget(currentTarget, false, state.target);
          if (adapter.resultSignature(currentTarget) !== state.beforeResult || Date.now() >= state.deadline) await checkCurrent();
          else { await pause(500, signal); await refresh(); }
          continue;
        }
        case 'checking': {
          const currentTarget = target();
          adapter.assertTarget(currentTarget, false, state.target);
          const grade = adapter.grade(currentTarget);
          if (grade === true) await transition('COMPLETE', { outcome: 'correct' });
          else if (grade === false && (adapter.gradeSignature(currentTarget) !== state.beforeGrade || Date.now() >= state.deadline)) {
            await transition('RETRY', { error: adapter.feedback(currentTarget) });
          } else if (Date.now() >= state.deadline) throw new Error('Moodle belum memberi nilai CHECK');
          else { await pause(500, signal); await refresh(); }
          continue;
        }
        default:
          throw new Error(`Status sesi tidak dikenal: ${state.phase}`);
      }
    }
    return state;
  } catch (error) {
    if (signal?.aborted) return state;
    const current = await read().catch(() => null);
    if (current && !TERMINAL.has(current.phase)) {
      await event(current, 'FAIL', { error: error.message, expectedRevision: current.revision }).catch(() => {});
    }
    return current || state;
  }

  async function checkCurrent() {
    const currentTarget = target();
    const button = adapter.checkButton(currentTarget);
    if (!button) {
      if (state.target.type === 'coderunner') throw new Error('CHECK CodeRunner tidak ditemukan');
      await transition('COMPLETE', { outcome: 'unknown' });
      return;
    }
    const beforeGrade = adapter.gradeSignature(currentTarget);
    if (!(await transition('CHECK', { beforeGrade }))) return;
    if (signal?.aborted) return;
    adapter.click(button);
  }
}
