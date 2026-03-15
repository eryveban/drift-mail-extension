import { getSettings, saveSettings, STORAGE_KEYS } from '../lib/config.js';

// DOM 元素
const apiUrlInput = document.getElementById('api-url');
const accessKeyInput = document.getElementById('access-key');
const expireMinutesInput = document.getElementById('expire-minutes');
const showFloatingBtnInput = document.getElementById('show-floating-btn');
const saveBtn = document.getElementById('save-btn');
const resetBtn = document.getElementById('reset-btn');
const backBtn = document.getElementById('back-btn');
const statusEl = document.getElementById('status');

// 加载设置
async function loadSettings() {
  const settings = await getSettings();
  
  apiUrlInput.value = settings.apiBaseUrl || '';
  accessKeyInput.value = settings.accessKey || '';
  expireMinutesInput.value = settings.expireMinutes || 30;
  
  // 加载悬浮按钮设置
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.BUTTON_VISIBLE);
    showFloatingBtnInput.checked = result[STORAGE_KEYS.BUTTON_VISIBLE] !== false;
  } catch (e) {
    showFloatingBtnInput.checked = true;
  }
}

// 保存设置
async function handleSave() {
  const apiUrl = apiUrlInput.value.trim();
  const accessKey = accessKeyInput.value.trim();
  const expireMinutes = parseInt(expireMinutesInput.value) || 30;
  
  // 验证
  if (!apiUrl) {
    showStatus('请输入 API 地址', 'error');
    return;
  }
  
  if (!accessKey) {
    showStatus('请输入 Access Key', 'error');
    return;
  }
  
  // 移除末尾斜杠
  const cleanUrl = apiUrl.replace(/\/+$/, '');
  
  // 保存设置
  const settings = {
    apiBaseUrl: cleanUrl,
    accessKey,
    expireMinutes,
    refreshInterval: 10000
  };
  
  const success = await saveSettings(settings);
  
  if (success) {
    // 保存悬浮按钮设置
    await chrome.storage.local.set({
      [STORAGE_KEYS.BUTTON_VISIBLE]: showFloatingBtnInput.checked
    });
    
    // 通知 content script 更新按钮可见性
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'updateButtonVisibility',
          visible: showFloatingBtnInput.checked
        }).catch(() => {});
      });
    });
    
    showStatus('设置已保存', 'success');
  } else {
    showStatus('保存失败', 'error');
  }
}

// 重置设置
function handleReset() {
  apiUrlInput.value = '';
  accessKeyInput.value = '';
  expireMinutesInput.value = 30;
  showFloatingBtnInput.checked = true;
  showStatus('已重置为默认值', 'success');
}

// 返回主页
function handleBack() {
  window.location.href = 'popup.html';
}

// 显示状态
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  
  setTimeout(() => {
    statusEl.className = 'status';
  }, 3000);
}

// 绑定事件
saveBtn.addEventListener('click', handleSave);
resetBtn.addEventListener('click', handleReset);
backBtn.addEventListener('click', handleBack);

// 初始化
loadSettings();
