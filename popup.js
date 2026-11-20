import { hasModelConfig, isWebTab, startTabTranslation } from './translate-tab.js';

const showOriginal = document.querySelector('#show-original');
const wholePage = document.querySelector('#whole-page');
const shortcuts = document.querySelector('#shortcuts');
const translate = document.querySelector('#translate');
const restore = document.querySelector('#restore');
const progress = document.querySelector('#progress');
const feedback = document.querySelector('#status');

let tabId;
let configured = false;
let timer;

function render(status) {
  const running = status.phase === 'running';
  translate.disabled = running || !configured || showOriginal.disabled || wholePage.disabled;
  restore.disabled = !status.canRestore;
  progress.hidden = !running;
  progress.max = Math.max(1, status.total);
  progress.value = status.done;
  feedback.dataset.state = status.phase === 'error' ? 'error' : status.phase === 'done' ? 'success' : '';
  feedback.textContent = {
    idle: configured ? '' : '请先打开设置，填写模型接口。',
    running: `正在翻译 ${status.done} / ${status.total}`,
    done: `翻译完成，共处理 ${status.total} 段文本。`,
    empty: status.canRestore ? '没有新的待翻译文本。' : '当前页没有找到可翻译的英文文本。',
    restored: '已恢复原文。',
    error: status.error,
  }[status.phase];

  clearTimeout(timer);
  if (running) timer = setTimeout(refresh, 350);
}

function showError(error) {
  render({ phase: 'error', done: 0, total: 0, canRestore: !restore.disabled, error });
}

async function send(type, fields = {}) {
  return chrome.tabs.sendMessage(tabId, { type, ...fields }, { frameId: 0 });
}

async function refresh(type = 'yiye-status', fields) {
  try {
    render(await send(type, fields));
  } catch {
    render({ phase: 'idle', done: 0, total: 0 });
  }
}

shortcuts.addEventListener('click', async () => {
  try {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  } catch {
    showError('请在 Chrome 地址栏打开 chrome://extensions/shortcuts 设置快捷键。');
  }
});

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const shortcut = commands.find(({ name }) => name === 'translate-page')?.shortcut;
    if (shortcut) shortcuts.textContent = `翻译快捷键 ${shortcut}`;
  } catch {
    shortcuts.textContent = '设置翻译快捷键';
  }
}

void loadShortcut();

showOriginal.addEventListener('change', async () => {
  const enabled = showOriginal.checked;
  showOriginal.disabled = translate.disabled = true;
  try {
    await chrome.storage.local.set({ showOriginal: enabled });
  } catch (error) {
    showOriginal.checked = !enabled;
    showOriginal.disabled = false;
    showError(error.message);
    return;
  }
  showOriginal.disabled = false;
  if (tabId !== undefined) await refresh('yiye-display', { showOriginal: enabled });
});

wholePage.addEventListener('change', async () => {
  const enabled = wholePage.checked;
  wholePage.disabled = translate.disabled = true;
  try {
    await chrome.storage.local.set({ wholePage: enabled });
  } catch (error) {
    wholePage.checked = !enabled;
    wholePage.disabled = false;
    showError(error.message);
    return;
  }
  wholePage.disabled = false;
  if (tabId !== undefined) await refresh();
});

translate.addEventListener('click', async () => {
  translate.disabled = true;
  try {
    render(await startTabTranslation(tabId));
  } catch {
    showError('无法访问当前网页。请在普通网页上重试。');
  }
});

restore.addEventListener('click', async () => {
  clearTimeout(timer);
  try {
    render(await send('yiye-restore'));
  } catch {
    showError('当前页面已更改，请重新打开扩展。');
  }
});

try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await chrome.storage.local.get(['config', 'showOriginal', 'wholePage']);
  showOriginal.checked = settings.showOriginal === true;
  wholePage.checked = settings.wholePage === true;
  showOriginal.disabled = wholePage.disabled = false;
  if (!isWebTab(tab)) {
    showError('请打开一个普通的 HTTP 或 HTTPS 网页。');
  } else {
    tabId = tab.id;
    configured = hasModelConfig(settings.config);
    await refresh('yiye-display', { showOriginal: showOriginal.checked });
  }
} catch (error) {
  showError(error.message);
}
