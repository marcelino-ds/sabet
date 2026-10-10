import { describe, it, expect } from 'vitest';
import { getRequestIdentity, isCurrentRequest, requestKey } from '../src/shared/session-guard.js';

describe('session-guard', () => {
  const state = { isBatching: true, sessionId: 's1', activeRequestId: 'r1' };

  it('menerima request yang cocok persis', () => {
    expect(isCurrentRequest(state, { sessionId: 's1', requestId: 'r1' })).toBe(true);
  });

  it('membaca identity dari payload', () => {
    expect(getRequestIdentity({ payload: { sessionId: 's1', requestId: 'r1' } })).toEqual({ sessionId: 's1', requestId: 'r1' });
    expect(isCurrentRequest(state, { payload: { sessionId: 's1', requestId: 'r1' } })).toBe(true);
  });

  it('menolak bila batching mati atau id tidak cocok', () => {
    expect(isCurrentRequest({ ...state, isBatching: false }, { sessionId: 's1', requestId: 'r1' })).toBe(false);
    expect(isCurrentRequest(state, { sessionId: 'old', requestId: 'r1' })).toBe(false);
    expect(isCurrentRequest(state, { sessionId: 's1', requestId: 'old' })).toBe(false);
  });

  it('menolak state/source tanpa identity lengkap', () => {
    expect(isCurrentRequest({ isBatching: true, sessionId: 's1' }, { sessionId: 's1', requestId: 'r1' })).toBe(false);
    expect(isCurrentRequest(state, { sessionId: 's1' })).toBe(false);
  });

  it('requestKey menggabungkan session dan request', () => {
    expect(requestKey({ sessionId: 's1', requestId: 'r1' })).toBe('s1:r1');
    expect(requestKey({ sessionId: 's1' })).toBe('');
  });

  it('menolak jawaban untuk question key yang sudah berubah', () => {
    const questionState = { ...state, activeQuestionKey: 'q1' };
    expect(isCurrentRequest(questionState, {
      sessionId: 's1', requestId: 'r1', questionKey: 'q1',
    })).toBe(true);
    expect(isCurrentRequest(questionState, {
      sessionId: 's1', requestId: 'r1', questionKey: 'q2',
    })).toBe(false);
  });

  it('membaca question key dari payload', () => {
    const questionState = { ...state, activeQuestionKey: 'q1' };
    expect(isCurrentRequest(questionState, {
      payload: { sessionId: 's1', requestId: 'r1', questionKey: 'q1' },
    })).toBe(true);
  });
});
