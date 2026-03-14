/**
 * 配置管理模块
 */

// 默认配置
const DEFAULT_CONFIG = {
  apiBaseUrl: '',
  accessKey: '',
  expireMinutes: 30,
  refreshInterval: 10000
};

// 存储键名
const STORAGE_KEYS = {
  SETTINGS: 'driftMailSettings',
  MAILBOX: 'driftMailbox',
  TOKEN: 'driftToken',
  BUTTON_VISIBLE: 'driftButtonVisible',
  BUTTON_POSITION: 'driftButtonPosition'
};

/**
 * 获取设置
 */
async function getSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.SETTINGS] };
  } catch (error) {
    console.error('获取设置失败:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * 保存设置
 */
async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
    return true;
  } catch (error) {
    console.error('保存设置失败:', error);
    return false;
  }
}

/**
 * 检查是否已配置
 */
async function isConfigured() {
  const settings = await getSettings();
  return !!(settings.apiBaseUrl && settings.accessKey);
}

/**
 * 获取邮箱数据
 */
async function getMailboxData() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MAILBOX);
    return result[STORAGE_KEYS.MAILBOX] || null;
  } catch (error) {
    console.error('获取邮箱数据失败:', error);
    return null;
  }
}

/**
 * 保存邮箱数据
 */
async function saveMailboxData(data) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.MAILBOX]: data });
    return true;
  } catch (error) {
    console.error('保存邮箱数据失败:', error);
    return false;
  }
}

/**
 * 清除邮箱数据
 */
async function clearMailboxData() {
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.MAILBOX);
    return true;
  } catch (error) {
    console.error('清除邮箱数据失败:', error);
    return false;
  }
}

export {
  DEFAULT_CONFIG,
  STORAGE_KEYS,
  getSettings,
  saveSettings,
  isConfigured,
  getMailboxData,
  saveMailboxData,
  clearMailboxData
};
