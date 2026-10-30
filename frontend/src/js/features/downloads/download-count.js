// Backend events can arrive before StartDownloadTask returns its ID. Hold new
// counts until their flight lands. Records remain counted until they are cleared.
export function createDownloadCounter(onChange) {
  let taskIds = new Set();
  let lastCount = null;
  const pending = new Set();
  const owners = new Map();
  const held = new Map();
  const isWaiting = () => [...pending].some((token) => !token.landed && !token.cancelled);
  const publish = (animate = false) => {
    const count = [...taskIds].filter((id) => !held.has(id)).length;
    if (count === lastCount) return;
    const increased = lastCount !== null && count > lastCount;
    lastCount = count;
    onChange(count, { animate: animate && increased });
  };
  const releaseUnowned = () => {
    if (!isWaiting()) {
      for (const [id, owner] of held) if (!owner) held.delete(id);
    }
  };
  const land = (token) => {
    token.landed = true;
    for (const id of token.ids) held.delete(id);
    if (token.finished) pending.delete(token);
    releaseUnowned();
    publish(!token.cancelled);
  };
  return {
    update(ids) {
      const previous = taskIds;
      taskIds = new Set(ids.map(String));
      for (const id of taskIds) {
        if (previous.has(id)) continue;
        const owner = owners.get(id);
        if (owner?.landed || owner?.cancelled) continue;
        if (owner || isWaiting()) held.set(id, owner || null);
      }
      for (const id of held.keys()) if (!taskIds.has(id)) held.delete(id);
      for (const id of previous) if (!taskIds.has(id)) owners.delete(id);
      publish();
    },
    begin() {
      const token = { ids: new Set(), landed: false, finished: false, cancelled: false };
      pending.add(token);
      return token;
    },
    accept(token, taskId) {
      const id = String(taskId);
      token.ids.add(id);
      owners.set(id, token);
      if (token.landed || token.cancelled) held.delete(id);
      else held.set(id, token);
      publish(token.landed && !token.cancelled);
    },
    land,
    finish(token) {
      token.finished = true;
      if (!token.ids.size) land(token);
      if (token.landed || token.cancelled) pending.delete(token);
    },
    cancel() {
      for (const token of pending) token.cancelled = true;
      pending.clear();
      held.clear();
      publish();
    },
  };
}
