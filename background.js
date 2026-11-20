import { prepareRequest } from './api.js';
import { hasModelConfig, isWebTab, startTabTranslation } from './translate-tab.js';

const documentPath = 'offscreen.html';
let openingDocument;

chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error);

async function ensureTranslationDocument() {
  if (!openingDocument) {
    openingDocument = (async () => {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(documentPath)],
      });
      if (contexts.length) return;
      // The document can keep its fetch worker alive past the service worker's fetch deadline.
      await chrome.offscreen.createDocument({
        url: documentPath,
        reasons: ['WORKERS'],
        justification: 'Run the model request worker for slow webpage translations.',
      });
    })().finally(() => { openingDocument = undefined; });
  }
  return openingDocument;
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'translate-page' || !isWebTab(tab)) return;
  chrome.storage.local.get('config')
    .then(({ config }) => hasModelConfig(config)
      ? startTabTranslation(tab.id)
      : chrome.runtime.openOptionsPage())
    .catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'yiye-request-config' && sender.url === chrome.runtime.getURL(documentPath)) {
    chrome.storage.local.get('config')
      .then(({ config }) => prepareRequest(config))
      .then((request) => sendResponse({ request }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type !== 'yiye-prepare' || sender.frameId !== 0 ||
      !sender.tab || !/^https?:\/\//i.test(sender.url ?? '')) return;

  ensureTranslationDocument()
    .then(() => sendResponse({ ready: true }))
    .catch(() => sendResponse({ error: '无法启动翻译服务。请重新加载扩展后重试。' }));
  return true;
});
