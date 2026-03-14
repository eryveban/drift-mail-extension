/**
 * API 模块 - 适配 DriftMail API
 */

import { getSettings } from './config.js';

/**
 * 发送 API 请求
 */
async function request(endpoint, options = {}) {
  const settings = await getSettings();
  
  if (!settings.apiBaseUrl) {
    throw new Error('未配置 API 地址');
  }
  
  if (!settings.accessKey && options.requireAuth !== false) {
    throw new Error('未配置 Access Key');
  }
  
  const url = `${settings.apiBaseUrl}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...options.headers
  };
  
  // 添加 Access Key
  if (settings.accessKey && options.requireAuth !== false) {
    headers['X-Access-Key'] = settings.accessKey;
  }
  
  // 添加 Token（如果提供）
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  
  const fetchOptions = {
    method: options.method || 'GET',
    headers
  };
  
  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }
  
  const response = await fetch(url, fetchOptions);
  
  // 处理 204 No Content
  if (response.status === 204) {
    return null;
  }
  
  // 处理错误响应
  if (!response.ok) {
    let errorMsg = `请求失败: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMsg = errorData.message || errorMsg;
    } catch (e) {}
    throw new Error(errorMsg);
  }
  
  // 根据响应类型返回
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  
  return response.text();
}

/**
 * 获取域名列表
 */
async function getDomains() {
  const data = await request('/api/domains');
  return data['hydra:member'] || [];
}

/**
 * 生成随机邮箱
 */
async function generateRandomEmail(domain = null) {
  const body = domain ? { domain } : {};
  return request('/api/generate', {
    method: 'POST',
    body
  });
}

/**
 * 创建自定义邮箱
 */
async function createCustomEmail(address) {
  return request('/api/custom', {
    method: 'POST',
    body: { address }
  });
}

/**
 * 获取当前账户信息
 */
async function getMe(token) {
  return request('/api/me', { token });
}

/**
 * 延长过期时间
 */
async function extendExpiry(token, minutes = 30) {
  return request('/api/me/extend', {
    method: 'PATCH',
    token,
    body: { minutes }
  });
}

/**
 * 删除账户
 */
async function deleteAccount(id, token) {
  return request(`/api/accounts/${id}`, {
    method: 'DELETE',
    token
  });
}

/**
 * 获取邮件列表
 */
async function getMessages(token) {
  const data = await request('/api/messages', { token });
  return data['hydra:member'] || [];
}

/**
 * 获取邮件详情
 */
async function getMessage(id, token) {
  return request(`/api/messages/${id}`, { token });
}

/**
 * 标记邮件已读
 */
async function markAsRead(id, token) {
  return request(`/api/messages/${id}`, {
    method: 'PATCH',
    token,
    body: { seen: true }
  });
}

/**
 * 删除邮件
 */
async function deleteMessage(id, token) {
  return request(`/api/messages/${id}`, {
    method: 'DELETE',
    token
  });
}

/**
 * 获取附件 URL
 */
function getAttachmentUrl(id, settings) {
  return `${settings.apiBaseUrl}/api/attachments/${id}`;
}

export {
  request,
  getDomains,
  generateRandomEmail,
  createCustomEmail,
  getMe,
  extendExpiry,
  deleteAccount,
  getMessages,
  getMessage,
  markAsRead,
  deleteMessage,
  getAttachmentUrl
};
