# DriftMail Extension

临时邮箱浏览器扩展，支持 Chrome / Edge。

## 功能特性

- 自定义邮箱用户名
- 多域名选择
- 邮件实时刷新
- 附件下载
- 悬浮面板（任意页面使用）
- 位置记忆
- 本地缓存优化

## 安装

### 从源码安装

1. 下载或克隆本项目
2. 打开 Chrome 扩展管理页面 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目目录

### 配置

首次使用需配置后端服务：

1. 点击扩展图标
2. 点击「设置」
3. 填写 API 地址（如 `https://your-worker.workers.dev`）
4. 填写访问密钥（与后端 `ACCESS_KEY` 一致）
5. 保存

## 使用方式

### 弹出面板

点击扩展图标打开。

### 悬浮面板

任意网页右侧显示悬浮按钮，点击打开面板。

支持：
- 拖动按钮/面板位置
- 位置自动保存

## 本地存储

扩展使用 Chrome Storage 存储数据：

| 键名 | 说明 |
|------|------|
| `driftMailSettings` | 设置（API 地址、密钥） |
| `driftMailbox` | 当前邮箱信息 |
| `driftMails` | 邮件列表 |
| `driftDomainsCache` | 域名缓存（1 小时） |
| `driftMailContentCache` | 邮件内容缓存（30 分钟） |

## 文件结构

```
temp-mail-extension/
├── manifest.json      # 扩展配置
├── background.js      # Service Worker
├── content.js         # 悬浮面板
├── popup/             # 弹出面板
│   ├── popup.html
│   ├── popup.js
│   └── ...
├── lib/               # 公共模块
│   ├── api.js
│   ├── config.js
│   └── utils.js
└── icons/             # 扩展图标
```

## 后端服务

需配合 [DriftMail](https://github.com/eryveban/drift-mail) 使用。

## 作者

二月半

## License

MIT
