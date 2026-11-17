// Serialize local-file scans and coalesce invalidations that arrive while a
// scan is running. Directory intents survive ordinary refresh invalidations,
// but never a newer directory intent (including A -> B -> A).
export function createFileScanCoordinator({ getDirectory, load, apply, onState, onError, onIdle }) {
  let revision = 0;
  let directoryRevision = 0;
  let targetDirectory = "";
  let pending = null;
  let running = false;
  const callers = [];

  async function drain() {
    let result = null;
    try {
      while (pending) {
        const job = pending;
        pending = null;
        const isCurrent = () => job.revision === revision;
        try {
          const snapshot = await load(job.directory, isCurrent);
          if (!isCurrent()) continue;
          await apply(snapshot, isCurrent);
          if (!isCurrent()) continue;
          onState("ready", snapshot.files);
          result = { ...snapshot, directory: job.directory };
        } catch (error) {
          if (!isCurrent()) continue;
          targetDirectory = getDirectory();
          onState("error");
          onError(error);
          result = null;
        }
      }
    } finally {
      running = false;
      onIdle();
      const completed = callers.splice(0);
      for (const caller of completed) {
        const currentDirectoryIntent = caller.directoryChange &&
          caller.directoryRevision === directoryRevision && caller.directory === result?.directory;
        caller.resolve(caller.revision === revision || currentDirectoryIntent ? result : null);
      }
    }
  }

  return {
    request({ directory } = {}) {
      const directoryChange = directory !== undefined;
      if (directoryChange) directoryRevision++;
      targetDirectory = directory ?? (targetDirectory || getDirectory());
      if (!targetDirectory) return Promise.resolve(null);
      const currentRevision = ++revision;
      pending = { directory: targetDirectory, revision: currentRevision };
      onState("loading");
      const promise = new Promise((resolve) => callers.push({
        revision: currentRevision, directoryRevision, directory: targetDirectory, directoryChange, resolve,
      }));
      if (!running) {
        running = true;
        void drain();
      }
      return promise;
    },
  };
}
