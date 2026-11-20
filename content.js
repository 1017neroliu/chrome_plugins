(() => {
  if (globalThis.yiyeInstalled) return;
  globalThis.yiyeInstalled = true;

  const excluded = 'script, style, noscript, template, iframe, svg, math, code, pre, kbd, samp, textarea, input, select, [hidden], [translate="no"], .notranslate';
  const mainRegion = 'main, [role="main"]';
  const articleRegion = 'article, [role="article"]';
  const secondaryRegion = 'body > header, nav, aside, footer, [role="navigation"], [role="complementary"], [role="contentinfo"], [role="banner"]';
  const applied = new Map();
  const maxPartLength = 900;
  const maxBatchLength = 1800;
  const maxBatchItems = 16;
  const maxConcurrentBatches = 3;
  const latin = /[\p{Script=Latin}]/u;
  let run = null;
  let showOriginal = false;
  let status = { phase: 'idle', done: 0, total: 0, canRestore: false };

  const groups = new Map();
  const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, dt, dd, td, th, blockquote, figcaption, div, section, article, main, body';

  function updateGroup(host) {
    const group = groups.get(host);
    if (!showOriginal || !group.nodes.size || !host.isConnected) {
      group.label.remove();
      if (!group.nodes.size) groups.delete(host);
      return;
    }
    const nodes = [...group.nodes].filter((node) => node.isConnected).sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    group.label.textContent = nodes.map((node) => applied.get(node).translation.trim()).join(' ');
    if (group.label.isConnected) return;
    if (host.matches('p, h1, h2, h3, h4, h5, h6, blockquote')) host.after(group.label);
    else host.append(group.label);
  }

  function removeEntry(node, entry) {
    applied.delete(node);
    if (!entry.host) return;
    groups.get(entry.host).nodes.delete(node);
    updateGroup(entry.host);
  }

  function setDisplayMode(enabled) {
    enabled = enabled === true;
    if (showOriginal === enabled) return;
    showOriginal = enabled;
    for (const [node, entry] of applied) {
      if (!node.isConnected || node.data !== entry.displayed) {
        removeEntry(node, entry);
        continue;
      }
      entry.displayed = showOriginal ? entry.original : entry.translation;
      node.data = entry.displayed;
    }
    for (const host of groups.keys()) updateGroup(host);
  }

  function applyTranslation(node, original, translation) {
    const host = node.parentElement?.closest(blockSelector);
    const displayed = showOriginal ? original : translation;
    applied.set(node, { original, translation, displayed, host });
    if (displayed !== original) node.data = displayed;
    if (!host) return;
    if (!groups.has(host)) {
      const label = document.createElement('div');
      label.className = 'yiye-translation';
      label.lang = 'zh-CN';
      label.translate = false;
      label.style.cssText = 'display:block !important; margin:0.25em 0 0.65em; padding-inline-start:0.55em; border-inline-start:2px solid currentColor; white-space:normal; overflow-wrap:anywhere;';
      groups.set(host, { label, nodes: new Set() });
    }
    groups.get(host).nodes.add(node);
    if (showOriginal) updateGroup(host);
  }

  function contentRoots(wholePage) {
    if (wholePage) return [document.body];
    for (const selector of [mainRegion, articleRegion]) {
      const roots = [...document.body.querySelectorAll(selector)].filter((root) =>
        !root.parentElement.closest(selector) && !root.closest(`${excluded}, ${secondaryRegion}`) &&
        (getComputedStyle(root).display === 'contents' || root.checkVisibility({ checkVisibilityCSS: true })) &&
        latin.test(root.textContent));
      if (roots.length) return roots;
    }
    return [document.body];
  }

  function collect(wholePage) {
    for (const [node, entry] of applied) {
      if (!node.isConnected || node.data !== entry.displayed) removeEntry(node, entry);
    }
    const inView = [];
    const offscreen = [];
    const { innerWidth, innerHeight } = window;
    const range = document.createRange();
    const skip = wholePage ? excluded : `${excluded}, ${secondaryRegion}`;
    for (const root of contentRoots(wholePage)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!latin.test(node.data) || applied.has(node) ||
            parent.isContentEditable || parent.closest(skip) ||
            getComputedStyle(parent).visibility !== 'visible') continue;
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        if (!rects.length) continue;
        const visibleNow = Array.prototype.some.call(rects, (rect) =>
          rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth);
        (visibleNow ? inView : offscreen).push({ node, original: node.data });
      }
    }
    return { inView, offscreen };
  }

  function split(text) {
    const pieces = [];
    while (text.length > maxPartLength) {
      const window = text.slice(0, maxPartLength);
      const boundary = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'));
      let end = boundary > maxPartLength / 2 ? boundary + 1 : window.length;
      // Never split a UTF-16 surrogate pair.
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      pieces.push(text.slice(0, end));
      text = text.slice(end);
    }
    if (text) pieces.push(text);
    return pieces.map((piece) => {
      const core = piece.trim();
      return {
        text: core,
        result: piece,
        before: piece.slice(0, piece.length - piece.trimStart().length),
        after: piece.slice(piece.trimEnd().length),
        pending: latin.test(core),
      };
    });
  }

  function* makeBatches(entries, firstVisible = false) {
    let batch = [];
    let size = 0;
    let limit = firstVisible ? 320 : maxBatchLength;
    let itemLimit = firstVisible ? 4 : maxBatchItems;
    for (const entry of entries) {
      entry.parts = split(entry.original);
      entry.remaining = entry.parts.filter((part) => part.pending).length;
      for (const part of entry.parts) {
        if (!part.pending) continue;
        if (batch.length && (batch.length === itemLimit || size + part.text.length > limit)) {
          yield batch;
          batch = [];
          size = 0;
          limit = maxBatchLength;
          itemLimit = maxBatchItems;
        }
        batch.push({ entry, part });
        size += part.text.length;
      }
    }
    if (batch.length) yield batch;
  }

  function* prioritizeBatches({ inView, offscreen }) {
    yield* makeBatches(inView, true);
    yield* makeBatches(offscreen);
  }

  function requestBatch(texts, signal, onTranslation) {
    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: 'yiye-batch' });
      function finish(response) {
        signal.removeEventListener('abort', abort);
        port.disconnect();
        resolve(response);
      }
      function abort() { finish({}); }
      signal.addEventListener('abort', abort, { once: true });
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        finish({ error: error?.message || '翻译连接中断，请重试。' });
      });
      port.onMessage.addListener((message) => {
        if (message.index === undefined) finish(message);
        else onTranslation(message.index, message.text);
      });
      try {
        port.postMessage({ texts });
      } catch {
        finish({ error: '翻译连接中断，请重试。' });
      }
    });
  }

  async function translateBatch(batch, current) {
    const byText = new Map();
    for (const item of batch) {
      if (!byText.has(item.part.text)) byText.set(item.part.text, []);
      byText.get(item.part.text).push(item);
    }
    const unique = [...byText.keys()];
    function receive(index, text) {
      if (run !== current) return;
      const source = unique[index];
      const items = byText.get(source);
      if (!items) return;
      byText.delete(source);
      for (const { entry, part } of items) {
        part.result = part.before + text + part.after;
        if (--entry.remaining > 0) continue;
        const { node, original } = entry;
        if (node.isConnected && node.data === original) {
          const translation = entry.parts.map((piece) => piece.result).join('');
          if (translation !== original) applyTranslation(node, original, translation);
        }
        status.done++;
      }
    }
    const response = await requestBatch(unique, current.controller.signal, receive);
    if (run !== current) return;
    if (response?.timedOut) {
      if (!byText.size || current.failure) return;
      if (unique.length > 1) {
        const remaining = [...byText.values()];
        const middle = Math.ceil(remaining.length / 2);
        await translateBatch(remaining.slice(0, middle).flat(), current);
        if (remaining.length > middle && run === current && !current.failure) {
          await translateBatch(remaining.slice(middle).flat(), current);
        }
        return;
      }
    }
    if (!response?.translations) throw new Error(response?.error || '未收到翻译结果。');
    response.translations.forEach((text, index) => receive(index, text));
  }

  async function processBatches(batches, current) {
    while (run === current && !current.failure) {
      try {
        const { value: batch, done } = batches.next();
        if (done) return;
        await translateBatch(batch, current);
      } catch (error) {
        current.failure ??= error;
      }
    }
  }

  async function start(wholePage) {
    const current = { controller: new AbortController() };
    run = current;
    status = { phase: 'running', done: 0, total: 0 };
    try {
      const entries = document.body ? collect(wholePage) : { inView: [], offscreen: [] };
      status.total = entries.inView.length + entries.offscreen.length;
      if (!status.total) {
        status.phase = 'empty';
        return;
      }
      const ready = await chrome.runtime.sendMessage({ type: 'yiye-prepare' });
      if (run !== current) return;
      if (!ready?.ready) throw new Error(ready?.error || '无法启动翻译服务。');

      const batches = prioritizeBatches(entries);
      await Promise.all(Array.from({ length: maxConcurrentBatches }, () => processBatches(batches, current)));
      if (run !== current) return;
      if (current.failure) throw current.failure;
      status.phase = 'done';
    } catch (error) {
      if (run === current) {
        status.phase = 'error';
        status.error = error.message;
      }
    } finally {
      if (run === current) run = null;
    }
  }

  function restore() {
    run?.controller.abort();
    run = null;
    for (const [node, { original, displayed }] of applied) {
      if (node.data === displayed) node.data = original;
    }
    applied.clear();
    for (const { label } of groups.values()) label.remove();
    groups.clear();
    status = { phase: 'restored', done: 0, total: 0 };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'yiye-start') {
      setDisplayMode(message.showOriginal);
      if (!run) void start(message.wholePage === true);
    } else if (message?.type === 'yiye-display') {
      setDisplayMode(message.showOriginal);
    } else if (message?.type === 'yiye-restore') {
      restore();
    } else if (message?.type !== 'yiye-status') {
      return;
    }
    sendResponse({ ...status, canRestore: applied.size > 0 || Boolean(run) });
  });
})();
