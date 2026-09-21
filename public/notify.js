function byTimestamp(a, b) {
  return new Date(a.timestamp).valueOf() - new Date(b.timestamp).valueOf();
}

/**
 * Pick the messages that arrived after the last one already seen, in
 * chronological order. When nothing was seen before (a chat never opened),
 * only the single newest message is returned so the first poll cannot replay
 * history. Unknown gaps (rotated history windows) resync silently.
 */
export function selectNewMessages(messages, knownLatestId) {
  const ordered = [...(messages ?? [])].sort(byTimestamp);
  if (ordered.length === 0) return { fresh: [], latestId: knownLatestId ?? null };
  const latestId = ordered[ordered.length - 1].id ?? null;
  if (!knownLatestId) return { fresh: ordered.slice(-1), latestId };
  const index = ordered.findIndex((message) => message.id === knownLatestId);
  if (index < 0) return { fresh: [], latestId };
  return { fresh: ordered.slice(index + 1), latestId };
}
