/**
 * 工具函数模块
 */

/**
 * 生成随机字符串
 */
function generateRandomString(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 格式化日期
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  const now = new Date();
  
  // 今天的邮件只显示时间
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  // 其他日期显示月/日
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * 格式化日期时间
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString();
}

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * 截断文本
 */
function truncate(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * 提取发件人名称
 */
function extractSenderName(from) {
  if (!from) return '未知发件人';
  
  // 尝试提取名称
  const match = from.match(/^"?([^"<]+)"?\s*(?:<[^>]*>)?$/);
  if (match) {
    return match[1].trim();
  }
  
  return from;
}

/**
 * 解码 HTML 实体
 */
function decodeHtmlEntities(text) {
  if (!text) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * 防抖函数
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export {
  generateRandomString,
  formatDate,
  formatDateTime,
  formatSize,
  truncate,
  extractSenderName,
  decodeHtmlEntities,
  debounce
};
