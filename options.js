import { parseEndpoint, translate } from './api.js';

const form = document.querySelector('#settings');
const baseUrl = document.querySelector('#base-url');
const apiKey = document.querySelector('#api-key');
const model = document.querySelector('#model');
const toggleKey = document.querySelector('#toggle-key');
const save = document.querySelector('#save');
const test = document.querySelector('#test');
const feedback = document.querySelector('#feedback');

function show(message, state = '') {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

async function configure(testOnly) {
  const config = { baseUrl: baseUrl.value.trim(), apiKey: apiKey.value.trim(), model: model.value.trim() };
  save.disabled = test.disabled = true;
  try {
    if (!config.apiKey || !config.model) throw new Error('请输入 API Key 和模型名称。');
    const { permission } = parseEndpoint(config.baseUrl);
    if (!await chrome.permissions.request({ origins: [permission] })) {
      throw new Error('访问模型接口需要此网站的权限。');
    }
    if (testOnly) {
      show('正在测试连接…');
      const [sample] = await translate(config, ['This is a translation test.']);
      show(`连接成功。示例译文：${sample}`, 'success');
    } else {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await chrome.storage.local.set({ config });
      show('设置已保存。', 'success');
    }
  } catch (error) {
    show(error.message, 'error');
  } finally {
    save.disabled = test.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void configure(false);
});

test.addEventListener('click', () => {
  if (form.reportValidity()) void configure(true);
});

toggleKey.addEventListener('click', () => {
  const showKey = apiKey.type === 'password';
  apiKey.type = showKey ? 'text' : 'password';
  toggleKey.textContent = showKey ? '隐藏' : '显示';
});

try {
  const { config } = await chrome.storage.local.get('config');
  baseUrl.value = config?.baseUrl ?? '';
  apiKey.value = config?.apiKey ?? '';
  model.value = config?.model ?? '';
} catch (error) {
  show(error.message, 'error');
}
