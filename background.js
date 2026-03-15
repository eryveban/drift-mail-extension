/**
 * Background Service Worker
 * 处理 API 请求代理
 */

const STORAGE_KEYS = {
  SETTINGS: 'driftMailSettings',
  MAILBOX: 'driftMailbox',
  BUTTON_VISIBLE: 'driftButtonVisible'
};

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'api') {
    handleApiRequest(request).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  
  if (request.action === 'getSettings') {
    chrome.storage.local.get(STORAGE_KEYS.SETTINGS).then(result => {
      sendResponse(result[STORAGE_KEYS.SETTINGS] || {});
    });
    return true;
  }
  
  if (request.action === 'downloadAttachment') {
    handleAttachmentDownload(request).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

// 处理 API 请求
async function handleApiRequest(request) {
  const settings = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const config = settings[STORAGE_KEYS.SETTINGS] || {};
  
  if (!config.apiBaseUrl) {
    throw new Error('未配置 API 地址');
  }
  
  const url = config.apiBaseUrl.replace(/\/$/, '') + request.endpoint;
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...request.headers
  };
  
  if (config.accessKey) {
    headers['X-Access-Key'] = config.accessKey;
  }
  
  if (request.token) {
    headers['Authorization'] = `Bearer ${request.token}`;
  }
  
  const options = {
    method: request.method || 'GET',
    headers
  };
  
  if (request.body) {
    options.body = JSON.stringify(request.body);
  }
  
  const response = await fetch(url, options);
  
  if (response.status === 204) {
    return null;
  }
  
  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errData = await response.json();
      errorMsg = errData.message || errorMsg;
    } catch (e) {}
    throw new Error(errorMsg);
  }
  
  return response.json();
}

// 处理附件下载
async function handleAttachmentDownload(request) {
  const settings = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const config = settings[STORAGE_KEYS.SETTINGS] || {};
  
  if (!config.apiBaseUrl) {
    throw new Error('未配置 API 地址');
  }
  
  const url = config.apiBaseUrl.replace(/\/$/, '') + '/api/attachments/' + request.attachmentId;
  
  const headers = {};
  if (config.accessKey) {
    headers['X-Access-Key'] = config.accessKey;
  }
  if (request.token) {
    headers['Authorization'] = `Bearer ${request.token}`;
  }
  
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status}`);
  }
  
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const mimeType = blob.type || 'application/octet-stream';
  
  return {
    url: `data:${mimeType};base64,${base64}`,
    filename: request.filename
  };
}