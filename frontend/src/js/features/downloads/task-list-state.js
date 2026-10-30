const taskIdOrder = new Intl.Collator(undefined, { numeric: true });

// Events received after a refresh started are newer than that refresh's snapshot.
export function createTaskListStore() {
  const entries = new Map();
  let revision = 0;
  let requestSequence = 0;

  return {
    beginRefresh() {
      return { request: ++requestSequence, revision };
    },
    applySnapshot(tasks, token) {
      if (token.request !== requestSequence) return false;
      const present = new Set();
      for (const task of tasks || []) {
        if (task?.id == null) continue;
        const id = String(task.id);
        present.add(id);
        const entry = entries.get(id);
        if (!entry || entry.revision <= token.revision) {
          entries.set(id, { task: { ...task, id }, revision: token.revision });
        }
      }
      for (const [id, entry] of entries) {
        if (!present.has(id) && entry.revision <= token.revision) entries.delete(id);
      }
      return true;
    },
    upsert(task) {
      if (task?.id == null) return null;
      const id = String(task.id);
      const merged = { ...entries.get(id)?.task, ...task, id };
      entries.set(id, { task: merged, revision: ++revision });
      return merged;
    },
    get(id) {
      return entries.get(String(id))?.task;
    },
    values() {
      return Array.from(entries.values(), (entry) => entry.task)
        .sort((a, b) => taskIdOrder.compare(b.id, a.id));
    },
  };
}
