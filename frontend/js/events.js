/**
 * 事件绑定与协调模块
 */
import { dom } from './dom.js';
import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';

let selectedFiles = [];

export function bindEvents() {
    // 1. 顶部导航切换 (已通过 HTML 的 onclick="switchPage" 绑定，此处暴露接口即可)
    window.switchPage = (pageId, btn) => ui.switchPage(pageId, btn);

    // 2. 图片选择监听
    dom.imageInput.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        if (files.length > 99) {
            alert('单次最多支持 99 张图片');
            return;
        }
        selectedFiles = files;
        resetDisplay(false);
        if (files.length === 1) {
            const reader = new FileReader();
            reader.onload = (ev) => { dom.originalImg.src = ev.target.result; dom.originalImg.style.display='block'; };
            reader.readAsDataURL(files[0]);
            dom.statusText.innerText = '准备就绪';
        } else {
            ui.renderThumbnails(files);
            dom.statusText.innerText = `已选择 ${files.length} 张图片`;
        }
        dom.predictBtn.disabled = false;
    };

    // 3. 视频选择监听
    dom.videoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        selectedFiles = [file];
        resetDisplay(true);
        dom.originalVideo.src = URL.createObjectURL(file);
        dom.predictBtn.disabled = false;
        dom.statusText.innerText = '视频已就绪';
    };

    // 4. 开始识别点击
    dom.predictBtn.onclick = async () => {
        if (selectedFiles.length === 0) return;
        const isVideo = selectedFiles[0].type.startsWith('video/');
        dom.predictBtn.disabled = true;

        if (isVideo) {
            await handleVideoPredict(selectedFiles[0]);
        } else if (selectedFiles.length === 1) {
            await handleSinglePredict(selectedFiles[0]);
        } else {
            await handleBatchPredict(selectedFiles);
        }
        dom.predictBtn.disabled = false;
    };

    // 5. 视频播放按钮
    dom.playPauseBtn.onclick = () => {
        if (dom.resultVideo.paused) dom.resultVideo.play();
        else dom.resultVideo.pause();
    };

    // 6. 全局点击：关闭菜单
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('menu-trigger')) ui.closeAllMenus();
    });

    // 7. 侧边栏切换 (委托)
    window.toggleSidebar = () => {
        state.isSidebarCollapsed = !state.isSidebarCollapsed;
        ui.applyGlobalSidebarState();
    };

    // 8. 页面切换
    window.switchPage = (pageId, btn) => ui.switchPage(pageId, btn);

    // 9. 弹窗控制映射到 window 给 HTML 调用
    window.openUploadModal = () => {
        dom.uploadModal.classList.remove('hidden');
        setTimeout(() => {
            const fileInput = dom.uploadModal.querySelector('input[type="file"]');
            if (fileInput) fileInput.focus();
        }, 100);
    };
    window.closeUploadModal = () => dom.uploadModal.classList.add('hidden');
    window.closeRenameModal = () => dom.renameModal.classList.add('hidden');
    window.closeDeleteModal = () => dom.deleteModal.classList.add('hidden');
    window.closeClearHistoryModal = () => dom.clearHistoryModal.classList.add('hidden');
    window.closeDeleteHistoryModal = () => dom.deleteHistoryModal.classList.add('hidden');
    window.uploadModel = handleModelUpload; // 修正命名以匹配 HTML
    window.confirmRename = handleModelRename;
    window.confirmDelete = handleModelDelete;
    window.confirmClearHistory = confirmClearHistoryAction;
    window.confirmDeleteHistory = handleDeleteHistoryItem;
    window.clearHistory = handleClearHistory;

    // 10. 模态框优化：ESC键关闭和点击背景关闭
    setupModalOptimizations();
}
/**
 * 业务处理器：单张预测
 */
async function handleSinglePredict(file) {
    ui.updateProgress(0, 1, '识别中...');
    try {
        const data = await api.predictSingle(file);
        dom.resultImg.src = data.result_url;
        dom.resultImg.style.display = 'block';
        dom.downloadLink.href = data.result_url;
        dom.downloadLink.style.display = 'inline-block';
        dom.statusText.innerText = '完成';
        refreshHistory();
    } catch (e) {
        dom.statusText.innerText = '识别出错';
    }
}

/**
 * 业务处理器：批量预测 (SSE)
 */
async function handleBatchPredict(files) {
    ui.updateProgress(0, files.length, '批量识别中...');
    dom.batchProgress.style.display = 'block';
    try {
        const response = await api.predictBatch(files);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (const part of parts) {
                const line = part.trim();
                if (!line.startsWith('data: ')) continue;
                const event = JSON.parse(line.slice(6));
                if (event.done) {
                    ui.updateProgress(event.total, event.total, '批量识别完成');
                } else {
                    ui.updateProgress(event.current, event.total);
                    dom.originalImg.src = event.original_url;
                    dom.resultImg.src = event.result_url;
                    dom.resultImg.style.display = 'block';
                    dom.downloadLink.href = event.result_url;
                    dom.downloadLink.style.display = 'inline-block';
                }
            }
        }
        refreshHistory();
    } catch (e) {
        dom.statusText.innerText = '批量识别出错';
    }
}

/**
 * 业务处理器：视频预测 (SSE)
 */
async function handleVideoPredict(file) {
    ui.updateProgress(0, 100, '上传并初始化...');
    dom.batchProgress.style.display = 'block';
    try {
        const response = await api.predictVideo(file);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop();
            for (const part of parts) {
                const line = part.trim();
                if (!line.startsWith('data: ')) continue;
                const event = JSON.parse(line.slice(6));
                if (event.done) {
                    dom.resultVideo.src = event.result_url + "?t=" + new Date().getTime();
                    dom.resultVideo.style.display = 'block';
                    dom.resultVideo.load();
                    dom.playPauseBtn.style.display = 'inline-block';
                    dom.downloadLink.href = event.result_url;
                    dom.downloadLink.style.display = 'inline-block';
                    ui.updateProgress(100, 100, '');
                    refreshHistory();
                } else {
                    const percent = event.percent || 0;
                    ui.updateProgress(percent, 100, `处理中: ${event.current_frame}/${event.total_frames}`);
                }
            }
        }
    } catch (e) {
        dom.statusText.innerText = '视频处理失败';
    }
}

/**
 * 辅助：重置显示
 */
function resetDisplay(isVideo) {
    dom.thumbnailPreview.style.display = 'none';
    dom.batchProgress.style.display = 'none';
    dom.downloadLink.style.display = 'none';
    dom.originalImg.style.display = isVideo ? 'none' : 'block';
    dom.originalVideo.style.display = isVideo ? 'block' : 'none';
    dom.resultImg.style.display = 'none';
    dom.resultVideo.style.display = 'none';
    dom.playPauseBtn.style.display = 'none';
}

/**
 * 业务：模型操作
 */
export async function handleModelSwitch(name, category) {
    if (name === state.currentModelName) return;
    try {
        const res = await api.switchModel(name, category);
        if (res.ok) {
            state.currentModelName = name;
            state.currentCategory = category;
            await refreshApp();
        }
    } catch (e) { alert('切换失败'); }
}

async function handleModelUpload() {
    const file = document.getElementById('modelFile').files[0];
    const name = document.getElementById('modelName').value.trim();
    if (!file || !name) return;
    try {
        await api.uploadModel(file, name);
        window.closeUploadModal();
        refreshApp();
    } catch (e) { alert('上传失败'); }
}

async function handleModelRename() {
    const newName = dom.renameInput.value.trim();
    if (!newName) return;
    try {
        await api.renameModel(dom.oldNameHidden.value, newName, dom.categoryHidden.value);
        window.closeRenameModal();
        refreshApp();
    } catch (e) { alert('重命名失败'); }
}

function openDeleteModal(modelName, category) {
    dom.deleteModelName.textContent = modelName;
    dom.deleteModelNameHidden.value = modelName;
    dom.deleteCategoryHidden.value = category;
    dom.deleteModal.classList.remove('hidden');
    // 设置焦点到取消按钮
    setTimeout(() => {
        const cancelBtn = dom.deleteModal.querySelector('.modal-actions button:first-child');
        if (cancelBtn) cancelBtn.focus();
    }, 100);
}

async function handleModelDelete() {
    const modelName = dom.deleteModelNameHidden.value;
    const category = dom.deleteCategoryHidden.value;
    try {
        await api.deleteModel(modelName, category);
        window.closeDeleteModal();
        refreshApp();
    } catch (e) { alert('删除失败'); }
}

/**
 * 业务：历史记录查看
 */
function handleViewHistory(res, ori) {
    const isVideo = res.toLowerCase().endsWith('.mp4');
    resetDisplay(isVideo);
    if (isVideo) {
        const timestamp = new Date().getTime();
        dom.originalVideo.src = ori + "?t=" + timestamp;
        dom.resultVideo.src = res + "?t=" + timestamp;
        dom.resultVideo.style.display = 'block';
        dom.resultVideo.load();
        dom.originalVideo.load();
        dom.playPauseBtn.style.display = 'inline-block';
    } else {
        dom.originalImg.src = ori;
        dom.resultImg.src = res;
        dom.resultImg.style.display = 'block';
    }
    dom.downloadLink.href = res;
    dom.downloadLink.style.display = 'inline-block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleClearHistory() {
    dom.clearHistoryModal.classList.remove('hidden');
    setTimeout(() => {
        const cancelBtn = dom.clearHistoryModal.querySelector('.modal-actions button:first-child');
        if (cancelBtn) cancelBtn.focus();
    }, 100);
}

async function confirmClearHistoryAction() {
    try {
        await api.clearHistory(state.currentModelName);
        window.closeClearHistoryModal();
        refreshHistory();
    } catch (e) { alert('清空失败'); }
}

async function handleDeleteHistoryItem() {
    const recordId = dom.deleteHistoryIdHidden.value;
    try {
        await api.deleteHistoryItem(recordId);
        window.closeDeleteHistoryModal();
        refreshHistory();
    } catch (e) { alert('删除失败'); }
}

/**
 * 全局刷新协调
 */
export async function refreshApp() {
    const data = await api.getModels();
    state.currentModelName = data.current_model;
    dom.currentModelLabel.innerText = state.currentModelName;
    
    // 官方模型 (raw): 不允许重命名和删除
    ui.renderModelList(dom.rawList, data.models.raw, 'raw', state.currentModelName, 
        handleModelSwitch, null, null);
    
    // 导入模型 (yolo): 允许重命名和删除
    ui.renderModelList(dom.yoloList, data.models.yolo, 'yolo', state.currentModelName, 
        handleModelSwitch, 
        (name, category) => {
            dom.oldNameHidden.value = name;
            dom.categoryHidden.value = category;
            dom.renameInput.value = name.replace('.pt', '');
            dom.renameModal.classList.remove('hidden');
            setTimeout(() => {
                if (dom.renameInput) dom.renameInput.focus();
            }, 100);
        }, 
        (name, category) => openDeleteModal(name, category)
    );
    
    refreshHistory();
}

async function refreshHistory() {
    const history = await api.getHistory(state.currentModelName);
    ui.renderHistory(history, handleViewHistory, (id) => {
        dom.deleteHistoryIdHidden.value = id;
        dom.deleteHistoryModal.classList.remove('hidden');
        setTimeout(() => {
            const cancelBtn = dom.deleteHistoryModal.querySelector('.modal-actions button:first-child');
            if (cancelBtn) cancelBtn.focus();
        }, 100);
    });
}

/**
 * 模态框优化：ESC键关闭和点击背景关闭
 */
function setupModalOptimizations() {
    // ESC键关闭模态框
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // 找到当前打开的模态框并关闭
            const openModals = document.querySelectorAll('.modal:not(.hidden)');
            openModals.forEach(modal => modal.classList.add('hidden'));
        }
    });

    // 点击背景关闭模态框
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.add('hidden');
        }
    });

    // 防止模态框内容点击冒泡
    document.addEventListener('click', (e) => {
        if (e.target.closest('.modal-content')) {
            e.stopPropagation();
        }
    });

    // Tab键循环导航（在模态框内）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            const openModal = document.querySelector('.modal:not(.hidden)');
            if (openModal) {
                const focusableElements = openModal.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                const firstElement = focusableElements[0];
                const lastElement = focusableElements[focusableElements.length - 1];

                if (e.shiftKey) {
                    // Shift + Tab
                    if (document.activeElement === firstElement) {
                        lastElement.focus();
                        e.preventDefault();
                    }
                } else {
                    // Tab
                    if (document.activeElement === lastElement) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                }
            }
        }
    });
}