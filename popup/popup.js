/**
 * Popup 脚本 - 点击扩展图标时显示
 * 自包含，不依赖外部模块
 */

const STORAGE_KEYS = {
  SETTINGS: 'driftMailSettings',
  MAILBOX: 'driftMailbox',
  MAILS: 'driftMails',
  BUTTON_VISIBLE: 'driftButtonVisible',
  DOMAINS_CACHE: 'driftDomainsCache',
  MAIL_CONTENT_CACHE: 'driftMailContentCache'
};

// 缓存过期时间
const CACHE_TTL = {
  DOMAINS: 60 * 60 * 1000,  // 域名缓存 1 小时
  MAIL_CONTENT: 30 * 60 * 1000  // 邮件内容缓存 30 分钟
};

class Popup {
  constructor() {
    this.view = 'main';
    this.settings = null;
    this.domains = [];
    this.selectedDomain = '';
    this.mailbox = null;
    this.mails = [];
    this.currentMail = null;
    this.autoRefresh = true;
    this.refreshTimer = null;
    this.countdownTimer = null;
    
    // 缓存
    this.domainsCache = null;
    this.mailContentCache = {};
    
    this.init();
  }
  
  async init() {
    await this.loadState();
    this.cacheElements();
    this.bindEvents();
    this.bindStorageChanges();
    this.showView('main');
    
    if (this.isConfigured()) {
      await this.loadDomains();
      if (this.mailbox) {
        // 设置邮箱名
        this.els.usernameInput.value = this.mailbox.address.split('@')[0];
        this.startCountdown();
        // 先显示缓存的邮件
        this.renderMailList();
        // 再请求最新数据
        await this.loadMails();
        if (this.autoRefresh) this.startAutoRefresh();
      }
    }
  }
  
  bindStorageChanges() {
    // 监听存储变化，自动同步
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes[STORAGE_KEYS.MAILBOX]) {
          this.mailbox = changes[STORAGE_KEYS.MAILBOX].newValue || null;
          this.onMailboxChanged();
        }
        if (changes[STORAGE_KEYS.MAILS]) {
          this.mails = changes[STORAGE_KEYS.MAILS].newValue || [];
          this.renderMailList();
        }
        if (changes[STORAGE_KEYS.SETTINGS]) {
          this.settings = changes[STORAGE_KEYS.SETTINGS].newValue || {};
        }
      }
    });
  }
  
  onMailboxChanged() {
    if (this.mailbox) {
      this.els.usernameInput.value = this.mailbox.address.split('@')[0];
      this.startCountdown();
      // 先显示缓存的邮件
      this.renderMailList();
      // 再请求最新数据
      this.loadMails();
      if (this.autoRefresh) this.startAutoRefresh();
    } else {
      this.els.usernameInput.value = '';
      this.mails = [];
      this.currentMail = null;
      this.renderMailList();
      this.stopCountdown();
      this.stopAutoRefresh();
    }
  }
  
  async loadState() {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.MAILBOX,
      STORAGE_KEYS.MAILS,
      STORAGE_KEYS.BUTTON_VISIBLE,
      STORAGE_KEYS.DOMAINS_CACHE,
      STORAGE_KEYS.MAIL_CONTENT_CACHE
    ]);
    
    this.settings = result[STORAGE_KEYS.SETTINGS] || {};
    this.mailbox = result[STORAGE_KEYS.MAILBOX] || null;
    this.mails = result[STORAGE_KEYS.MAILS] || [];
    this.isVisible = result[STORAGE_KEYS.BUTTON_VISIBLE] !== false;
    this.domainsCache = result[STORAGE_KEYS.DOMAINS_CACHE] || null;
    this.mailContentCache = result[STORAGE_KEYS.MAIL_CONTENT_CACHE] || {};
    
    // 检查过期，清除所有相关数据
    if (this.mailbox?.expiresAt && new Date(this.mailbox.expiresAt) <= new Date()) {
      this.mailbox = null;
      this.mails = [];
      this.currentMail = null;
      this.mailContentCache = {};
      await chrome.storage.local.remove([
        STORAGE_KEYS.MAILBOX,
        STORAGE_KEYS.MAILS,
        STORAGE_KEYS.MAIL_CONTENT_CACHE
      ]);
    }
  }
  
  isConfigured() {
    return this.settings?.apiBaseUrl && this.settings?.accessKey;
  }
  
  cacheElements() {
    const $ = (sel) => document.querySelector(sel);
    
    this.els = {
      // 视图
      mainView: $('#main-view'),
      settingsView: $('#settings-view'),
      detailView: $('#detail-view'),
      
      // 主视图
      notConfigured: $('#not-configured'),
      mailboxArea: $('#mailbox-area'),
      usernameInput: $('#username-input'),
      domainBtn: $('#domain-btn'),
      domainText: $('#domain-text'),
      domainDropdown: $('#domain-dropdown'),
      copyBtn: $('#copy-btn'),
      createBtn: $('#create-btn'),
      deleteBtn: $('#delete-btn'),
      extendBtn: $('#extend-btn'),
      refreshBtn: $('#refresh-btn'),
      mailCount: $('#mail-count'),
      unreadCount: $('#unread-count'),
      autoStatus: $('#auto-status'),
      timer: $('#timer'),
      mailList: $('#mail-list'),
      
      // 设置
      settingsBtn: $('#settings-btn'),
      apiUrl: $('#api-url'),
      accessKey: $('#access-key'),
      showButton: $('#show-button'),
      saveSettings: $('#save-settings'),
      cancelSettings: $('#cancel-settings'),
      
      // 详情
      backBtn: $('#back-btn'),
      downloadMailBtn: $('#download-mail-btn'),
      deleteMailBtn: $('#delete-mail-btn'),
      attachmentsArea: $('#attachments-area'),
      detailContent: $('#detail-content'),
      
      toast: $('#toast')
    };
  }
  
  bindEvents() {
    const e = this.els;
    
    // 设置按钮
    e.settingsBtn.addEventListener('click', () => this.toggleSettings());
    
    // 域名下拉
    e.domainBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      e.domainDropdown.classList.toggle('open');
    });
    
    document.addEventListener('click', () => {
      e.domainDropdown.classList.remove('open');
    });
    
    // 复制
    e.copyBtn.addEventListener('click', () => this.copyEmail());
    
    // 创建/删除
    e.createBtn.addEventListener('click', () => this.createMailbox());
    e.deleteBtn.addEventListener('click', () => this.deleteMailbox());
    
    // 延长/刷新
    e.extendBtn.addEventListener('click', () => this.extendMailbox());
    e.refreshBtn.addEventListener('click', () => this.loadMails());
    
    // 详情
    e.backBtn.addEventListener('click', () => this.showView('main'));
    e.downloadMailBtn.addEventListener('click', () => this.downloadMailSource());
    e.deleteMailBtn.addEventListener('click', () => this.deleteCurrentMail());
    
    // 设置
    e.saveSettings.addEventListener('click', () => this.saveSettingsHandler());
    e.cancelSettings.addEventListener('click', () => this.showView('main'));
  }
  
  showView(view) {
    this.view = view;
    const e = this.els;
    
    e.mainView.classList.toggle('hidden', view !== 'main');
    e.settingsView.classList.toggle('hidden', view !== 'settings');
    e.detailView.classList.toggle('hidden', view !== 'detail');
    
    if (view === 'main') {
      if (!this.isConfigured()) {
        e.notConfigured.classList.remove('hidden');
        e.mailboxArea.classList.add('hidden');
        e.mailList.classList.add('hidden');
      } else {
        e.notConfigured.classList.add('hidden');
        e.mailboxArea.classList.remove('hidden');
      }
    } else if (view === 'settings') {
      e.apiUrl.value = this.settings?.apiBaseUrl || '';
      e.accessKey.value = this.settings?.accessKey || '';
      e.showButton.checked = this.isVisible;
    }
  }
  
  toggleSettings() {
    if (this.view === 'settings') {
      this.showView('main');
    } else {
      this.showView('settings');
    }
  }
  
  async saveSettingsHandler() {
    const e = this.els;
    
    const apiBaseUrl = e.apiUrl.value.trim();
    const accessKey = e.accessKey.value.trim();
    const showButton = e.showButton.checked;
    
    if (!apiBaseUrl || !accessKey) {
      this.showToast('请填写完整配置', 'error');
      return;
    }
    
    this.settings = { apiBaseUrl, accessKey };
    this.isVisible = showButton;
    
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: this.settings,
      [STORAGE_KEYS.BUTTON_VISIBLE]: showButton
    });
    
    // 通知 content script
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'settingsUpdated',
          settings: this.settings
        }).catch(() => {});
      });
    });
    
    this.showToast('设置已保存', 'success');
    this.showView('main');
    await this.loadDomains();
  }
  
  // API 方法
  async api(endpoint, options = {}) {
    const url = this.settings.apiBaseUrl.replace(/\/$/, '') + endpoint;
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (options.auth !== false) {
      headers['X-Access-Key'] = this.settings.accessKey;
    }
    
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    
    if (res.status === 204) return null;
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    
    return res.json();
  }
  
  async loadDomains() {
    if (!this.isConfigured()) return;
    
    // 如果已有邮箱，从邮箱地址中提取域名
    const currentDomain = this.mailbox?.address?.split('@')[1];
    
    // 检查缓存是否有效
    if (this.domainsCache && Date.now() - this.domainsCache.timestamp < CACHE_TTL.DOMAINS) {
      this.domains = this.domainsCache.data || [];
      if (this.domains.length > 0) {
        // 优先使用邮箱实际的域名，否则选第一个
        this.selectedDomain = currentDomain && this.domains.some(d => d.domain === currentDomain)
          ? currentDomain
          : this.domains[0].domain;
        this.renderDomainDropdown();
        this.els.mailboxArea.classList.remove('hidden');
        this.els.notConfigured.classList.add('hidden');
      }
      return;
    }
    
    try {
      const data = await this.api('/api/domains');
      this.domains = data['hydra:member'] || [];
      
      // 缓存域名列表
      this.domainsCache = {
        data: this.domains,
        timestamp: Date.now()
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.DOMAINS_CACHE]: this.domainsCache });
      
      if (this.domains.length > 0) {
        // 优先使用邮箱实际的域名，否则选第一个
        this.selectedDomain = currentDomain && this.domains.some(d => d.domain === currentDomain)
          ? currentDomain
          : this.domains[0].domain;
        this.renderDomainDropdown();
        this.els.mailboxArea.classList.remove('hidden');
        this.els.notConfigured.classList.add('hidden');
      } else {
        this.showToast('暂无可用域名', 'error');
      }
    } catch (err) {
      this.showToast(`加载域名失败: ${err.message}`, 'error');
    }
  }
  
  renderDomainDropdown() {
    const e = this.els;
    
    e.domainDropdown.innerHTML = this.domains.map(d => `
      <div class="domain-option ${d.domain === this.selectedDomain ? 'selected' : ''}" data-domain="${d.domain}">
        ${d.domain}
      </div>
    `).join('');
    
    e.domainText.textContent = this.selectedDomain;
    
    e.domainDropdown.querySelectorAll('.domain-option').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.selectedDomain = el.dataset.domain;
        e.domainText.textContent = this.selectedDomain;
        e.domainDropdown.classList.remove('open');
        this.renderDomainDropdown();
      });
    });
  }
  
  async createMailbox() {
    const e = this.els;
    
    if (this.domains.length === 0) {
      this.showToast('暂无可用域名', 'error');
      return;
    }
    
    try {
      e.createBtn.disabled = true;
      
      // 清除旧邮箱相关数据
      if (this.mailbox) {
        try {
          await this.api(`/api/accounts/${this.mailbox.id}`, {
            method: 'DELETE',
            token: this.mailbox.token
          });
        } catch (err) {}
        // 清除旧邮箱的本地存储
        await chrome.storage.local.remove([
          STORAGE_KEYS.MAILS,
          STORAGE_KEYS.MAIL_CONTENT_CACHE
        ]);
        this.mails = [];
        this.currentMail = null;
        this.mailContentCache = {};
      }
      
      const username = e.usernameInput.value.trim();
      const currentUsername = this.mailbox?.address?.split('@')[0] || '';
      const isModified = username && username !== currentUsername;
      
      let data;
      if (isModified) {
        data = await this.api('/api/custom', {
          method: 'POST',
          body: { address: `${username}@${this.selectedDomain}` }
        });
      } else {
        data = await this.api('/api/generate', {
          method: 'POST',
          body: { domain: this.selectedDomain }
        });
      }
      
      this.mailbox = {
        id: data.id,
        address: data.address,
        token: data.token,
        expiresAt: data.expiresAt
      };
      
      await chrome.storage.local.set({ [STORAGE_KEYS.MAILBOX]: this.mailbox });
      
      const [newUsername, newDomain] = data.address.split('@');
      e.usernameInput.value = newUsername;
      this.selectedDomain = newDomain;
      this.renderDomainDropdown();
      
      this.mails = [];
      this.currentMail = null;
      this.renderMailList();
      this.startCountdown();
      if (this.autoRefresh) this.startAutoRefresh();
      
      this.showToast('邮箱创建成功', 'success');
    } catch (err) {
      this.showToast(err.message || '创建失败', 'error');
    } finally {
      e.createBtn.disabled = false;
    }
  }
  
  async deleteMailbox() {
    if (!this.mailbox) return;
    if (!confirm('确定删除此邮箱？')) return;
    
    try {
      await this.api(`/api/accounts/${this.mailbox.id}`, {
        method: 'DELETE',
        token: this.mailbox.token
      });
      
      this.mailbox = null;
      this.mails = [];
      this.currentMail = null;
      this.mailContentCache = {};
      
      await chrome.storage.local.remove([
        STORAGE_KEYS.MAILBOX,
        STORAGE_KEYS.MAILS,
        STORAGE_KEYS.MAIL_CONTENT_CACHE
      ]);
      
      this.els.usernameInput.value = '';
      this.renderMailList();
      this.stopCountdown();
      this.stopAutoRefresh();
      
      this.showToast('邮箱已删除', 'success');
    } catch (err) {
      this.showToast('删除失败', 'error');
    }
  }
  
  async extendMailbox() {
    if (!this.mailbox) return;
    
    try {
      const data = await this.api('/api/me/extend', {
        method: 'PATCH',
        token: this.mailbox.token,
        body: { minutes: 30 }
      });
      
      this.mailbox.expiresAt = data.expiresAt;
      await chrome.storage.local.set({ [STORAGE_KEYS.MAILBOX]: this.mailbox });
      
      this.showToast('已延长 30 分钟', 'success');
    } catch (err) {
      this.showToast('延长失败', 'error');
    }
  }
  
  copyEmail() {
    const username = this.els.usernameInput.value.trim();
    if (!username || !this.selectedDomain) {
      this.showToast('没有可复制的邮箱', 'error');
      return;
    }
    
    navigator.clipboard.writeText(`${username}@${this.selectedDomain}`)
      .then(() => this.showToast('已复制', 'success'))
      .catch(() => this.showToast('复制失败', 'error'));
  }
  
  async loadMails() {
    if (!this.mailbox) return;
    
    try {
      const data = await this.api('/api/messages', { token: this.mailbox.token });
      this.mails = data['hydra:member'] || [];
      // 存入 storage，其他面板可直接使用
      await chrome.storage.local.set({ [STORAGE_KEYS.MAILS]: this.mails });
      this.renderMailList();
    } catch (err) {
      console.error('加载邮件失败:', err);
    }
  }
  
  renderMailList() {
    const e = this.els;
    const unread = this.mails.filter(m => !m.seen).length;
    
    e.mailCount.textContent = `${this.mails.length} 封`;
    e.unreadCount.textContent = `${unread} 未读`;
    
    if (!this.mailbox || this.mails.length === 0) {
      e.mailList.classList.add('hidden');
      return;
    }
    
    e.mailList.classList.remove('hidden');
    
    e.mailList.innerHTML = this.mails.map(m => `
      <div class="mail-item ${m.seen ? '' : 'unread'}" data-id="${m.id}">
        <div class="mail-header">
          <span class="mail-from">${this.truncate(m.from?.name || m.from?.address || '未知', 20)}</span>
          <span class="mail-date">${this.formatTime(m.createdAt)}</span>
        </div>
        <div class="mail-subject">${this.truncate(m.subject || '(无主题)', 40)}</div>
      </div>
    `).join('');
    
    e.mailList.querySelectorAll('.mail-item').forEach(el => {
      el.addEventListener('click', () => this.showMailDetail(el.dataset.id));
    });
  }
  
  async showMailDetail(id) {
    const mail = this.mails.find(m => m.id === id);
    if (!mail) return;
    
    // 立即显示详情页和 loading 状态
    this.showView('detail');
    this.els.detailContent.innerHTML = '<div class="loading-state">加载中...</div>';
    
    try {
      // 检查缓存
      const cacheKey = `${this.mailbox.id}_${id}`;
      const cached = this.mailContentCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_TTL.MAIL_CONTENT) {
        this.currentMail = cached.data;
      } else {
        this.currentMail = await this.api(`/api/messages/${id}`, { token: this.mailbox.token });
        // 缓存邮件内容
        this.mailContentCache[cacheKey] = {
          data: this.currentMail,
          timestamp: Date.now()
        };
        // 只保留最近 20 封邮件的缓存
        const keys = Object.keys(this.mailContentCache);
        if (keys.length > 20) {
          const oldKey = keys.sort((a, b) => this.mailContentCache[a].timestamp - this.mailContentCache[b].timestamp)[0];
          delete this.mailContentCache[oldKey];
        }
        await chrome.storage.local.set({ [STORAGE_KEYS.MAIL_CONTENT_CACHE]: this.mailContentCache });
      }
      
      const e = this.els;
      
      // 渲染附件列表
      this.renderAttachments();
      
      // 优先 HTML，否则纯文本
      if (this.currentMail.html?.length > 0) {
        const htmlContent = this.currentMail.html[0];
        e.detailContent.innerHTML = `
          <div class="mail-content-wrapper">
            <iframe id="mail-iframe" sandbox="allow-scripts" style="width:600px;height:100%;border:none;transform-origin:top left;"></iframe>
          </div>
        `;
        const wrapper = e.detailContent.querySelector('.mail-content-wrapper');
        const iframe = e.detailContent.querySelector('#mail-iframe');
        
        // 计算缩放比例并应用
        const applyScale = () => {
          const wrapperWidth = wrapper.clientWidth;
          const scale = Math.min(wrapperWidth / 600, 1);
          if (scale < 1) {
            iframe.style.transform = `scale(${scale})`;
            iframe.style.width = `${600}px`;
            iframe.style.height = `${100 / scale}%`;
          }
        };
        
        applyScale();
        iframe.srcdoc = this.wrapHtmlContent(htmlContent);
      } else if (this.currentMail.text) {
        e.detailContent.innerHTML = `<pre class="text-content">${this.escapeHtml(this.currentMail.text)}</pre>`;
      } else {
        e.detailContent.innerHTML = '<div class="empty-content">无内容</div>';
      }
      
      // 标记已读
      if (!mail.seen) {
        await this.api(`/api/messages/${id}`, {
          method: 'PATCH',
          token: this.mailbox.token,
          body: { seen: true }
        });
        mail.seen = true;
        this.renderMailList();
      }
    } catch (err) {
      this.showToast('加载失败', 'error');
    }
  }
  
  renderAttachments() {
    const container = this.els.attachmentsArea;
    const attachments = this.currentMail?.attachments || [];
    
    if (attachments.length === 0) {
      container.classList.add('hidden');
      return;
    }
    
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="attachments-header">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" fill="currentColor"/>
        </svg>
        <span>附件 (${attachments.length})</span>
      </div>
      <div class="attachments-list">
        ${attachments.map(att => `
          <div class="attachment-item" data-id="${att.id}" data-filename="${this.escapeHtml(att.filename)}">
            <div class="attachment-icon">${this.getFileIcon(att.contentType)}</div>
            <div class="attachment-info">
              <div class="attachment-name" title="${this.escapeHtml(att.filename)}">${this.escapeHtml(att.filename)}</div>
              <div class="attachment-size">${this.formatSize(att.size)}</div>
            </div>
            <button class="attachment-download" title="下载">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        `).join('')}
      </div>
    `;
    
    // 绑定下载事件
    container.querySelectorAll('.attachment-download').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.attachment-item');
        this.downloadAttachment(item.dataset.id, item.dataset.filename);
      });
    });
  }
  
  async downloadAttachment(id, filename) {
    try {
      // 通过 background.js 下载
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'downloadAttachment',
          attachmentId: id,
          filename: filename,
          token: this.mailbox.token
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      // 创建下载链接
      const a = document.createElement('a');
      a.href = result.url;
      a.download = filename;
      a.click();
      
      this.showToast('下载中...', 'success');
    } catch (err) {
      this.showToast('下载失败', 'error');
    }
  }
  
  sanitizeHtml(html) {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript:/gi, '');
  }
  
  wrapHtmlContent(html) {
    // 注入基础样式
    const baseStyle = `
      <style>
        html, body {
          margin: 0;
          padding: 12px;
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 13px;
          line-height: 1.5;
          color: #333;
          overflow-x: hidden;
          height: 100%;
        }
        img { max-width: 100%; height: auto; }
        pre, code { white-space: pre-wrap; word-break: break-all; }
      </style>
    `;
    const sanitized = this.sanitizeHtml(html);
    if (/<head[^>]*>/i.test(sanitized)) {
      return sanitized.replace(/<head[^>]*>/i, '$&' + baseStyle);
    }
    if (/<html[^>]*>/i.test(sanitized)) {
      return sanitized.replace(/<html[^>]*>/i, '$&<head>' + baseStyle + '</head>');
    }
    return baseStyle + sanitized;
  }
  
  getFileIcon(contentType) {
    if (contentType.startsWith('image/')) {
      return `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" fill="currentColor"/></svg>`;
    }
    if (contentType === 'application/pdf') {
      return `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z" fill="currentColor"/></svg>`;
    }
    if (contentType.includes('zip') || contentType.includes('rar') || contentType.includes('7z')) {
      return `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H8v-2h6v2zm4-4H8v-2h10v2z" fill="currentColor"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" fill="currentColor"/></svg>`;
  }
  
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  
  downloadMailSource() {
    if (!this.currentMail) return;
    
    // 构建邮件源码
    const mail = this.currentMail;
    const lines = [];
    
    lines.push(`From: ${mail.from?.name ? `"${mail.from.name}" ` : ''}<${mail.from?.address || 'unknown'}>`);
    lines.push(`To: <${this.mailbox?.address || 'unknown'}>`);
    lines.push(`Subject: ${mail.subject || '(无主题)'}`);
    lines.push(`Date: ${mail.createdAt ? new Date(mail.createdAt).toUTCString() : ''}`);
    lines.push(`Message-ID: <${mail.id}@driftmail>`);
    lines.push('');
    lines.push(mail.text || mail.html?.join('\n') || '(无内容)');
    
    const content = lines.join('\r\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mail.subject || 'mail'}.eml`;
    a.click();
    
    URL.revokeObjectURL(url);
    this.showToast('下载中...', 'success');
  }
  
  async deleteCurrentMail() {
    if (!this.currentMail) return;
    
    try {
      await this.api(`/api/messages/${this.currentMail.id}`, {
        method: 'DELETE',
        token: this.mailbox.token
      });
      
      // 清除该邮件的缓存
      const cacheKey = `${this.mailbox.id}_${this.currentMail.id}`;
      delete this.mailContentCache[cacheKey];
      await chrome.storage.local.set({ [STORAGE_KEYS.MAIL_CONTENT_CACHE]: this.mailContentCache });
      
      this.mails = this.mails.filter(m => m.id !== this.currentMail.id);
      this.currentMail = null;
      this.renderMailList();
      this.showView('main');
      this.showToast('邮件已删除', 'success');
    } catch (err) {
      this.showToast('删除失败', 'error');
    }
  }
  
  startCountdown() {
    this.stopCountdown();
    
    const update = () => {
      if (!this.mailbox?.expiresAt) {
        this.els.timer.textContent = '--:--';
        return;
      }
      
      const diff = new Date(this.mailbox.expiresAt) - new Date();
      if (diff <= 0) {
        this.els.timer.textContent = '00:00';
        return;
      }
      
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      this.els.timer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    
    update();
    this.countdownTimer = setInterval(update, 1000);
  }
  
  stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
  
  startAutoRefresh() {
    if (!this.autoRefresh || this.refreshTimer) return;
    this.refreshTimer = setInterval(() => this.loadMails(), 10000);
    this.els.autoStatus.classList.add('active');
  }
  
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.els.autoStatus?.classList.remove('active');
  }
  
  showToast(message, type = 'info') {
    const toast = this.els.toast;
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 2000);
  }
  
  truncate(str, len) {
    return str?.length > len ? str.slice(0, len) + '...' : str || '';
  }
  
  formatTime(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  
  formatDateTime(dateStr) {
    return new Date(dateStr).toLocaleString();
  }
  
  escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

new Popup();