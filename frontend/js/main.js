/**
 * EasyYolo 应用程序入口
 */
import { bindEvents, refreshApp } from './events.js';
import { ui } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 EasyYolo ES6 Module Initializing...");

    // 1. 绑定所有交互事件
    bindEvents();

    // 2. 初始化侧边栏 UI 状态
    ui.applyGlobalSidebarState();

    // 3. 恢复刷新前的页面（如训练页、详情页）
    ui.restorePage();

    // 4. 从后端加载模型列表及初始化状态
    await refreshApp();

    console.log("✅ Initialization Complete.");
});
