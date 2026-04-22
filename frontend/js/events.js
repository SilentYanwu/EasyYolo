/**
 * 事件绑定与协调模块
 */
import { dom } from './dom.js';
import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { MAX_TRAINING_TASKS } from './config.js';

let selectedFiles = [];
const trainParams=  {
            epochs: 5,
            patience: 50,
            batch: 16,
            imgsz: 640,
            optimizer: 'auto',
            lr0: 0.01,
            lrf: 0.01,
            momentum: 0.937,
            weight_decay: 0.0005,
            warmup_epochs: 3.0,
            warmup_momentum: 0.8,
            cos_lr: false,
            hsv_h: 0.015,
            hsv_s: 0.7,
            hsv_v: 0.4,
            degrees: 0.0,
            translate: 0.1,
            scale: 0.5,
            shear: 0.0,
            perspective: 0.0,
            flipud: 0.0,
            fliplr: 0.5,
            mosaic: 1.0,
            mixup: 0.0,
            copy_paste: 0.0,
            seed: 42,
            workers: 8,
            device: '',
            amp: true
        };

/**
 * 绑定页面所有事件处理函数
 * 包括导航切换、文件上传、识别处理、视频控制、弹窗管理等功能
 */
export function bindEvents() {
    try {
    // 1. 顶部导航切换 (已通过 HTML 的 onclick="switchPage" 绑定，此处暴露接口即可)
    window.switchPage = (pageId, btn) => ui.switchPage(pageId, btn);

    // 2. “上传图片”按钮的监听
    dom.imageInput.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        if (files.length > 99) {
            dom.warningMessage.innerText = `单次最多支持 99 张图片，您选择了 ${files.length} 张`;
            dom.warningModal.classList.remove('hidden');
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

    // 3. “上传视频”按钮的监听
    dom.videoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        selectedFiles = [file];
        resetDisplay(true);
        dom.originalVideo.src = URL.createObjectURL(file);
        dom.predictBtn.disabled = false;
        dom.statusText.innerText = '视频已就绪';
    };

    // 4. “开始识别”按钮的监听, 根据文件类型调用不同的处理函数
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

    // 8. 弹窗控制映射到 window 给 HTML 调用
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
    window.closeWarningModal = () => dom.warningModal.classList.add('hidden');
    window.uploadModel = handleModelUpload; // 修正命名以匹配 HTML
    window.confirmRename = handleModelRename;
    window.confirmDelete = handleModelDelete;
    window.confirmClearHistory = confirmClearHistoryAction;
    window.confirmDeleteHistory = handleDeleteHistoryItem;
    window.clearHistory = handleClearHistory;

    window.openTrainingParamsModal = () => {
        dom.trainingParamsModal.classList.remove('hidden');
    };
    window.closeTrainingParamsModal = () => {
        editingTaskParamsIndex = -1;
        dom.trainingParamsModal.classList.add('hidden');
    };
    window.saveTrainingParams = () => {
        if (editingTaskParamsIndex >= 0) {
            const taskIndex = editingTaskParamsIndex;
            const params = collectTrainingParams();
            multiTaskManager.updateTask(taskIndex, { parameters: params });
            window.closeTrainingParamsModal();
            alert(`训练参数已保存到任务${taskIndex + 1}`);
            return;
        }
        window.closeTrainingParamsModal();
        alert('训练参数已记录');
    };
    window.startTraining = handleStartTraining;

    // 9. 训练页面：数据集上传按钮和文件选择
    dom.uploadDatasetBtn.onclick = () => dom.trainDatasetInput.click();
    dom.trainDatasetInput.onchange = handleDatasetUpload;

    // 绑定按钮事件
    dom.btnOpenTrainingParams.onclick = window.openTrainingParamsModal;
    dom.startTrainBtn.onclick = window.startTraining;

    // 启动训练轮询
    startTrainingPoller();

    // 10. 多任务模式事件绑定
    window.switchTrainingMode = switchTrainingMode;
    window.addTrainingTask = addTrainingTask;
    window.deleteTask = deleteTask;
    window.startQueueTraining = startQueueTraining;
    window.stopQueueTraining = stopQueueTraining;
    window.closeStopQueueModal = closeStopQueueModal;
    window.confirmStopQueue = confirmStopQueue;
    window.closeTaskFailedModal = closeTaskFailedModal;
    window.cancelSwitchMode = cancelSwitchMode;
    window.confirmSwitchMode = confirmSwitchMode;

    // 初始化多任务管理器
    multiTaskManager.init();

    // 初始化训练模式界面（不清空队列，因为是从本地存储恢复）
    // 如果是多任务模式且训练正在进行，直接应用多任务模式，不进行训练状态检查
    if (state.trainingMode === 'multi') {
        // 直接应用多任务模式，不经过switchTrainingMode的训练状态检查
        applyTrainingMode('multi', false);
    } else {
        applyTrainingMode(state.trainingMode, false);
    }

    // 绑定多任务按钮事件（仅在元素存在时）
    const addTaskBtn = document.getElementById('addTaskBtn');
    const queueStartBtn = document.getElementById('queueStartBtn');
    if (addTaskBtn) addTaskBtn.onclick = addTrainingTask;
    if (queueStartBtn) queueStartBtn.onclick = startQueueTraining;

    // 11. 模态框优化：ESC键关闭和点击背景关闭
    setupModalOptimizations();

    // 12. 绑定模型详情页的基础模型跳转点击事件
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
        dom.categoryHidden.value = 'trained'; // 详情页目前只展示 trained 模型
        dom.renameInput.value = name.replace('.pt', '');
        dom.renameModal.classList.remove('hidden');
        setTimeout(() => dom.renameInput.focus(), 100);
    };

    dom.detailsEditDescBtn.onclick = () => {
        const name = state.currentDetailsModelName;
        openEditDescriptionModal(name);
    };

    window.openEditDescriptionModal = openEditDescriptionModal; // 暴露给 HTML 或其他模块


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
                await loadModelDetails(name); // 重新加载详情以显示新介绍
            } else {
                alert('修改失败');
            }
        } catch (e) { alert('请求出错'); }
    };
    } catch (e) {
        console.error('bindEvents error:', e);
    }
}


// ===== 多任务管理器 =====
const multiTaskManager = {
    // 任务队列状态
    tasks: [],
    currentTaskIndex: -1,
    isQueueRunning: false,
    queueStatus: 'idle', // 'idle', 'running', 'stopped', 'error'

    // 初始化多任务管理器
    init() {
        this.tasks = [];
        this.currentTaskIndex = -1;
        this.isQueueRunning = false;
        this.queueStatus = 'idle';
        this.loadFromStorage();
    },

    // 从本地存储加载
    loadFromStorage() {
        try {
            const saved = localStorage.getItem('multiTaskQueue');
            if (saved) {
                const data = JSON.parse(saved);
                this.tasks = data.tasks || [];
                this.currentTaskIndex = data.currentTaskIndex || -1;
                this.isQueueRunning = data.isQueueRunning || false;
                this.queueStatus = data.queueStatus || 'idle';
            }
        } catch (e) {
            console.warn('Failed to load multi-task queue from storage:', e);
        }
    },

    // 保存到本地存储
    saveToStorage() {
        try {
            const data = {
                tasks: this.tasks,
                currentTaskIndex: this.currentTaskIndex,
                isQueueRunning: this.isQueueRunning,
                queueStatus: this.queueStatus
            };
            localStorage.setItem('multiTaskQueue', JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save multi-task queue to storage:', e);
        }
    },

    // 创建新任务
    createTask(index) {
        const chineseNumbers = ['一', '二', '三', '四', '五', '六'];
        const chineseIndex = index <= 6 ? chineseNumbers[index - 1] : index;
        // 创建独立的参数对象，避免共享引用
        return {
            id: Date.now() + Math.random(),
            index: index,
            title: `任务${chineseIndex}`,
            modelSource: index === 1 ? 'existing' : 'previous',
            baseModel: '',
            newModelName: '',
            description: '',
            datasetPath: '',
            datasetName: '未选择',
            parameters: {...trainParams}, // 使用扩展运算符创建新对象
            status: 'pending', // 'pending', 'running', 'completed', 'failed'
            progress: 0,
            totalEpochs: 0,
            errorMessage: ''
        };
    },

    // 添加新任务
    addTask() {
        if (this.tasks.length >= MAX_TRAINING_TASKS) {
            alert(`最多支持${MAX_TRAINING_TASKS}个任务`);
            return false;
        }

        const newIndex = this.tasks.length + 1;
        const newTask = this.createTask(newIndex);
        this.tasks.push(newTask);
        this.saveToStorage();
        return newTask;
    },

    // 删除任务
    deleteTask(index) {
        if (this.isQueueRunning) {
            alert('队列运行中，请先停止');
            return false;
        }

        if (index < 0 || index >= this.tasks.length) return false;

        // 检查是否有后续任务依赖此任务
        for (let i = index + 1; i < this.tasks.length; i++) {
            if (this.tasks[i].modelSource === 'previous') {
                alert(`任务${i+1}的模型来源指向已删除的任务，请重新选择模型来源`);
                // 将依赖任务改为使用现有模型
                this.tasks[i].modelSource = 'existing';
                this.tasks[i].baseModel = '';
            }
        }

        this.tasks.splice(index, 1);

        // 重新编号任务
        this.tasks.forEach((task, idx) => {
            task.index = idx + 1;
            const chineseNumbers = ['一', '二', '三', '四', '五', '六'];
            const chineseIndex = idx + 1 <= 6 ? chineseNumbers[idx] : idx + 1;
            task.title = `任务${chineseIndex}`;
        });

        this.saveToStorage();
        return true;
    },

    // 更新任务数据
    updateTask(index, updates) {
        if (index < 0 || index >= this.tasks.length) return false;

        // 如果更新包含parameters，创建深拷贝以避免共享引用
        if (updates.parameters) {
            updates = {...updates, parameters: {...updates.parameters}};
        }

        Object.assign(this.tasks[index], updates);
        this.saveToStorage();
        return true;
    },

    // 开始队列
    async startQueue() {
        if (this.isQueueRunning) return false;
        if (this.tasks.length === 0) {
            alert('请至少添加一个任务');
            return false;
        }

        // 验证所有任务
        for (let i = 0; i < this.tasks.length; i++) {
            const task = this.tasks[i];
            if (!task.newModelName.trim()) {
                alert(`任务${i+1}的新模型名称不能为空`);
                return false;
            }
            if (!task.datasetPath) {
                alert(`任务${i+1}的数据集未上传`);
                return false;
            }
            if (task.modelSource === 'existing' && !task.baseModel) {
                alert(`任务${i+1}的基础模型未选择`);
                return false;
            }
        }

        this.isQueueRunning = true;
        this.currentTaskIndex = 0;
        this.queueStatus = 'running';
        this.saveToStorage();
        return true;
    },

    // 停止队列
    stopQueue() {
        if (!this.isQueueRunning) return false;

        this.isQueueRunning = false;
        this.queueStatus = 'stopped';

        // 重置所有任务状态
        this.tasks.forEach(task => {
            task.status = 'pending';
            task.progress = 0;
            task.errorMessage = '';
        });

        this.currentTaskIndex = -1;
        this.saveToStorage();
        return true;
    },

    // 任务失败处理
    taskFailed(taskIndex, errorMessage) {
        this.isQueueRunning = false;
        this.queueStatus = 'error';

        // 更新失败任务状态
        if (taskIndex >= 0 && taskIndex < this.tasks.length) {
            this.tasks[taskIndex].status = 'failed';
            this.tasks[taskIndex].errorMessage = errorMessage;
        }

        // 重置其他任务
        this.tasks.forEach((task, idx) => {
            if (idx !== taskIndex) {
                task.status = 'pending';
                task.progress = 0;
            }
        });

        this.currentTaskIndex = -1;
        this.saveToStorage();
    },

    // 获取当前运行的任务
    getCurrentTask() {
        if (this.currentTaskIndex >= 0 && this.currentTaskIndex < this.tasks.length) {
            return this.tasks[this.currentTaskIndex];
        }
        return null;
    },

    // 移动到下一个任务
    moveToNextTask() {
        if (this.currentTaskIndex >= 0 && this.currentTaskIndex < this.tasks.length) {
            this.tasks[this.currentTaskIndex].status = 'completed';
        }

        this.currentTaskIndex++;

        if (this.currentTaskIndex >= this.tasks.length) {
            // 所有任务完成
            this.isQueueRunning = false;
            this.queueStatus = 'completed';
            this.currentTaskIndex = -1;
        }

        this.saveToStorage();
        return this.currentTaskIndex;
    },

    // 清空队列
    clearQueue() {
        this.tasks = [];
        this.currentTaskIndex = -1;
        this.isQueueRunning = false;
        this.queueStatus = 'idle';
        localStorage.removeItem('multiTaskQueue');
    }
};

// 全局训练状态
let uploadedDatasetPath = "";
let trainingPoller = null;
let editingTaskParamsIndex = -1;


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

                // 完成，更新进度和显示结果
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
        const res = await api.switchModel(name, category); //等待模型切换完成后再刷新界面
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
        const btn = dom.deleteModal.querySelector('.btn.primary') || dom.deleteModal.querySelector('button');
        if (btn) btn.focus();
    }, 100);
}

function openEditDescriptionModal(name) {
    if (!name) return;
    dom.descModelNameHidden.value = name;

    // 如果是当前详情页的模型，可以从 UI 取初值
    let currentDesc = '';
    if (name === state.currentDetailsModelName) {
        currentDesc = dom.detailsModelDescription.innerText.replace('📝 ', '').replace('暂无介绍', '');
    }

    dom.editDescriptionInput.value = currentDesc;
    dom.editDescriptionModal.classList.remove('hidden');
    setTimeout(() => dom.editDescriptionInput.focus(), 100);
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

/*
* 业务：清空历史记录
*/
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

/**
 * 业务：删除单条历史记录
 */
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
            setTimeout(() => { if (dom.renameInput) dom.renameInput.focus(); }, 100);
        },
        (name, category) => openDeleteModal(name, category),
        (name) => openEditDescriptionModal(name)
    );

    // 详情页面：已训练模型展示 (允许重命名和删除，点击加载详情)
    ui.renderModelList(dom.trainedList, data.models.trained, 'trained', state.currentDetailsModelName,
        async (name) => {
            if (name === state.currentDetailsModelName) return;
            state.currentDetailsModelName = name;
            await loadModelDetails(name);
            await refreshApp(); // 刷新列表高亮
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

    // 识别页面：已训练模型展示 (允许识别切换，允许重命名和删除)
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


    // 给训练页面的基础模型下拉列表赋值
    ui.renderTrainBaseModels(data.models);

    // 多任务模式下，基础模型列表加载后需刷新任务卡片中的下拉框
    if (state.trainingMode === 'multi') {
        renderTaskList();
    }

    refreshHistory();
}

/** * 
 * 刷新历史记录列表
 * */
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

// ==========================================
// 训练相关业务逻辑 (YOLO Training)
// ==========================================

// uploadedDatasetPath 和 trainingPoller 已在文件开头定义
// 这里使用全局变量

// 处理训练集上传
async function handleDatasetUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    dom.trainDatasetName.innerText = '上传并解压中...';
    dom.uploadDatasetBtn.disabled = true;

    try {
        const res = await api.uploadDataset(file);
        const data = await res.json();

        if (res.ok && data.status === 'success') {
            uploadedDatasetPath = data.dataset_path;
            dom.trainDatasetName.innerText = `[就绪] ${file.name}`;
            dom.trainDatasetName.style.color = '#4ade80';
        } else {
            throw new Error(data.detail || '未知错误');
        }
    } catch (err) {
        alert(err.message);
        dom.trainDatasetName.innerText = '上传失败/格式错误';
        dom.trainDatasetName.style.color = '#f87171';
        dom.trainDatasetInput.value = '';
    } finally {
        dom.uploadDatasetBtn.disabled = false;
    }
}

// 收集训练参数
function collectTrainingParams() {
    return {
        epochs: document.getElementById('p_epochs').value,
        patience: document.getElementById('p_patience').value,
        batch: document.getElementById('p_batch').value,
        imgsz: document.getElementById('p_imgsz').value,
        optimizer: document.getElementById('p_optimizer').value,
        lr0: document.getElementById('p_lr0').value,
        lrf: document.getElementById('p_lrf').value,
        momentum: document.getElementById('p_momentum').value,
        weight_decay: document.getElementById('p_weight_decay').value,
        warmup_epochs: document.getElementById('p_warmup_epochs').value,
        warmup_momentum: document.getElementById('p_warmup_momentum').value,
        cos_lr: document.getElementById('p_cos_lr').checked,

        hsv_h: document.getElementById('p_hsv_h').value,
        hsv_s: document.getElementById('p_hsv_s').value,
        hsv_v: document.getElementById('p_hsv_v').value,
        degrees: document.getElementById('p_degrees').value,
        translate: document.getElementById('p_translate').value,
        scale: document.getElementById('p_scale').value,
        shear: document.getElementById('p_shear').value,
        perspective: document.getElementById('p_perspective').value,
        flipud: document.getElementById('p_flipud').value,
        fliplr: document.getElementById('p_fliplr').value,
        mosaic: document.getElementById('p_mosaic').value,
        mixup: document.getElementById('p_mixup').value,
        copy_paste: document.getElementById('p_copy_paste').value,

        seed: document.getElementById('p_seed').value,
        workers: document.getElementById('p_workers').value,
        device: document.getElementById('p_device').value,
        amp: document.getElementById('p_amp').checked
    };
}

// 加载训练参数到表单
function loadTrainingParams(params) {

    const mergedParams = { ...trainParams, ...params };

    // 设置数值和文本输入
    document.getElementById('p_epochs').value = mergedParams.epochs;
    document.getElementById('p_patience').value = mergedParams.patience;
    document.getElementById('p_batch').value = mergedParams.batch;
    document.getElementById('p_imgsz').value = mergedParams.imgsz;
    document.getElementById('p_optimizer').value = mergedParams.optimizer;
    document.getElementById('p_lr0').value = mergedParams.lr0;
    document.getElementById('p_lrf').value = mergedParams.lrf;
    document.getElementById('p_momentum').value = mergedParams.momentum;
    document.getElementById('p_weight_decay').value = mergedParams.weight_decay;
    document.getElementById('p_warmup_epochs').value = mergedParams.warmup_epochs;
    document.getElementById('p_warmup_momentum').value = mergedParams.warmup_momentum;
    document.getElementById('p_cos_lr').checked = mergedParams.cos_lr;

    document.getElementById('p_hsv_h').value = mergedParams.hsv_h;
    document.getElementById('p_hsv_s').value = mergedParams.hsv_s;
    document.getElementById('p_hsv_v').value = mergedParams.hsv_v;
    document.getElementById('p_degrees').value = mergedParams.degrees;
    document.getElementById('p_translate').value = mergedParams.translate;
    document.getElementById('p_scale').value = mergedParams.scale;
    document.getElementById('p_shear').value = mergedParams.shear;
    document.getElementById('p_perspective').value = mergedParams.perspective;
    document.getElementById('p_flipud').value = mergedParams.flipud;
    document.getElementById('p_fliplr').value = mergedParams.fliplr;
    document.getElementById('p_mosaic').value = mergedParams.mosaic;
    document.getElementById('p_mixup').value = mergedParams.mixup;
    document.getElementById('p_copy_paste').value = mergedParams.copy_paste;

    document.getElementById('p_seed').value = mergedParams.seed;
    document.getElementById('p_workers').value = mergedParams.workers;
    document.getElementById('p_device').value = mergedParams.device;
    document.getElementById('p_amp').checked = mergedParams.amp;
}

// 处理开始训练
async function handleStartTraining() {
    const baseModel = dom.trainBaseModel.value;
    const newModelName = dom.trainNewModelName.value.trim();
    const modelDescription = document.getElementById('trainModelDescription').value.trim();

    if (!baseModel) return alert("请先选择基础模型！");
    if (!newModelName) return alert("请填写新模型名称！");
    if (!uploadedDatasetPath) return alert("请先上传并成功解析您的训练集 (zip压缩包包括data.yaml)！");

    const params = collectTrainingParams();
    dom.startTrainBtn.disabled = true;
    dom.startTrainBtn.innerText = '准备工作中...';

    // 给后台一些反应时间显示准备中状态
    dom.trainingDashboard.style.display = 'block';
    dom.trainStatusLabel.innerText = "状态: 环境校验与初始化中...";
    dom.trainEtaLabel.innerText = "预计剩余时间: 计算中...";
    dom.trainProgressFill.style.width = '0%';
    dom.trainEpochLabel.innerText = `0 / ${params.epochs} Epochs`;

    //开始训练
    try {
        const res = await api.startTraining(newModelName, baseModel, uploadedDatasetPath, params, modelDescription);
        const data = await res.json();
        if (res.ok) {
            alert('训练任务已在后台启动！您可以从进度面板查看。');
            // 训练已启动，更新按钮为停止训练
            updateTrainButton('training');
            state.lastTrainingStatus = 'training';
        } else {
            alert(data.detail || '启动训练失败');
        }
    } catch (e) {
        alert('启动训练出错: ' + e.message);
    } finally {
        // 如果启动失败，恢复按钮
        if (state.lastTrainingStatus !== 'training') {
            dom.startTrainBtn.disabled = false;
            dom.startTrainBtn.innerText = '开始训练';
            dom.startTrainBtn.onclick = window.startTraining;
        }
    }
}

// 处理停止训练
async function handleStopTraining() {
    if (!confirm('确定要停止当前训练吗？停止后无法恢复。')) return;

    dom.startTrainBtn.disabled = true;
    dom.startTrainBtn.innerText = '停止中...';

    try {
        const result = await api.stopTraining();
        if (result.status === 'success') {
            alert('已发送停止训练信号，训练将尽快终止。');
        } else {
            alert('停止训练失败: ' + result.message);
        }
    } catch (e) {
        alert('请求出错: ' + e.message);
    } finally {
        // 按钮状态将由轮询器根据训练状态更新
    }
}

// 根据训练状态更新按钮
function updateTrainButton(status) {
    console.log(`updateTrainButton called with status: ${status}`);
    if (status === 'training') {
        dom.startTrainBtn.disabled = false;
        dom.startTrainBtn.innerText = '停止训练';
        dom.startTrainBtn.onclick = handleStopTraining;
        console.log('Button changed to: 停止训练');
    } else {
        dom.startTrainBtn.disabled = false;
        dom.startTrainBtn.innerText = '开始训练';
        dom.startTrainBtn.onclick = window.startTraining;
        console.log('Button changed to: 开始训练');
    }
}

// 启动训练状态轮询器
function startTrainingPoller() {
    if (trainingPoller) clearInterval(trainingPoller);

    // 初始加载时获取一次训练状态并更新按钮
    (async () => {
        try {
            const data = await api.getTrainingProgress();
            updateTrainButton(data.status);
        } catch (e) {
            console.warn("初始加载训练状态失败", e);
        }
    })();

    trainingPoller = setInterval(async () => {
        try {
            // 每 2 秒拉取一次训练状态并更新 UI
            const data = await api.getTrainingProgress();

            // 如果后端正在训练或刚结束，渲染 Dashboard
            if (data.status === 'training' || data.status === 'success' || data.status === 'error') {
                if (data.model_name) {
                    dom.trainingDashboard.style.display = 'block';

                    // 在多任务模式下，添加当前任务标题
                    if (state.trainingMode === 'multi' && multiTaskManager.isQueueRunning) {
                        const currentTask = multiTaskManager.getCurrentTask();
                        if (currentTask) {
                            data.taskTitle = currentTask.title;
                        }
                    }

                    ui.updateTrainingDashboard(data);
                }
            }

            // 根据训练状态更新按钮
            updateTrainButton(data.status);

            // 检测训练完成并弹出通知
            const isMultiQueueRunning = state.trainingMode === 'multi' && multiTaskManager.isQueueRunning;

            if (state.lastTrainingStatus === 'training' && data.status === 'success') {
                state.lastTrainingStatus = 'success';
                // 多任务队列运行中，由 waitForTaskCompletion 统一处理队列流转
                if (!isMultiQueueRunning) {
                    alert(`🎉 训练完成！新模型 "${data.model_name}" 已就绪。\n点击确认后将刷新页面以加载最新数据。`);
                    window.location.reload();
                }
            } else if (state.lastTrainingStatus === 'training' && data.status === 'error') {
                state.lastTrainingStatus = 'error';
                if (!isMultiQueueRunning) {
                    alert(`❌ 训练出错：${data.error_msg || '未知错误'}`);
                }
            } else if (state.lastTrainingStatus === 'training' && data.status === 'stopped') {
                state.lastTrainingStatus = 'stopped';
                if (!isMultiQueueRunning) {
                    alert('训练已停止。');
                }
            } else {
                // 平时同步状态
                state.lastTrainingStatus = data.status;
            }
        } catch (e) {
            console.warn("拉取训练状态失败", e);
        }
    }, 2000);
}

// 加载训练模型详细信息
async function loadModelDetails(modelName) {
    try {
        const res = await api.getTrainingHistory(modelName);
        if (res.status === 'success') {
            ui.renderModelDetails(res.data);
        } else {
            ui.renderModelDetails(null);
            alert(res.detail || '未找到该模型的训练记录');
        }
    } catch (e) {
        ui.renderModelDetails(null);
        alert('获取历史记录失败: ' + e.message);
    }
}

// ==========================================
// 多任务模式相关函数
// ==========================================

// 模式切换
function switchTrainingMode(mode) {
    if (mode === 'multi' && (state.lastTrainingStatus === 'training' || multiTaskManager.isQueueRunning)) {
        alert('当前有训练任务正在进行，请先停止训练');
        return;
    }

    if (mode === 'single' && multiTaskManager.tasks.length > 0) {
        // 从多任务切换到单任务，需要确认
        document.getElementById('switchModeMessage').textContent =
            '切换至单任务模式将清空当前多任务队列，是否继续？';
        document.getElementById('switchModeModal').classList.remove('hidden');
        window.pendingModeSwitch = mode;
        return;
    }

    // 直接切换模式时，不清空队列（因为已经检查过队列为空）
    applyTrainingMode(mode, false);
}

// 应用训练模式
function applyTrainingMode(mode, clearQueue = true) {
    const singleTaskBtn = document.getElementById('singleTaskModeBtn');
    const multiTaskBtn = document.getElementById('multiTaskModeBtn');
    const singleTaskContainer = document.querySelector('.training-controls');
    const multiTaskContainer = document.getElementById('multiTaskContainer');
    const multiTaskControls = document.querySelector('.multi-task-controls');

    // 安全检查：如果必要元素不存在，直接返回
    if (!singleTaskBtn || !multiTaskBtn || !singleTaskContainer || !multiTaskContainer || !multiTaskControls) {
        console.warn('训练模式切换相关元素未找到，跳过初始化');
        return;
    }

    if (mode === 'single') {
        singleTaskBtn.classList.add('active');
        multiTaskBtn.classList.remove('active');
        singleTaskContainer.style.display = 'flex';
        multiTaskContainer.style.display = 'none';
        multiTaskControls.style.display = 'none';

        // 根据参数决定是否清空多任务队列
        if (clearQueue) {
            multiTaskManager.clearQueue();
        }
        state.trainingMode = 'single';
    } else {
        singleTaskBtn.classList.remove('active');
        multiTaskBtn.classList.add('active');
        singleTaskContainer.style.display = 'none';
        multiTaskContainer.style.display = 'block';
        multiTaskControls.style.display = 'flex';

        // 如果任务列表为空，创建默认任务
        if (multiTaskManager.tasks.length === 0) {
            multiTaskManager.addTask();
        }

        // 初始化多任务界面
        renderTaskList();
        updateQueueControls();
        state.trainingMode = 'multi';
    }
}

// 渲染任务列表
function renderTaskList() {
    const taskList = document.getElementById('taskList');
    taskList.innerHTML = '';

    multiTaskManager.tasks.forEach((task, index) => {
        const template = document.getElementById('taskCardTemplate');
        const clone = template.content.cloneNode(true);
        const taskCard = clone.querySelector('.task-card');

        // 设置任务索引
        taskCard.dataset.taskIndex = index;

        // 更新任务标题
        const title = taskCard.querySelector('.task-title');
        title.textContent = task.title;

        // 更新模型来源选择
        const modelSourceSelect = taskCard.querySelector('.model-source-select');
        modelSourceSelect.value = task.modelSource;

        // 如果是第一个任务，禁用"承接上个任务的模型"选项
        if (index === 0) {
            modelSourceSelect.innerHTML = '<option value="existing">使用现有模型</option>';
        } else {
            modelSourceSelect.innerHTML = `
                <option value="existing">使用现有模型</option>
                <option value="previous">承接上个任务的模型</option>
            `;
            modelSourceSelect.value = task.modelSource;
        }

        // 更新基础模型选择
        const baseModelSelect = taskCard.querySelector('.base-model-select');
        // 从主训练页面的基础模型下拉列表复制选项
        baseModelSelect.innerHTML = '';
        if (dom.trainBaseModel && dom.trainBaseModel.options) {
            for (let option of dom.trainBaseModel.options) {
                const newOption = document.createElement('option');
                newOption.value = option.value;
                newOption.textContent = option.textContent;
                if (option.value === task.baseModel) {
                    newOption.selected = true;
                }
                baseModelSelect.appendChild(newOption);
            }
        }
        // 设置当前选择的值
        if (task.baseModel) {
            baseModelSelect.value = task.baseModel;
        }

        // 更新模型来源相关显示
        updateModelSourceDisplay(taskCard, task.modelSource);

        // 更新新模型名称
        const newModelName = taskCard.querySelector('.new-model-name');
        newModelName.value = task.newModelName;

        // 更新模型介绍
        const modelDescription = taskCard.querySelector('.model-description');
        modelDescription.value = task.description;

        // 更新数据集名称
        const datasetName = taskCard.querySelector('.dataset-name');
        datasetName.textContent = task.datasetName;

        // 更新任务状态
        const taskStatus = taskCard.querySelector('.task-status');
        const statusText = taskCard.querySelector('.status-text');
        const progressText = taskCard.querySelector('.progress-text');

        if (task.status !== 'pending') {
            taskStatus.style.display = 'block';

            let status = '';
            let progress = '';

            switch(task.status) {
                case 'running':
                    status = '训练中';
                    progress = `${task.progress}/${task.totalEpochs}`;
                    taskCard.classList.add('running');
                    break;
                case 'completed':
                    status = '已完成';
                    progress = '✓';
                    taskCard.classList.add('completed');
                    break;
                case 'failed':
                    status = '失败';
                    progress = '✗';
                    taskCard.classList.add('failed');
                    break;
            }

            statusText.textContent = `状态: ${status}`;
            progressText.textContent = progress;
        }

        // 如果队列运行中，禁用编辑和删除
        if (multiTaskManager.isQueueRunning) {
            taskCard.querySelector('.task-delete-btn').disabled = true;
            taskCard.querySelectorAll('input, select, button').forEach(el => {
                if (!el.classList.contains('task-delete-btn')) {
                    el.disabled = true;
                }
            });
        }

        // 如果是当前正在运行的任务，添加高亮样式
        if (multiTaskManager.isQueueRunning && index === multiTaskManager.currentTaskIndex) {
            taskCard.classList.add('current-task');
        }

        // 绑定事件
        const deleteBtn = taskCard.querySelector('.task-delete-btn');
        deleteBtn.onclick = () => deleteTaskByIndex(index);

        const modelSourceSelectEl = taskCard.querySelector('.model-source-select');
        modelSourceSelectEl.onchange = (e) => {
            multiTaskManager.updateTask(index, { modelSource: e.target.value });
            updateModelSourceDisplay(taskCard, e.target.value);
        };

        baseModelSelect.onchange = (e) => {
            multiTaskManager.updateTask(index, { baseModel: e.target.value });
        };

        const newModelNameInput = taskCard.querySelector('.new-model-name');
        newModelNameInput.onchange = (e) => {
            multiTaskManager.updateTask(index, { newModelName: e.target.value });
        };

        const modelDescriptionInput = taskCard.querySelector('.model-description');
        modelDescriptionInput.onchange = (e) => {
            multiTaskManager.updateTask(index, { description: e.target.value });
        };

        const uploadDatasetBtn = taskCard.querySelector('.upload-dataset-btn');
        const datasetInput = taskCard.querySelector('.dataset-input');
        uploadDatasetBtn.onclick = () => datasetInput.click();

        datasetInput.onchange = (e) => handleMultiTaskDatasetUpload(e, index);

        const openParamsBtn = taskCard.querySelector('.open-params-btn');
        openParamsBtn.onclick = () => openMultiTaskParamsModal(index);

        taskList.appendChild(taskCard);
    });

    // 更新任务计数
    document.getElementById('taskCount').textContent = multiTaskManager.tasks.length;

    // 更新提示
    const hint = document.getElementById('multiTaskHint');
    if (multiTaskManager.tasks.length >= MAX_TRAINING_TASKS) {
        hint.textContent = `已达到最大任务数(${MAX_TRAINING_TASKS}个)`;
    } else {
        hint.textContent = `默认显示"任务一"，新增任务会按顺序编号`;
    }
}

// 更新模型来源显示
function updateModelSourceDisplay(taskCard, modelSource) {
    const existingSection = taskCard.querySelector('.model-source-existing');
    const previousSection = taskCard.querySelector('.model-source-previous');

    if (modelSource === 'existing') {
        existingSection.style.display = '';
        previousSection.style.display = 'none';
    } else {
        existingSection.style.display = 'none';
        previousSection.style.display = '';
    }
}

// 添加训练任务
function addTrainingTask() {
    if (multiTaskManager.isQueueRunning) {
        alert('队列运行中，请先停止');
        return;
    }

    if (multiTaskManager.tasks.length >= 6) {
        alert('最多支持6个任务');
        return;
    }

    const newTask = multiTaskManager.addTask();
    if (newTask) {
        renderTaskList();
        updateQueueControls();
    }
}

// 删除任务
function deleteTask(button) {
    const taskCard = button.closest('.task-card');
    const index = parseInt(taskCard.dataset.taskIndex);
    deleteTaskByIndex(index);
}

function deleteTaskByIndex(index) {
    if (multiTaskManager.deleteTask(index)) {
        renderTaskList();
        updateQueueControls();
    }
}

// 多任务数据集上传
async function handleMultiTaskDatasetUpload(e, taskIndex) {
    const file = e.target.files[0];
    if (!file) return;

    const taskCard = document.querySelector(`.task-card[data-task-index="${taskIndex}"]`);
    const datasetName = taskCard.querySelector('.dataset-name');
    datasetName.textContent = '上传并解压中...';
    datasetName.style.color = '#fbbf24';

    try {
        const res = await api.uploadDataset(file);
        const data = await res.json();

        if (res.ok && data.status === 'success') {
            multiTaskManager.updateTask(taskIndex, {
                datasetPath: data.dataset_path,
                datasetName: `[就绪] ${file.name}`
            });

            datasetName.textContent = `[就绪] ${file.name}`;
            datasetName.style.color = '#4ade80';
        } else {
            throw new Error(data.detail || '未知错误');
        }
    } catch (err) {
        alert(err.message);
        datasetName.textContent = '上传失败/格式错误';
        datasetName.style.color = '#f87171';
        e.target.value = '';

        multiTaskManager.updateTask(taskIndex, {
            datasetPath: '',
            datasetName: '未选择'
        });
    }
}

// 打开多任务参数模态框
function openMultiTaskParamsModal(taskIndex) {
    editingTaskParamsIndex = taskIndex;

    const task = multiTaskManager.tasks[taskIndex];
    const taskParams = task ? task.parameters : {};

    window.openTrainingParamsModal();

    setTimeout(() => {
        loadTrainingParams(taskParams);
    }, 10);
}

// 开始队列训练
async function startQueueTraining() {
    if (multiTaskManager.isQueueRunning) {
        // 如果是运行中，点击则停止
        document.getElementById('stopQueueModal').classList.remove('hidden');
        return;
    }

    if (await multiTaskManager.startQueue()) {
        updateQueueControls();
        renderTaskList();

        // 开始执行第一个任务
        executeNextTaskInQueue();
    }
}

// 执行队列中的下一个任务
async function executeNextTaskInQueue() {
    const currentTask = multiTaskManager.getCurrentTask();
    if (!currentTask) {
        // 所有任务完成
        alert('所有训练任务已完成！');
        updateQueueControls();
        return;
    }

    // 更新当前任务状态
    multiTaskManager.updateTask(multiTaskManager.currentTaskIndex, {
        status: 'running'
    });

    renderTaskList();

    try {
        // 获取基础模型
        let baseModel = '';
        if (currentTask.modelSource === 'existing') {
            baseModel = currentTask.baseModel;
        } else if (currentTask.modelSource === 'previous' && multiTaskManager.currentTaskIndex > 0) {
            // 承接上一个任务的模型
            const prevTask = multiTaskManager.tasks[multiTaskManager.currentTaskIndex - 1];
            baseModel = prevTask.newModelName + '.pt';
        } else {
            throw new Error('无效的模型来源配置');
        }

        // 开始训练
        const res = await api.startTraining(
            currentTask.newModelName,
            baseModel,
            currentTask.datasetPath,
            currentTask.parameters,
            currentTask.description
        );

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || '启动训练失败');
        }

        // 等待训练完成
        await waitForTaskCompletion();

    } catch (error) {
        // 任务失败
        multiTaskManager.taskFailed(multiTaskManager.currentTaskIndex, error.message);

        document.getElementById('taskFailedMessage').textContent =
            `任务 ${multiTaskManager.currentTaskIndex + 1} 失败: ${error.message}`;
        document.getElementById('taskFailedModal').classList.remove('hidden');

        updateQueueControls();
        renderTaskList();
    }
}

// 等待任务完成
async function waitForTaskCompletion() {
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(async () => {
            try {
                const data = await api.getTrainingProgress();

                if (data.status === 'success') {
                    clearInterval(checkInterval);

                    // 更新当前任务状态
                    const currentTask = multiTaskManager.getCurrentTask();
                    if (currentTask) {
                        multiTaskManager.updateTask(multiTaskManager.currentTaskIndex, {
                            status: 'completed',
                            progress: data.progress || currentTask.totalEpochs,
                            totalEpochs: data.total || currentTask.totalEpochs
                        });
                    }

                    // 移动到下一个任务
                    multiTaskManager.moveToNextTask();
                    renderTaskList();

                    if (multiTaskManager.isQueueRunning) {
                        // 继续执行下一个任务
                        executeNextTaskInQueue();
                    } else {
                        // 队列完成
                        updateQueueControls();
                    }

                    resolve();

                } else if (data.status === 'error' || data.status === 'stopped') {
                    clearInterval(checkInterval);

                    let errorMsg = data.error_msg || '训练失败';
                    if (data.status === 'stopped') {
                        errorMsg = '训练被停止';
                    }

                    // 任务失败
                    multiTaskManager.taskFailed(multiTaskManager.currentTaskIndex, errorMsg);

                    document.getElementById('taskFailedMessage').textContent =
                        `任务 ${multiTaskManager.currentTaskIndex + 1} 失败: ${errorMsg}`;
                    document.getElementById('taskFailedModal').classList.remove('hidden');

                    updateQueueControls();
                    renderTaskList();
                    reject(new Error(errorMsg));
                }

            } catch (error) {
                clearInterval(checkInterval);
                reject(error);
            }
        }, 2000);
    });
}

// 停止队列训练
function stopQueueTraining() {
    if (!multiTaskManager.isQueueRunning) return;

    document.getElementById('stopQueueModal').classList.remove('hidden');
}

// 确认停止队列
async function confirmStopQueue() {
    document.getElementById('stopQueueModal').classList.add('hidden');

    // 停止当前训练
    try {
        const result = await api.stopTraining();
        if (result.status !== 'success') {
            alert('停止训练失败: ' + result.message);
        }
    } catch (e) {
        console.error('停止训练请求失败:', e);
    }

    // 停止队列
    multiTaskManager.stopQueue();
    updateQueueControls();
    renderTaskList();
}

// 更新队列控制按钮状态
function updateQueueControls() {
    const addTaskBtn = document.getElementById('addTaskBtn');
    const queueStartBtn = document.getElementById('queueStartBtn');

    if (!addTaskBtn || !queueStartBtn) return;

    if (multiTaskManager.isQueueRunning) {
        addTaskBtn.disabled = true;
        addTaskBtn.title = '队列运行中，请先停止';
        queueStartBtn.textContent = '停止队列';
        queueStartBtn.classList.remove('success');
        queueStartBtn.classList.add('danger');
    } else {
        addTaskBtn.disabled = multiTaskManager.tasks.length >= 6;
        addTaskBtn.title = multiTaskManager.tasks.length >= 6 ? '最多支持6个任务' : '增加训练任务';
        queueStartBtn.textContent = '队列开始训练';
        queueStartBtn.classList.remove('danger');
        queueStartBtn.classList.add('success');
        queueStartBtn.disabled = multiTaskManager.tasks.length === 0;
    }
}

// 模态框控制函数
function closeStopQueueModal() {
    document.getElementById('stopQueueModal').classList.add('hidden');
}

function closeTaskFailedModal() {
    document.getElementById('taskFailedModal').classList.add('hidden');
}

function cancelSwitchMode() {
    document.getElementById('switchModeModal').classList.add('hidden');
    delete window.pendingModeSwitch;
}

function confirmSwitchMode() {
    document.getElementById('switchModeModal').classList.add('hidden');
    if (window.pendingModeSwitch) {
        // 确认切换模式时，需要清空队列
        applyTrainingMode(window.pendingModeSwitch, true);
        delete window.pendingModeSwitch;
    }
}
