/**
 * UI 渲染与界面操作模块
 */
import { dom } from './dom.js';
import { state } from './state.js';
import { MAX_THUMBNAILS } from './config.js';

export const ui = {
    /**
     * SPA 路由模拟：切换页面容器
     */
    switchPage(pageId, btnElement) {
        // 隐藏所有容器
        dom.allContainers.forEach(page => page.style.display = 'none');
        
        // 取消高亮
        dom.topNavBtns.forEach(btn => btn.classList.remove('active'));

        // 显示目标
        const targetPage = document.getElementById(`page-${pageId}`);
        if (targetPage) {
            targetPage.style.display = 'flex';
            this.syncSidebarUI(targetPage);
        }

        // 高亮按钮
        if (btnElement) btnElement.classList.add('active');
    },

    /**
     * 渲染模型列表 (Raw / Yolo 区域)
     * @param {HTMLElement} container 容器元素
     * @param {Array} items 模型名称数组
     * @param {String} category 类别
     * @param {String} activeName 当前选中的模型名
     * @param {Function} onSwitch 切换回调
     * @param {Function} onRename 重命名回调
     * @param {Function} onDelete 删除回调
     */
    renderModelList(container, items, category, activeName, onSwitch, onRename, onDelete) {
        container.innerHTML = '';
        items.forEach((name, index) => {
            const div = document.createElement('div');
            div.className = `model-item ${name === activeName ? 'active' : ''}`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'model-name';
            nameSpan.innerText = name;
            div.onclick = () => onSwitch(name, category);
            div.appendChild(nameSpan);

            if (category !== 'raw') {
                const menuId = `menu-${category}-${index}`;
                const dots = document.createElement('div');
                dots.className = 'menu-trigger';
                dots.innerText = '⋮';
                dots.onclick = (e) => {
                    e.stopPropagation();
                    this.toggleMenu(menuId);
                };

                const menu = document.createElement('div');
                menu.className = 'context-menu';
                menu.id = menuId;
                menu.innerHTML = `
                    <div class="context-menu-item">重命名</div>
                    <div class="context-menu-item danger">删除</div>
                `;

                const menuItems = menu.querySelectorAll('.context-menu-item');
                menuItems[0].onclick = (e) => { e.stopPropagation(); onRename(name, category); };
                menuItems[1].onclick = (e) => { e.stopPropagation(); onDelete(name, category); };

                div.appendChild(dots);
                div.appendChild(menu);
            }
            container.appendChild(div);
        });
    },

    /**
     * 上下文菜单控制
     */
    toggleMenu(menuId) {
        const menu = document.getElementById(menuId);
        if (state.activeMenuId === menuId) {
            menu.classList.remove('show');
            state.activeMenuId = null;
        } else {
            this.closeAllMenus();
            menu.classList.add('show');
            state.activeMenuId = menuId;
        }
    },

    closeAllMenus() {
        document.querySelectorAll('.context-menu').forEach(el => el.classList.remove('show'));
        state.activeMenuId = null;
    },

    /**
     * 批量导入的缩略图展示
     */
    renderThumbnails(files) {
        dom.thumbnailPreview.innerHTML = '';
        dom.thumbnailPreview.style.display = 'flex';

        const showCount = Math.min(files.length, MAX_THUMBNAILS);
        const remaining = files.length - showCount;

        for (let i = 0; i < showCount; i++) {
            const thumb = document.createElement('div');
            thumb.className = 'thumbnail-item';
            const img = document.createElement('img');
            const reader = new FileReader();
            reader.onload = (ev) => { img.src = ev.target.result; };
            reader.readAsDataURL(files[i]);
            thumb.appendChild(img);
            dom.thumbnailPreview.appendChild(thumb);
        }

        if (remaining > 0) {
            const more = document.createElement('div');
            more.className = 'thumbnail-more';
            more.innerText = `+${remaining}`;
            dom.thumbnailPreview.appendChild(more);
        }

        const countLabel = document.createElement('span');
        countLabel.className = 'thumbnail-count';
        countLabel.innerText = `共 ${files.length} 张`;
        dom.thumbnailPreview.appendChild(countLabel);
    },

    /**
     * 更新进度条 UI
     */
    updateProgress(current, total, statusMsg = null) {
        const percent = Math.round((current / total) * 100) || 0;
        dom.progressFill.style.width = `${percent}%`;
        dom.progressText.innerText = total > 100 ? `${percent}%` : `${current}/${total}`;
        if (statusMsg) dom.statusText.innerText = statusMsg;
    },

    /**
     * 渲染历史记录 Grid
     * @param {Array} history 历史数据数组
     * @param {Function} onClick 点击查看详情回调
     * @param {Function} onDelete 删除记录回调
     */
    renderHistory(history, onClick, onDelete) {
        dom.historyGrid.innerHTML = '';
        if (history.length === 0) {
            dom.historyGrid.innerHTML = '<p style="color:#999;font-size:12px;text-align:center;width:100%">暂无记录</p>';
            return;
        }
        history.forEach(item => {
            const isVideo = item.result.toLowerCase().endsWith('.mp4');
            const div = document.createElement('div');
            div.className = 'history-item';
            if (isVideo) {
                div.classList.add('video-type');
                div.innerHTML = `
                    <div class="video-placeholder"><svg viewBox="0 0 24 24" width="40" height="40" fill="white"><path d="M8 5v14l11-7z"/></svg></div>
                    <span>${item.time.substring(5, 16).replace('T', ' ')}</span>
                    <div class="delete-record-btn" title="删除该记录">×</div>
                `;
            } else {
                div.innerHTML = `
                    <img src="${item.result}">
                    <span>${item.time.substring(5, 16).replace('T', ' ')}</span>
                    <div class="delete-record-btn" title="删除该记录">×</div>
                `;
            }
            div.querySelector('.delete-record-btn').onclick = (e) => { e.stopPropagation(); onDelete(item.id); };
            div.onclick = () => onClick(item.result, item.original);
            dom.historyGrid.appendChild(div);
        });
    },

    /**
     * 侧边栏同步逻辑
     */
    syncSidebarUI(container) {
        const sidebar = container.querySelector('.sidebar');
        const openBtn = container.querySelector('.open-sidebar-btn');
        if (!sidebar) return;

        if (state.isSidebarCollapsed) {
            sidebar.classList.add('collapsed');
            if (openBtn) openBtn.classList.add('visible');
        } else {
            sidebar.classList.remove('collapsed');
            if (openBtn) openBtn.classList.remove('visible');
        }
    },

    applyGlobalSidebarState() {
        dom.allContainers.forEach(container => this.syncSidebarUI(container));
    }
};
