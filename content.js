/**
 * Content Script - 悬浮按钮和面板
 * 通过 background.js 代理 API 请求解决 CORS 问题
 */

const STORAGE_KEYS = {
  SETTINGS: 'driftMailSettings',
  MAILBOX: 'driftMailbox',
  MAILS: 'driftMails',
  BUTTON_VISIBLE: 'driftButtonVisible',
  BUTTON_POSITION: 'driftButtonPosition',
  PANEL_POSITION: 'driftPanelPosition',
  DOMAINS_CACHE: 'driftDomainsCache',
  MAIL_CONTENT_CACHE: 'driftMailContentCache'
};

// 缓存过期时间
const CACHE_TTL = {
  DOMAINS: 60 * 60 * 1000,  // 域名缓存 1 小时
  MAIL_CONTENT: 30 * 60 * 1000  // 邮件内容缓存 30 分钟
};

class FloatingMailbox {
  constructor() {
    this.container = null;
    this.button = null;
    this.panel = null;
    this.shadow = null;
    this.isVisible = true;
    this.isDragging = false;
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
    
    // 位置和缓存
    this.buttonPosition = null;
    this.panelPosition = null;
    this.domainsCache = null;
    this.mailContentCache = {};
    
    this.init();
  }
  
  async init() {
    await this.loadState();
    if (this.isVisible) {
      this.createUI();
      this.updateBadge();
    }
    this.bindMessages();
  }
  
  async loadState() {
    try {
      const result = await chrome.storage.local.get([
        STORAGE_KEYS.BUTTON_VISIBLE,
        STORAGE_KEYS.SETTINGS,
        STORAGE_KEYS.MAILBOX,
        STORAGE_KEYS.MAILS,
        STORAGE_KEYS.BUTTON_POSITION,
        STORAGE_KEYS.PANEL_POSITION,
        STORAGE_KEYS.DOMAINS_CACHE,
        STORAGE_KEYS.MAIL_CONTENT_CACHE
      ]);
      
      this.isVisible = result[STORAGE_KEYS.BUTTON_VISIBLE] !== false;
      this.settings = result[STORAGE_KEYS.SETTINGS] || {};
      this.mailbox = result[STORAGE_KEYS.MAILBOX] || null;
      this.mails = result[STORAGE_KEYS.MAILS] || [];
      this.buttonPosition = result[STORAGE_KEYS.BUTTON_POSITION] || null;
      this.panelPosition = result[STORAGE_KEYS.PANEL_POSITION] || null;
      this.domainsCache = result[STORAGE_KEYS.DOMAINS_CACHE] || null;
      this.mailContentCache = result[STORAGE_KEYS.MAIL_CONTENT_CACHE] || {};
      
      // 检查邮箱过期，清除所有相关数据
      if (this.mailbox?.expiresAt && new Date(this.mailbox.expiresAt) <= new Date()) {
        this.mailbox = null;
        this.mails = [];
        this.currentMail = null;
        this.mailContentCache = {};
        this.panelPosition = null;
        await chrome.storage.local.remove([
          STORAGE_KEYS.MAILBOX,
          STORAGE_KEYS.MAILS,
          STORAGE_KEYS.MAIL_CONTENT_CACHE,
          STORAGE_KEYS.PANEL_POSITION
        ]);
      }
    } catch (e) {
      console.error('加载状态失败:', e);
    }
  }
  
  bindMessages() {
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
          this.updateBadge();
        }
        if (changes[STORAGE_KEYS.SETTINGS]) {
          this.settings = changes[STORAGE_KEYS.SETTINGS].newValue || {};
          if (this.isConfigured()) {
            this.loadDomains();
          }
        }
        if (changes[STORAGE_KEYS.BUTTON_VISIBLE]) {
          this.isVisible = changes[STORAGE_KEYS.BUTTON_VISIBLE].newValue !== false;
          this.updateVisibility(this.isVisible);
        }
      }
    });
  }
  
  onMailboxChanged() {
    // 更新角标（无论面板是否打开）
    this.updateBadge();
    
    if (!this.panel || this.panel.classList.contains('hidden')) return;
    
    if (this.mailbox) {
      this.$('#username-input').value = this.mailbox.address.split('@')[0];
      this.startCountdown();
      // 先显示缓存的邮件
      this.renderMailList();
      // 再请求最新数据
      this.loadMails();
      if (this.autoRefresh) this.startAutoRefresh();
    } else {
      this.$('#username-input').value = '';
      this.mails = [];
      this.currentMail = null;
      this.renderMailList();
      this.stopCountdown();
      this.stopAutoRefresh();
    }
  }
  
  isConfigured() {
    return this.settings?.apiBaseUrl && this.settings?.accessKey;
  }
  
  // 检查扩展上下文是否有效
  isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }
  
  // 通过 background.js 代理 API 请求
  async api(endpoint, options = {}) {
    if (!this.isContextValid()) {
      return Promise.reject(new Error('Extension context invalidated'));
    }
    
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'api',
        endpoint,
        method: options.method || 'GET',
        body: options.body,
        token: options.token
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
  }
  
  createUI() {
    this.container = document.createElement('div');
    this.container.id = 'temp-mail-container';
    document.body.appendChild(this.container);
    
    this.shadow = this.container.attachShadow({ mode: 'closed' });
    
    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);
    
    this.button = this.createButton();
    this.shadow.appendChild(this.button);
    
    this.panel = this.createPanel();
    this.shadow.appendChild(this.panel);
    
    this.setupButtonDrag();
    this.setupPanelDrag();
  }
  
  createButton() {
    const btn = document.createElement('div');
    btn.id = 'float-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" fill="currentColor"/>
      </svg>
      <span id="float-badge" class="badge hidden">0</span>
    `;
    btn.title = 'DriftMail';
    
    btn.addEventListener('click', () => {
      if (!this.isDragging) this.togglePanel();
    });
    
    return btn;
  }
  
  updateBadge() {
    const badge = this.shadow?.querySelector('#float-badge');
    if (!badge) return;
    
    const unreadCount = this.mails.filter(m => !m.seen).length;
    
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  
  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'float-panel';
    panel.className = 'hidden';
    
    panel.innerHTML = `
      <div class="panel-header">
        <div class="header-title">
          <svg class="logo-icon" viewBox="0 0 32 32" width="20" height="20">
            <defs>
              <linearGradient id="logo-grad-float" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#8b5cf6;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#ec4899;stop-opacity:1" />
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="16" fill="url(#logo-grad-float)"/>
            <path d="M24 10H8c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2zm0 4l-8 5-8-5v-2l8 5 8-5v2z" fill="white"/>
          </svg>
          <h1>DriftMail</h1>
        </div>
        <div class="header-actions">
          <button id="close-btn" class="icon-btn" title="关闭">×</button>
        </div>
      </div>
      
      <div class="panel-body">
        <div id="main-view" class="view">
          <div id="not-configured" class="not-configured">
            <svg viewBox="0 0 24 24" width="48" height="48">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" fill="currentColor"/>
            </svg>
            <h3>请先在扩展设置中配置 API</h3>
          </div>
          
          <div id="mailbox-area" class="mailbox-area hidden">
            <div class="input-row">
              <input type="text" id="username-input" placeholder="邮箱名" maxlength="30">
              <span class="at">@</span>
              <button id="domain-btn" class="domain-btn">
                <span id="domain-text">选择域名</span>
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d="M7 10l5 5 5-5z" fill="currentColor"/>
                </svg>
              </button>
              <button id="copy-btn" class="icon-btn-sm" title="复制">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/>
                </svg>
              </button>
              <button id="create-btn" class="icon-btn-sm" title="新建邮箱">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
                </svg>
              </button>
              <button id="delete-btn" class="icon-btn-sm danger" title="删除邮箱">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
                </svg>
              </button>
              <div id="domain-dropdown" class="domain-dropdown"></div>
            </div>
            
            <div class="stats-row">
              <div class="stats-left">
                <span id="mail-count">0 封</span>
                <span id="unread-count">0 未读</span>
                <span id="auto-status" class="auto-status">自动刷新中</span>
              </div>
              <div class="stats-right">
                <div class="timer">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" fill="currentColor"/>
                  </svg>
                  <span id="timer">30:00</span>
                </div>
                <button id="extend-btn" class="text-btn">延长</button>
                <button id="refresh-btn" class="icon-btn-sm" title="刷新">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          
          <div id="mail-list" class="mail-list hidden">
            <div class="empty-state">
              <svg viewBox="0 0 24 24" width="40" height="40">
                <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" fill="currentColor"/>
              </svg>
              <p>暂无邮件</p>
            </div>
          </div>
        </div>
        
        <div id="detail-view" class="view hidden">
          <div class="detail-header">
            <button id="back-btn" class="back-btn">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor"/>
              </svg>
              返回
            </button>
            <div class="detail-actions">
              <button id="download-mail-btn" class="icon-btn-sm" title="下载邮件源码">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
                </svg>
              </button>
              <button id="delete-mail-btn" class="icon-btn-sm danger" title="删除邮件">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>
          <div id="attachments-area" class="attachments-area hidden"></div>
          <div id="detail-content" class="detail-content"></div>
        </div>
      </div>
      
      <div id="toast" class="toast"></div>
    `;
    
    this.bindPanelEvents(panel);
    return panel;
  }
  
  bindPanelEvents(panel) {
    const $ = (sel) => panel.querySelector(sel);
    
    $('#close-btn').addEventListener('click', () => this.hidePanel());
    
    $('#domain-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#domain-dropdown').classList.toggle('open');
    });
    
    panel.addEventListener('click', () => {
      $('#domain-dropdown').classList.remove('open');
    });
    
    $('#copy-btn').addEventListener('click', () => this.copyEmail());
    $('#create-btn').addEventListener('click', () => this.createMailbox());
    $('#delete-btn').addEventListener('click', () => this.deleteMailbox());
    $('#extend-btn').addEventListener('click', () => this.extendMailbox());
    $('#refresh-btn').addEventListener('click', () => this.loadMails());
    $('#back-btn').addEventListener('click', () => this.showView('main'));
    $('#download-mail-btn').addEventListener('click', () => this.downloadMailSource());
    $('#delete-mail-btn').addEventListener('click', () => this.deleteCurrentMail());
  }
  
  async initPanel() {
    if (!this.isConfigured()) {
      this.showView('main');
      return;
    }
    
    await this.loadDomains();
    
    if (this.mailbox) {
      this.$('#username-input').value = this.mailbox.address.split('@')[0];
      this.startCountdown();
      // 先显示缓存的邮件
      this.renderMailList();
      // 再请求最新数据
      await this.loadMails();
      if (this.autoRefresh) this.startAutoRefresh();
    }
    
    this.showView('main');
  }
  
  $(sel) { return this.panel.querySelector(sel); }
  
  showView(view) {
    this.view = view;
    this.$('#main-view').classList.toggle('hidden', view !== 'main');
    this.$('#detail-view').classList.toggle('hidden', view !== 'detail');
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
        this.$('#mailbox-area').classList.remove('hidden');
        this.$('#not-configured').classList.add('hidden');
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
        this.$('#mailbox-area').classList.remove('hidden');
        this.$('#not-configured').classList.add('hidden');
      } else {
        this.showToast('暂无可用域名', 'error');
      }
    } catch (e) {
      console.error('加载域名失败:', e);
      this.showToast(`加载域名失败: ${e.message}`, 'error');
    }
  }
  
  renderDomainDropdown() {
    const dropdown = this.$('#domain-dropdown');
    
    dropdown.innerHTML = this.domains.map(d => `
      <div class="domain-option ${d.domain === this.selectedDomain ? 'selected' : ''}" data-domain="${d.domain}">
        ${d.domain}
      </div>
    `).join('');
    
    this.$('#domain-text').textContent = this.selectedDomain;
    
    dropdown.querySelectorAll('.domain-option').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedDomain = el.dataset.domain;
        this.$('#domain-text').textContent = this.selectedDomain;
        dropdown.classList.remove('open');
        this.renderDomainDropdown();
      });
    });
  }
  
  async createMailbox() {
    if (this.domains.length === 0) {
      this.showToast('暂无可用域名', 'error');
      return;
    }
    
    try {
      this.$('#create-btn').disabled = true;
      
      // 清除旧邮箱相关数据
      if (this.mailbox) {
        try {
          await this.api(`/api/accounts/${this.mailbox.id}`, {
            method: 'DELETE',
            token: this.mailbox.token
          });
        } catch (e) {}
        // 清除旧邮箱的本地存储
        await chrome.storage.local.remove([
          STORAGE_KEYS.MAILS,
          STORAGE_KEYS.MAIL_CONTENT_CACHE,
          STORAGE_KEYS.PANEL_POSITION
        ]);
        this.mails = [];
        this.currentMail = null;
        this.mailContentCache = {};
        this.panelPosition = null;
      }
      
      const username = this.$('#username-input').value.trim();
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
      this.$('#username-input').value = newUsername;
      this.selectedDomain = newDomain;
      this.renderDomainDropdown();
      
      this.mails = [];
      this.currentMail = null;
      this.renderMailList();
      this.startCountdown();
      if (this.autoRefresh) this.startAutoRefresh();
      
      this.showToast('邮箱创建成功', 'success');
    } catch (e) {
      this.showToast(e.message || '创建失败', 'error');
    } finally {
      this.$('#create-btn').disabled = false;
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
      this.panelPosition = null;
      
      await chrome.storage.local.remove([
        STORAGE_KEYS.MAILBOX,
        STORAGE_KEYS.MAILS,
        STORAGE_KEYS.MAIL_CONTENT_CACHE,
        STORAGE_KEYS.PANEL_POSITION
      ]);
      
      this.$('#username-input').value = '';
      this.renderMailList();
      this.stopCountdown();
      this.stopAutoRefresh();
      
      this.showToast('邮箱已删除', 'success');
    } catch (e) {
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
    } catch (e) {
      this.showToast('延长失败', 'error');
    }
  }
  
  copyEmail() {
    const username = this.$('#username-input').value.trim();
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
    if (!this.isContextValid()) {
      this.stopAutoRefresh();
      return;
    }
    
    try {
      const data = await this.api('/api/messages', { token: this.mailbox.token });
      this.mails = data['hydra:member'] || [];
      // 存入 storage，其他面板可直接使用
      await chrome.storage.local.set({ [STORAGE_KEYS.MAILS]: this.mails });
      this.renderMailList();
    } catch (e) {
      // 扩展上下文失效时静默处理
      if (e.message?.includes('context invalidated')) {
        this.stopAutoRefresh();
        return;
      }
      console.error('加载邮件失败:', e);
    }
  }
  
  renderMailList() {
    const unread = this.mails.filter(m => !m.seen).length;
    
    this.$('#mail-count').textContent = `${this.mails.length} 封`;
    this.$('#unread-count').textContent = `${unread} 未读`;
    
    if (!this.mailbox || this.mails.length === 0) {
      this.$('#mailbox-area').classList.remove('hidden');
      this.$('#mail-list').classList.add('hidden');
      return;
    }
    
    this.$('#mailbox-area').classList.remove('hidden');
    this.$('#mail-list').classList.remove('hidden');
    
    this.$('#mail-list').innerHTML = this.mails.map(m => `
      <div class="mail-item ${m.seen ? '' : 'unread'}" data-id="${m.id}">
        <div class="mail-header">
          <span class="mail-from">${this.truncate(m.from?.name || m.from?.address || '未知', 20)}</span>
          <span class="mail-date">${this.formatTime(m.createdAt)}</span>
        </div>
        <div class="mail-subject">${this.truncate(m.subject || '(无主题)', 40)}</div>
      </div>
    `).join('');
    
    this.$('#mail-list').querySelectorAll('.mail-item').forEach(el => {
      el.addEventListener('click', () => this.showMailDetail(el.dataset.id));
    });
    
    this.updateBadge();
  }
  
  async showMailDetail(id) {
    const mail = this.mails.find(m => m.id === id);
    if (!mail) return;
    
    // 立即显示详情页和 loading 状态
    this.showView('detail');
    const content = this.$('#detail-content');
    content.innerHTML = '<div class="loading-state">加载中...</div>';

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
      
      // 渲染附件列表
      this.renderAttachments();
      
      const content = this.$('#detail-content');
      // 优先 HTML，否则纯文本
      if (this.currentMail.html?.length > 0) {
        const htmlContent = this.currentMail.html[0];
        content.innerHTML = `
          <div class="mail-content-wrapper">
            <iframe id="mail-iframe" sandbox="allow-scripts" style="width:600px;height:100%;border:none;transform-origin:top left;"></iframe>
          </div>
        `;
        const wrapper = content.querySelector('.mail-content-wrapper');
        const iframe = content.querySelector('#mail-iframe');
        
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
        content.innerHTML = `<pre class="text-content">${this.escapeHtml(this.currentMail.text)}</pre>`;
      } else {
        content.innerHTML = '<div class="empty-content">无内容</div>';
      }
      
      if (!mail.seen) {
        await this.api(`/api/messages/${id}`, {
          method: 'PATCH',
          token: this.mailbox.token,
          body: { seen: true }
        });
        mail.seen = true;
        this.renderMailList();
      }
    } catch (e) {
      this.showToast('加载失败', 'error');
    }
  }
  
  renderAttachments() {
    const container = this.$('#attachments-area');
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
    } catch (e) {
      this.showToast('下载失败', 'error');
    }
  }
  
  sanitizeHtml(html) {
    // 基本的 HTML 清理，移除潜在危险的标签和属性
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
    // 默认文件图标
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
    } catch (e) {
      this.showToast('删除失败', 'error');
    }
  }
  
  startCountdown() {
    this.stopCountdown();
    const update = () => {
      if (!this.mailbox?.expiresAt) return;
      const diff = new Date(this.mailbox.expiresAt) - new Date();
      if (diff <= 0) {
        this.$('#timer').textContent = '00:00';
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      this.$('#timer').textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => this.loadMails(), 10000);
    this.$('#auto-status').classList.add('active');
  }
  
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.$('#auto-status')?.classList.remove('active');
  }
  
  setupButtonDrag() {
    let startY = 0, startTop = 0;
    
    // 恢复按钮位置
    if (this.buttonPosition) {
      this.button.style.top = this.buttonPosition.top + 'px';
      this.button.style.transform = '';
    }
    
    const down = (e) => {
      e.preventDefault();
      this.isDragging = false;
      
      // 先锁定当前位置（将百分比转换为固定像素）
      const rect = this.button.getBoundingClientRect();
      this.button.style.top = rect.top + 'px';
      this.button.style.transform = '';
      this.button.classList.add('dragging');
      
      startY = e.clientY;
      startTop = rect.top;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
    
    const move = (e) => {
      e.preventDefault();
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 5) this.isDragging = true;
      const newTop = Math.max(0, Math.min(startTop + dy, window.innerHeight - 36));
      this.button.style.top = newTop + 'px';
    };
    
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      this.button.classList.remove('dragging');
      this.buttonPosition = { top: this.button.getBoundingClientRect().top };
      chrome.storage.local.set({ [STORAGE_KEYS.BUTTON_POSITION]: this.buttonPosition });
      setTimeout(() => this.isDragging = false, 100);
    };
    
    this.button.addEventListener('mousedown', down);
  }
  
  setupPanelDrag() {
    const header = this.panel.querySelector('.panel-header');
    let isDragging = false, startX, startY, startLeft, startTop;
    
    // 恢复面板位置
    if (this.panelPosition) {
      this.panel.style.left = this.panelPosition.left + 'px';
      this.panel.style.top = this.panelPosition.top + 'px';
      this.panel.style.right = 'auto';
      this.panel.style.bottom = 'auto';
    }
    
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      this.panel.style.transition = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      this.panel.style.left = (startLeft + e.clientX - startX) + 'px';
      this.panel.style.top = (startTop + e.clientY - startY) + 'px';
      this.panel.style.right = 'auto';
      this.panel.style.bottom = 'auto';
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        // 保存面板位置
        const rect = this.panel.getBoundingClientRect();
        this.panelPosition = { left: rect.left, top: rect.top };
        chrome.storage.local.set({ [STORAGE_KEYS.PANEL_POSITION]: this.panelPosition });
      }
      isDragging = false;
      this.panel.style.transition = '';
    });
  }
  
  togglePanel() {
    this.panel.classList.toggle('hidden');
    if (!this.panel.classList.contains('hidden')) {
      this.initPanel();
    }
  }
  
  hidePanel() {
    this.panel.classList.add('hidden');
  }
  
  updateVisibility(visible) {
    this.isVisible = visible;
    if (this.container) {
      this.container.style.display = visible ? 'block' : 'none';
    }
  }
  
  showToast(message, type = 'info') {
    const toast = this.$('#toast');
    toast.textContent = message;
    toast.className = `toast ${type} visible`;
    setTimeout(() => toast.classList.remove('visible'), 2000);
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
  
  getStyles() {
    return `
      :host {
        --bg: #0c0c14;
        --bg-card: rgba(15, 23, 42, 0.8);
        --bg-hover: rgba(255, 255, 255, 0.05);
        --text: #f1f5f9;
        --text-muted: #94a3b8;
        --accent: #8b5cf6;
        --accent-hover: #a78bfa;
        --danger: #f43f5e;
        --success: #10b981;
        --warning: #f59e0b;
        --border: rgba(255, 255, 255, 0.08);
        --gradient: linear-gradient(135deg, #8b5cf6, #ec4899);
        --shadow: rgba(0,0,0,0.4);
        overflow: hidden;
      }
      
      * { margin: 0; padding: 0; box-sizing: border-box; }
      
      #float-btn {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 36px;
        height: 36px;
        border-radius: 50% 0 0 50%;
        background: var(--gradient);
        color: white;
        border: none;
        border-right: none;
        cursor: pointer;
        z-index: 2147483647;
        box-shadow: -4px 4px 20px rgba(139, 92, 246, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      #float-btn:hover { 
        transform: scale(1.1);
        box-shadow: -6px 6px 30px rgba(139, 92, 246, 0.5);
      }
      
      #float-btn.dragging {
        transition: none;
      }
      
      #float-btn .badge {
        position: absolute;
        top: -5px;
        left: -5px;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: linear-gradient(135deg, #f43f5e, #ec4899);
        color: white;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(244, 63, 94, 0.5);
      }
      
      #float-btn .badge.hidden { display: none; }
      
      #float-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 380px;
        height: 520px;
        background: var(--bg);
        border-radius: 16px;
        border: 1px solid var(--border);
        box-shadow: 
          0 20px 60px var(--shadow),
          0 0 0 1px rgba(255,255,255,0.05) inset;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: var(--text);
        overflow: hidden;
      }
      
      #float-panel.hidden { display: none; }
      
      .panel-header {
        padding: 14px 16px;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: move;
        user-select: none;
      }
      
      .panel-header h1 { 
        font-size: 16px; 
        font-weight: 700;
        background: var(--gradient);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .header-title { display: flex; align-items: center; gap: 8px; }
      .logo-icon { flex-shrink: 0; }
      .header-actions { display: flex; gap: 6px; }
      
      .icon-btn {
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 6px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
      
      .panel-body { flex: 1; overflow: hidden; position: relative; min-height: 0; }
      
      .view { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; }
      .view.hidden { display: none; }
      
      .not-configured {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        color: var(--text-muted);
        padding: 40px;
      }
      
      .not-configured.hidden { display: none; }
      .not-configured svg { opacity: 0.3; }
      .not-configured h3 { font-size: 16px; color: var(--text); margin-top: 8px; }
      .not-configured p { font-size: 13px; }
      
      .mailbox-area {
        padding: 16px;
        background: rgba(15, 23, 42, 0.5);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        position: relative;
        z-index: 10;
      }
      
      .mailbox-area.hidden { display: none; }
      
      .input-row {
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 6px;
        position: relative;
        transition: all 0.2s;
      }
      
      .input-row:focus-within {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
      }
      
      #username-input {
        flex: 1;
        min-width: 0;
        max-width: 120px;
        background: transparent;
        border: none;
        padding: 8px 10px;
        color: var(--text);
        font-size: 14px;
        font-family: 'SF Mono', Monaco, monospace;
        outline: none;
      }
      
      #username-input::placeholder { color: var(--text-muted); }
      .at { color: var(--text-muted); font-weight: 500; }
      
      .domain-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 7px 10px;
        color: var(--text);
        font-size: 13px;
        cursor: pointer;
        flex-shrink: 0;
        transition: all 0.2s;
      }
      
      .domain-btn:hover { 
        border-color: var(--accent); 
        background: rgba(139, 92, 246, 0.1);
      }
      
      .domain-dropdown {
        position: absolute;
        top: 100%;
        right: 40px;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(12px);
        border: 1px solid var(--border);
        border-radius: 12px;
        margin-top: 6px;
        display: none;
        z-index: 10;
        max-height: 200px;
        overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      }
      
      .domain-dropdown.open { display: block; }
      
      .domain-option { 
        padding: 10px 14px; 
        font-size: 13px; 
        cursor: pointer; 
        white-space: nowrap;
        transition: background 0.15s;
      }
      .domain-option:first-child { border-radius: 11px 11px 0 0; }
      .domain-option:last-child { border-radius: 0 0 11px 11px; }
      .domain-option:hover { background: var(--bg-hover); }
      .domain-option.selected { color: var(--accent); background: rgba(139, 92, 246, 0.15); }
      
      .icon-btn-sm {
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        display: flex;
        align-items: center;
      }
      
      .icon-btn-sm:hover { 
        color: var(--accent); 
        background: rgba(139, 92, 246, 0.1);
      }
      
      .icon-btn-sm.danger:hover { 
        color: var(--danger); 
        background: rgba(244, 63, 94, 0.1);
      }
      
      .text-btn {
        background: transparent;
        border: none;
        color: var(--accent);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        padding: 4px 8px;
        transition: all 0.2s;
      }
      
      .text-btn:hover { color: var(--accent-hover); }
      
      .stats-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
        font-size: 12px;
      }
      
      .stats-left, .stats-right { display: flex; align-items: center; gap: 14px; }
      .stats-left span { color: var(--text-muted); }
      
      .auto-status { 
        color: var(--success) !important; 
        display: flex;
        align-items: center;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.3s;
      }
      .auto-status.active { opacity: 1; }
      .auto-status::before {
        content: '';
        width: 6px;
        height: 6px;
        background: var(--success);
        border-radius: 50%;
        animation: pulse 2s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      
      .timer { 
        display: flex; 
        align-items: center; 
        gap: 5px; 
        color: var(--warning);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      
      .mail-list { 
        flex: 1; 
        min-height: 0;
        overflow-y: auto; 
        padding: 8px;
      }
      .mail-list.hidden { display: none; }
      
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 60px 40px;
        color: var(--text-muted);
        opacity: 0.4;
      }
      
      .empty-state svg { margin-bottom: 12px; }
      
      .mail-item {
        padding: 12px 14px;
        border-radius: 10px;
        cursor: pointer;
        margin-bottom: 6px;
        transition: all 0.2s;
        border: 1px solid transparent;
        position: relative;
      }
      
      .mail-item:hover { 
        background: var(--bg-hover);
        border-color: var(--border);
      }
      .mail-item.unread { 
        background: rgba(139, 92, 246, 0.08);
        border-color: rgba(139, 92, 246, 0.15);
        padding-left: 20px;
      }
      
      .mail-item.unread::before {
        content: '';
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 6px;
        height: 6px;
        background: var(--accent);
        border-radius: 50%;
      }
      
      .mail-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
      .mail-from { font-size: 13px; font-weight: 500; color: var(--text); }
      .mail-date { font-size: 11px; color: var(--text-muted); }
      .mail-subject { font-size: 12px; color: var(--text-muted); }
      
      .detail-header {
        padding: 12px 14px;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .back-btn {
        background: transparent;
        border: none;
        color: var(--text);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        border-radius: 8px;
        transition: all 0.2s;
      }
      
      .back-btn:hover { 
        color: var(--accent); 
        background: rgba(139, 92, 246, 0.1);
      }
      
      .detail-actions {
        display: flex;
        gap: 6px;
      }
      
      /* 附件样式 */
      .attachments-area { 
        background: rgba(15, 23, 42, 0.4);
        padding: 12px 16px;
        border-bottom: 1px solid var(--border);
      }
      .attachments-area.hidden { display: none; }
      
      .attachments-header {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
      }
      .attachments-list { display: flex; flex-direction: column; gap: 8px; }
      .attachment-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
        border: 1px solid var(--border);
        transition: all 0.2s;
      }
      .attachment-item:hover {
        border-color: var(--accent);
        background: rgba(139, 92, 246, 0.05);
      }
      .attachment-icon { color: var(--accent); opacity: 0.7; }
      .attachment-info { flex: 1; min-width: 0; }
      .attachment-name {
        font-size: 13px;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .attachment-size { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
      .attachment-download {
        background: rgba(139, 92, 246, 0.1);
        border: none;
        color: var(--accent);
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
        transition: all 0.2s;
      }
      .attachment-download:hover { 
        background: rgba(139, 92, 246, 0.2);
        transform: scale(1.05);
      }
      
      .detail-content { 
        flex: 1; 
        min-height: 0;
        overflow: hidden; 
        background: white;
        display: flex;
        flex-direction: column;
        border-radius: 12px;
        margin: 8px;
      }
      .mail-content-wrapper {
        flex: 1;
        min-height: 0;
        width: 100%;
        overflow: hidden;
      }
      .mail-content-wrapper iframe {
        display: block;
      }
      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: #94a3b8;
        font-size: 14px;
      }
      .loading-state::after {
        content: '';
        width: 16px;
        height: 16px;
        border: 2px solid #e2e8f0;
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-left: 10px;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      
      .text-content {
        padding: 16px;
        font-size: 13px;
        line-height: 1.7;
        white-space: pre-wrap;
        word-break: break-word;
        color: #334155;
        margin: 0;
        overflow: auto;
        flex: 1;
      }
      
      .empty-content { 
        padding: 60px; 
        text-align: center; 
        color: #94a3b8; 
        font-size: 14px;
      }
      
      .toast {
        position: absolute;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        padding: 10px 20px;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(12px);
        border-radius: 10px;
        font-size: 13px;
        font-weight: 500;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
        z-index: 100;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      }
      
      .toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
      .toast.success { 
        border: 1px solid rgba(16, 185, 129, 0.3);
        color: var(--success);
        background: rgba(16, 185, 129, 0.1);
      }
      .toast.error { 
        border: 1px solid rgba(244, 63, 94, 0.3);
        color: var(--danger);
        background: rgba(244, 63, 94, 0.1);
      }
      
      /* 滚动条 */
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { 
        background: rgba(255, 255, 255, 0.1); 
        border-radius: 3px;
      }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
    `;
  }
}

new FloatingMailbox();
