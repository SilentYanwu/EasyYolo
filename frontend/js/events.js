/**
 * 事件绑定与协调模块
 */
import { dom } from './dom.js';
import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { showMessage } from './modals.js';
import { resetDisplay, handleSinglePredict, handleBatchPredict, handleVideoPredict, refreshHistory } from './inferring.js';
import {
    multiTaskManager,
    handleStartTraining,
    handleDatasetUpload,
    startTrainingPoller,
    switchTrainingMode,
    addTrainingTask,
    deleteTask,
    startQueueTraining,
    stopQueueTraining,
    applyTrainingMode,
    loadModelDetails,
    renderTaskList,
    executeNextTaskInQueue,
    waitForTaskCompletion,
    updateQueueControls,
    setupTrainingWindowFunctions
} from './training.js';

let selectedFiles = [];

/**
 * 绑定页面所有事件处理函数
 */
export function bindEvents() {
    try {
    // 1. 顶部导航切换
    window.switchPage = (pageId, btn) => ui.switchPage(pageId, btn);

    // 2. “上传图片”按钮
    dom.imageInput.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        if (files.length > 99) {
            showMessage(`单次最多支持 99 张图片，您选择了 ${files.length} 张`, 'warning');
            return;
        }
        selectedFiles = files;
        resetDisplay(false);
        if (files.length === 1) {
            const reader = new FileReader();
            reader.onload = (ev) => { dom.originalImg.src = ev.target.result; dom.originalImg.style.display = 'block'; };
            reader.readAsDataURL(files[0]);
            dom.statusText.innerText = '准备就绪';
        } else {
            ui.renderThumbnails(files);
            dom.statusText.innerText = `已选择 ${files.length} 张图片`;
        }
        dom.predictBtn.disabled = false;
    };

    // 3. “上传视频”按钮
    dom.videoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        selectedFiles = [file];
        resetDisplay(true);
        dom.originalVideo.src = URL.createObjectURL(file);
        dom.predictBtn.disabled = false;
        dom.statusText.innerText = '视频已就绪';
    };

    // 4. “开始识别”按钮
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

    // 7. 侧边栏切换
    window.toggleSidebar = () => {
        state.isSidebarCollapsed = !state.isSidebarCollapsed;
        ui.applyGlobalSidebarState();
    };

    // 8. 弹窗控制映射到 window
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
    window.uploadModel = handleModelUpload;
    window.confirmRename = handleModelRename;
    window.confirmDelete = handleModelDelete;
    window.confirmClearHistory = confirmClearHistoryAction;
    window.confirmDeleteHistory = handleDeleteHistoryItem;
    window.clearHistory = handleClearHistory;

    // 训练参数弹窗 window 级绑定（由 training.js 提供）
    setupTrainingWindowFunctions();

    window.startTraining = handleStartTraining;

    // 9. 训练页面：数据集上传按钮
    dom.uploadDatasetBtn.onclick = () => dom.trainDatasetInput.click();
    dom.trainDatasetInput.onchange = handleDatasetUpload;

    dom.btnOpenTrainingParams.onclick = window.openTrainingParamsModal;
    dom.startTrainBtn.onclick = window.startTraining;

    startTrainingPoller();

    // 10. 多任务模式事件绑定
    window.switchTrainingMode = switchTrainingMode;
    window.addTrainingTask = addTrainingTask;
    window.deleteTask = deleteTask;
    window.startQueueTraining = startQueueTraining;
    window.stopQueueTraining = stopQueueTraining;

    multiTaskManager.init();

    // 队列恢复：如果标记为运行中，校验后端状态
    if (multiTaskManager.isQueueRunning) {
        (async () => {
            try {
                const progress = await api.getTrainingProgress();
                if (progress.status === 'training') {
                    console.log('[队列恢复] 后端训练进行中，恢复队列监控');
                    waitForTaskCompletion();
                } else if (progress.status === 'success') {
                    console.log('[队列恢复] 当前任务已完成，推进到下一个任务');
                    const currentTask = multiTaskManager.getCurrentTask();
                    if (currentTask) {
                        multiTaskManager.updateTask(multiTaskManager.currentTaskIndex, {
                            status: 'completed',
                            progress: progress.progress || currentTask.totalEpochs,
                            totalEpochs: progress.total || currentTask.totalEpochs
                        });
                    }
                    multiTaskManager.moveToNextTask();
                    renderTaskList();
                    if (multiTaskManager.isQueueRunning) {
                        state.lastTrainingStatus = 'training';
                        executeNextTaskInQueue();
                    } else {
                        state.lastTrainingStatus = 'success';
                        showMessage('所有训练任务已完成！', 'success');
                        updateQueueControls();
                    }
                } else {
                    console.warn('[队列恢复] 后端状态为 ' + progress.status + '，重置队列');
                    multiTaskManager.stopQueue();
                    updateQueueControls();
                    renderTaskList();
                }
            } catch (_) {
                multiTaskManager.stopQueue();
                updateQueueControls();
                renderTaskList();
            }
        })();
    }

    // 初始化训练模式界面
    if (state.trainingMode === 'multi') {
        applyTrainingMode('multi', false);
    } else {
        applyTrainingMode(state.trainingMode, false);
    }

    // 绑定多任务按钮事件
    const addTaskBtn = document.getElementById('addTaskBtn');
    const queueStartBtn = document.getElementById('queueStartBtn');
    if (addTaskBtn) addTaskBtn.onclick = addTrainingTask;
    if (queueStartBtn) queueStartBtn.onclick = startQueueTraining;

    // 11. 模态框优化：ESC键关闭和点击背景关闭
    setupModalOptimizations();

    // 12. 模型详情页的基础模型跳转
    dom.detailsBaseModelLink.onclick = async (e) => {
        e.preventDefault();
        const targetModel = e.target.dataset.target;
        if (targetModel) {
            state.currentDetailsModelName = targetModel;
            await loadModelDetails(targetModel);
            await refreshApp();
        }
    };

    // 13. 模型详情页管理菜单事件
    dom.detailsMenuTrigger.onclick = (e) => {
        e.stopPropagation();
        ui.toggleMenu('detailsMenu');
    };

    dom.detailsRenameBtn.onclick = () => {
        const name = state.currentDetailsModelName;
        if (!name) return;
        dom.oldNameHidden.value = name;
        dom.categoryHidden.value = 'trained';
        dom.renameInput.value = name.replace('.pt', '');
        dom.renameModal.classList.remove('hidden');
        setTimeout(() => dom.renameInput.focus(), 100);
    };

    dom.detailsEditDescBtn.onclick = () => {
        const name = state.currentDetailsModelName;
        openEditDescriptionModal(name);
    };

    window.openEditDescriptionModal = openEditDescriptionModal;

    dom.detailsDeleteBtn.onclick = () => {
        const name = state.currentDetailsModelName;
        if (!name) return;
        openDeleteModal(name, 'trained');
    };

    window.closeEditDescriptionModal = () => dom.editDescriptionModal.classList.add('hidden');
    window.confirmEditDescription = async () => {
        const name = dom.descModelNameHidden.value;
        const desc = dom.editDescriptionInput.value.trim();
        try {
            const res = await api.updateModelDescription(name, desc);
            if (res.ok) {
                window.closeEditDescriptionModal();
                await loadModelDetails(name);
            } else {
                const data = await res.json().catch(() => ({}));
                showMessage(`修改失败: ${data.detail || '未知错误'}`, 'warning');
            }
        } catch (e) { showMessage(`请求出错: ${e.message}`, 'warning'); }
    };
    } catch (e) {
        console.error('bindEvents error:', e);
    }
}

// ===== 模型管理 =====

/** 切换当前使用的 YOLO 模型 */
export async function handleModelSwitch(name, category) {
    if (name === state.currentModelName) return;
    try {
        const res = await api.switchModel(name, category);
        if (res.ok) {
            state.currentModelName = name;
            state.currentCategory = category;
            await refreshApp();
        }
    } catch (e) { showMessage(`切换失败: ${e.message}`, 'warning'); }
}

/** 上传自定义模型文件到后端 */
async function handleModelUpload() {
    const file = document.getElementById('modelFile').files[0];
    const name = document.getElementById('modelName').value.trim();
    if (!file || !name) return;
    try {
        await api.uploadModel(file, name);
        window.closeUploadModal();
        refreshApp();
    } catch (e) { showMessage(`上传失败: ${e.message}`, 'warning'); }
}

/** 重命名模型并刷新列表 */
async function handleModelRename() {
    const newName = dom.renameInput.value.trim();
    if (!newName) return;
    try {
        await api.renameModel(dom.oldNameHidden.value, newName, dom.categoryHidden.value);
        window.closeRenameModal();
        refreshApp();
    } catch (e) { showMessage(`重命名失败: ${e.message}`, 'warning'); }
}

/** 打开删除模型确认弹窗 */
function openDeleteModal(modelName, category) {
    dom.deleteModelName.textContent = modelName;
    dom.deleteModelNameHidden.value = modelName;
    dom.deleteCategoryHidden.value = category;
    dom.deleteModal.classList.remove('hidden');
    setTimeout(() => {
        const btn = dom.deleteModal.querySelector('.btn.primary') || dom.deleteModal.querySelector('button');
        if (btn) btn.focus();
    }, 100);
}

/** 打开模型介绍编辑弹窗 */
function openEditDescriptionModal(name) {
    if (!name) return;
    dom.descModelNameHidden.value = name;

    let currentDesc = '';
    if (name === state.currentDetailsModelName) {
        currentDesc = dom.detailsModelDescription.innerText.replace('📝 ', '').replace('暂无介绍', '');
    }

    dom.editDescriptionInput.value = currentDesc;
    dom.editDescriptionModal.classList.remove('hidden');
    setTimeout(() => dom.editDescriptionInput.focus(), 100);
}

/** 确认删除模型并刷新列表 */
async function handleModelDelete() {
    const modelName = dom.deleteModelNameHidden.value;
    const category = dom.deleteCategoryHidden.value;
    try {
        await api.deleteModel(modelName, category);
        window.closeDeleteModal();
        refreshApp();
    } catch (e) { showMessage(`删除失败: ${e.message}`, 'warning'); }
}

// ===== 历史记录管理 =====

/** 打开清空历史记录确认弹窗 */
async function handleClearHistory() {
    dom.clearHistoryModal.classList.remove('hidden');
    setTimeout(() => {
        const cancelBtn = dom.clearHistoryModal.querySelector('.modal-actions button:first-child');
        if (cancelBtn) cancelBtn.focus();
    }, 100);
}

/** 确认清空当前模型的所有历史记录 */
async function confirmClearHistoryAction() {
    try {
        await api.clearHistory(state.currentModelName);
        window.closeClearHistoryModal();
        refreshHistory();
    } catch (e) { showMessage(`清空失败: ${e.message}`, 'warning'); }
}

/** 删除单条历史记录 */
async function handleDeleteHistoryItem() {
    const recordId = dom.deleteHistoryIdHidden.value;
    try {
        await api.deleteHistoryItem(recordId);
        window.closeDeleteHistoryModal();
        refreshHistory();
    } catch (e) { showMessage(`删除失败: ${e.message}`, 'warning'); }
}

// ===== 全局刷新协调 =====

/** 从后端拉取模型列表、刷新所有模型列表 UI 和历史记录 */
export async function refreshApp() {
    const data = await api.getModels();
    state.currentModelName = data.current_model;
    dom.currentModelLabel.innerText = state.currentModelName;

    ui.renderModelList(dom.rawList, data.models.raw, 'raw', state.currentModelName,
        handleModelSwitch, null, null);

    ui.renderModelList(dom.yoloList, data.models.yolo, 'yolo', state.currentModelName,
        handleModelSwitch,
        (name, category) => {
            dom.oldNameHidden.value = name;
            dom.categoryHidden.value = category;
            dom.renameInput.value = name.replace('.pt', '');
            dom.renameModal.classList.remove('hidden');
            setTimeout(() => { if (dom.renameInput) dom.renameInput.focus(); }, 100);
        },
        (name, category) => openDeleteModal(name, category),
        (name) => openEditDescriptionModal(name)
    );

    ui.renderModelList(dom.trainedList, data.models.trained, 'trained', state.currentDetailsModelName,
        async (name) => {
            if (name === state.currentDetailsModelName) return;
            state.currentDetailsModelName = name;
            await loadModelDetails(name);
            await refreshApp();
        },
        (name, category) => {
            dom.oldNameHidden.value = name;
            dom.categoryHidden.value = category;
            dom.renameInput.value = name.replace('.pt', '');
            dom.renameModal.classList.remove('hidden');
            setTimeout(() => { if (dom.renameInput) dom.renameInput.focus(); }, 100);
        },
        (name, category) => openDeleteModal(name, category),
        (name) => openEditDescriptionModal(name)
    );

    ui.renderModelList(dom.inferenceTrainedList, data.models.trained, 'trained', state.currentModelName,
        handleModelSwitch,
        (name, category) => {
            dom.oldNameHidden.value = name;
            dom.categoryHidden.value = category;
            dom.renameInput.value = name.replace('.pt', '');
            dom.renameModal.classList.remove('hidden');
            setTimeout(() => { if (dom.renameInput) dom.renameInput.focus(); }, 100);
        },
        (name, category) => openDeleteModal(name, category),
        (name) => openEditDescriptionModal(name)
    );

    ui.renderTrainBaseModels(data.models);

    if (state.trainingMode === 'multi') {
        renderTaskList();
    }

    refreshHistory();
}

// ===== 模态框辅助 =====

function setupModalOptimizations() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const openModals = document.querySelectorAll('.modal:not(.hidden)');
            openModals.forEach(modal => modal.classList.add('hidden'));
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('.modal-content')) {
            e.stopPropagation();
        }
    });

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
                    if (document.activeElement === firstElement) {
                        lastElement.focus();
                        e.preventDefault();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                }
            }
        }
    });
}
