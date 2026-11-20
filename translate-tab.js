export function isWebTab(tab) {
  return Number.isInteger(tab?.id) && (!tab.url || /^https?:\/\//i.test(tab.url));
}

export function hasModelConfig(config) {
  return Boolean(config?.baseUrl && config.apiKey && config.model);
}

export async function startTabTranslation(tabId) {
  const { showOriginal, wholePage } = await chrome.storage.local.get(['showOriginal', 'wholePage']);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  return chrome.tabs.sendMessage(tabId, { type: 'yiye-start', showOriginal, wholePage }, { frameId: 0 });
}
