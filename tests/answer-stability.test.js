import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStableAnswerGate } from '../src/shared/answer-stability.js';

afterEach(() => vi.useRealTimers());

describe('answer-stability', () => {
  it('commits only after the parsed answer stays unchanged', () => {
    vi.useFakeTimers();
    const commits = [];
    const gate = createStableAnswerGate(1000, answer => commits.push(answer));

    gate.observe('draft {"jawaban":"A"}', { jawaban: 'A', index_pilihan: 1 });
    vi.advanceTimersByTime(999);
    expect(commits).toEqual([]);

    gate.observe('final {"jawaban":"B"}', { jawaban: 'B', index_pilihan: 2 });
    vi.advanceTimersByTime(999);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([{ jawaban: 'B', index_pilihan: 2 }]);
  });

  it('does not commit a candidate after cancellation', () => {
    vi.useFakeTimers();
    const commits = [];
    const gate = createStableAnswerGate(1000, answer => commits.push(answer));
    gate.observe('final', { jawaban: 'A', index_pilihan: 1 });
    gate.cancel();
    vi.advanceTimersByTime(1000);
    expect(commits).toEqual([]);
  });

  it('clears a candidate when the response changes to an unparsable draft', () => {
    vi.useFakeTimers();
    const commits = [];
    const gate = createStableAnswerGate(1000, answer => commits.push(answer));
    gate.observe('json candidate', { jawaban: 'A', index_pilihan: 1 });
    gate.observe('model is still writing', null);
    vi.advanceTimersByTime(1000);
    expect(commits).toEqual([]);
  });
});
