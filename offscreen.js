const worker = new Worker('request-worker.js', { type: 'module' });
const pending = new Map();

function send(port, result) {
  try {
    port.postMessage(result);
  } catch {
    // The page may have navigated or cancelled the translation.
  }
}

worker.onmessage = ({ data: { id, result } }) => {
  const port = pending.get(id);
  if (!port) return;
  send(port, result);
  if (result.index === undefined) pending.delete(id);
};
worker.onerror = () => {
  for (const port of pending.values()) send(port, { error: '翻译服务出现错误，请重新加载扩展。' });
  pending.clear();
};

chrome.runtime.onConnect.addListener((port) => {
  const { sender } = port;
  if (port.name !== 'yiye-batch' || sender?.id !== chrome.runtime.id ||
      sender.frameId !== 0 || !sender.tab || !/^https?:\/\//i.test(sender.url ?? '')) return;

  const id = crypto.randomUUID();
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    if (pending.delete(id)) worker.postMessage({ id, cancel: true });
  });

  port.onMessage.addListener(function handleBatch({ texts }) {
    port.onMessage.removeListener(handleBatch);
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > 32 ||
        texts.some((text) => typeof text !== 'string' || !text.trim()) ||
        texts.reduce((total, text) => total + text.length, 0) > 4000) {
      send(port, { error: '翻译批次格式有误。' });
      return;
    }

    chrome.runtime.sendMessage({ type: 'yiye-request-config' })
      .then((response) => {
        if (!connected) return;
        if (!response?.request) throw new Error(response?.error || '无法读取模型设置。');
        pending.set(id, port);
        worker.postMessage({ id, request: response.request, texts });
      })
      .catch((error) => {
        pending.delete(id);
        send(port, { error: error.message });
      });
  });
});
