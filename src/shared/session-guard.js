// Guard identitas sesi/request untuk membuang jawaban/retry lama yang datang telat.

export function getRequestIdentity(source = {}) {
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : null;
  const identity = {
    sessionId: source.sessionId ?? payload?.sessionId ?? null,
    requestId: source.requestId ?? payload?.requestId ?? null,
  };
  const questionKey = source.questionKey ?? payload?.questionKey ?? null;
  if (questionKey !== null && questionKey !== undefined) identity.questionKey = questionKey;
  return identity;
}

export function isCurrentRequest(state = {}, source = {}) {
  const { sessionId, requestId, questionKey } = getRequestIdentity(source);
  const questionMatches = !state.activeQuestionKey || state.activeQuestionKey === questionKey;
  return state.isBatching === true &&
    !!state.sessionId && !!state.activeRequestId &&
    state.sessionId === sessionId &&
    state.activeRequestId === requestId &&
    questionMatches;
}

export function requestKey(source = {}) {
  const { sessionId, requestId } = getRequestIdentity(source);
  return sessionId && requestId ? `${sessionId}:${requestId}` : '';
}
