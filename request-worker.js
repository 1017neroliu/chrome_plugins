import { requestTranslations } from './api.js';

const pending = new Map();

self.onmessage = async ({ data: { id, request, texts, cancel } }) => {
  if (cancel) {
    pending.get(id)?.abort();
    return;
  }
  const controller = new AbortController();
  pending.set(id, controller);
  const publish = (result) => self.postMessage({ id, result });
  try {
    const translations = await requestTranslations(request, texts, undefined,
      (index, text) => publish({ index, text }), controller.signal);
    publish({ translations });
  } catch (error) {
    if (!controller.signal.aborted) publish({ error: error.message, timedOut: error.name === 'TimeoutError' });
  } finally {
    pending.delete(id);
  }
};
