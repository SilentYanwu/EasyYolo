/**
 * 训练模块：单任务训练 + 多任务队列训练
 */
import { dom } from './dom.js';
import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';
import { MAX_TRAINING_TASKS,TRAINING_POLL_INTERVAL, QUEUE_POLL_INTERVAL } from './config.js';
import { showMessage, showConfirm, showThreeChoice } from './modals.js';

// ===== 默认训练参数 =====
export const trainParams = {
    epochs: 50,
    patience: 20,
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

// ===== 模块级状态 =====
let uploadedDatasetPath = "";       // 当前单任务模式下已上传的数据集路径
let trainingPoller = null;          // 训练状态轮询定时器 ID
let editingTaskParamsIndex = -1;    // 正在编辑参数的任务索引，-1 表示单任务模式

// ===== 多任务管理器 =====
/** 多任务队列：管理任务增删、队列启停、本地持久化 */
export const multiTaskManager = {
    tasks: [],
    currentTaskIndex: -1,
    isQueueRunning: false,
    queueStatus: 'idle',

    /** 初始化/重置任务队列，从 localStorage 恢复 */
    init() {
        this.tasks = [];
        this.currentTaskIndex = -1;
        this.isQueueRunning = false;
        this.queueStatus = 'idle';
        this.loadFromStorage();
    },

    /** 从 localStorage 恢复队列状态 */
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

    /** 将队列状态持久化到 localStorage */
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

    /** 创建带默认参数的新任务对象 */
    createTask(index) {
        const chineseNumbers = ['一', '二', '三', '四', '五', '六'];
        const chineseIndex = index <= 6 ? chineseNumbers[index - 1] : index;
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
            parameters: { ...trainParams },
            status: 'pending',
            progress: 0,
            totalEpochs: 0,
            errorMessage: ''
        };
    },

    /** 向队列末尾添加一个任务 */
    addTask() {
        if (this.tasks.length >= MAX_TRAINING_TASKS) {
            showMessage(`最多支持${MAX_TRAINING_TASKS}个任务`, 'warning');
            return false;
        }
        const newIndex = this.tasks.length + 1;
        const newTask = this.createTask(newIndex);
        this.tasks.push(newTask);
        this.saveToStorage();
        return newTask;
    },

    /** 删除指定任务，自动修复后续任务的依赖关系 */
    deleteTask(index) {
        if (this.isQueueRunning) {
            showMessage('队列运行中，请先停止', 'warning');
            return false;
        }
        if (index < 0 || index >= this.tasks.length) return false;
        for (let i = index + 1; i < this.tasks.length; i++) {
            if (this.tasks[i].modelSource === 'previous') {
                showMessage(`任务${i+1}的模型来源指向已删除的任务，请重新选择模型来源`, 'warning');
                this.tasks[i].modelSource = 'existing';
                this.tasks[i].baseModel = '';
            }
        }
        this.tasks.splice(index, 1);
        this.tasks.forEach((task, idx) => {
            task.index = idx + 1;
            const chineseNumbers = ['一', '二', '三', '四', '五', '六'];
            const chineseIndex = idx + 1 <= 6 ? chineseNumbers[idx] : idx + 1;
            task.title = `任务${chineseIndex}`;
        });
        this.saveToStorage();
        return true;
    },

    /** 更新指定任务的字段，对 parameters 做深拷贝 */
    updateTask(index, updates) {
        if (index < 0 || index >= this.tasks.length) return false;
        if (updates.parameters) {
            updates = { ...updates, parameters: { ...updates.parameters } };
        }
        Object.assign(this.tasks[index], updates);
        this.saveToStorage();
        return true;
    },

    /** 校验所有任务并启动队列 */
    async startQueue() {
        if (this.isQueueRunning) return false;
        if (this.tasks.length === 0) {
            showMessage('请至少添加一个任务', 'warning');
            return false;
        }
        for (let i = 0; i < this.tasks.length; i++) {
            const task = this.tasks[i];
            if (!task.newModelName.trim()) {
                showMessage(`任务${i+1}的新模型名称不能为空`, 'warning');
                return false;
            }
            if (!task.datasetPath) {
                showMessage(`任务${i+1}的数据集未上传`, 'warning');
                return false;
            }
            if (task.modelSource === 'existing' && !task.baseModel) {
                showMessage(`任务${i+1}的基础模型未选择`, 'warning');
                return false;
            }
        }
        this.isQueueRunning = true;
        this.currentTaskIndex = 0;
        this.queueStatus = 'running';
        this.saveToStorage();
        return true;
    },

    /** 停止队列并将所有任务重置为 pending */
    stopQueue() {
        if (!this.isQueueRunning) return false;
        this.isQueueRunning = false;
        this.queueStatus = 'stopped';
        this.tasks.forEach(task => {
            task.status = 'pending';
            task.progress = 0;
            task.errorMessage = '';
        });
        this.currentTaskIndex = -1;
        this.saveToStorage();
        return true;
    },

    /** 标记当前任务失败并停止整个队列 */
    taskFailed(taskIndex, errorMessage) {
        this.isQueueRunning = false;
        this.queueStatus = 'error';
        if (taskIndex >= 0 && taskIndex < this.tasks.length) {
            this.tasks[taskIndex].status = 'failed';
            this.tasks[taskIndex].errorMessage = errorMessage;
        }
        this.tasks.forEach((task, idx) => {
            if (idx !== taskIndex) {
                task.status = 'pending';
                task.progress = 0;
            }
        });
        this.currentTaskIndex = -1;
        this.saveToStorage();
    },

    /** 获取当前正在执行的任务，无则返回 null */
    getCurrentTask() {
        if (this.currentTaskIndex >= 0 && this.currentTaskIndex < this.tasks.length) {
            return this.tasks[this.currentTaskIndex];
        }
        return null;
    },

    /** 将当前任务标记为完成，指针移到下一个任务 */
    moveToNextTask() {
        if (this.currentTaskIndex >= 0 && this.currentTaskIndex < this.tasks.length) {
            this.tasks[this.currentTaskIndex].status = 'completed';
        }
        this.currentTaskIndex++;
        if (this.currentTaskIndex >= this.tasks.length) {
            this.isQueueRunning = false;
            this.queueStatus = 'completed';
            this.currentTaskIndex = -1;
        }
        this.saveToStorage();
        return this.currentTaskIndex;
    },

    /** 清空所有任务并移除 localStorage */
    clearQueue() {
        this.tasks = [];
        this.currentTaskIndex = -1;
        this.isQueueRunning = false;
        this.queueStatus = 'idle';
        localStorage.removeItem('multiTaskQueue');
    }
};

// ===== 数据集上传 =====

/** 处理数据集文件选择，检查重名后上传 */
export async function handleDatasetUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const datasetName = file.name.replace(/\.zip$/i, '');

    try {
        const { datasets } = await api.getDatasets();
        const existing = datasets && datasets.find(d => d.name === datasetName);
        if (existing) {
            showThreeChoice(
                `数据集 "${datasetName}" 已存在，请选择处理方式：`,
                'warning',
                '是，覆盖', () => doUploadDataset(file, e.target),
                '否，直接用', () => {
                    uploadedDatasetPath = existing.path;
                    dom.trainDatasetName.innerText = `[就绪] ${datasetName} (使用已有)`;
                    dom.trainDatasetName.style.color = '#4ade80';
                    e.target.value = '';
                },
                '取消', () => { e.target.value = ''; }
            );
            return;
        }
    } catch (_) { /* 检查失败不影响上传 */ }

    doUploadDataset(file, e.target);
}

/** 上传数据集 zip 到后端并更新 UI */
async function doUploadDataset(file, inputEl) {
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
        showMessage(err.message, 'warning');
        dom.trainDatasetName.innerText = '上传失败/格式错误';
        dom.trainDatasetName.style.color = '#f87171';
        inputEl.value = '';
    } finally {
        dom.uploadDatasetBtn.disabled = false;
    }
}

// ===== 训练参数收集与加载 =====

/** 从训练参数表单收集所有参数 */
export function collectTrainingParams() {
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

/** 将参数对象回填到训练参数表单 */
export function loadTrainingParams(params) {
    const mergedParams = { ...trainParams, ...params };

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

// ===== 单任务训练 =====

/** 校验输入并向后端发起训练请求 */
export async function handleStartTraining() {
    const baseModel = dom.trainBaseModel.value;
    const newModelName = dom.trainNewModelName.value.trim();
    const modelDescription = document.getElementById('trainModelDescription').value.trim();

    if (!baseModel) return showMessage("请先选择基础模型！", 'warning');
    if (!newModelName) return showMessage("请填写新模型名称！", 'warning');
    if (!uploadedDatasetPath) return showMessage("请先上传并成功解析您的训练集 (zip压缩包包括data.yaml)！", 'warning');

    const params = collectTrainingParams();
    dom.startTrainBtn.disabled = true;
    dom.startTrainBtn.innerText = '准备工作中...';

    dom.trainingDashboard.style.display = 'block';
    dom.trainStatusLabel.innerText = "状态: 环境校验与初始化中...";
    dom.trainEtaLabel.innerText = "预计剩余时间: 计算中...";
    dom.trainProgressFill.style.width = '0%';
    dom.trainEpochLabel.innerText = `0 / ${params.epochs} Epochs`;

    try {
        const res = await api.startTraining(newModelName, baseModel, uploadedDatasetPath, params, modelDescription);
        const data = await res.json();
        if (res.ok) {
            showMessage('训练任务已在后台启动！您可以从进度面板查看。', 'success');
            updateTrainButton('training');
            state.lastTrainingStatus = 'training';
        } else {
            showMessage(data.detail || '启动训练失败', 'warning');
        }
    } catch (e) {
        showMessage('启动训练出错: ' + e.message, 'warning');
    } finally {
        if (state.lastTrainingStatus !== 'training') {
            dom.startTrainBtn.disabled = false;
            dom.startTrainBtn.innerText = '开始训练';
            dom.startTrainBtn.onclick = window.startTraining;
        }
    }
}

/** 向用户确认后发送停止训练信号 */
async function handleStopTraining() {
    showConfirm('确定要停止当前训练吗？停止后无法恢复。', 'warning', async () => {
        dom.startTrainBtn.disabled = true;
        dom.startTrainBtn.innerText = '停止中...';

        try {
            const result = await api.stopTraining();
            if (result.status === 'success') {
                showMessage('已发送停止训练信号，训练将尽快终止。', 'info');
            } else {
                showMessage('停止训练失败: ' + result.message, 'warning');
            }
        } catch (e) {
            showMessage('请求出错: ' + e.message, 'warning');
        }
    });
}

/** 根据训练状态切换按钮为"开始训练"或"停止训练" */
export function updateTrainButton(status) {
    if (status === 'training') {
        dom.startTrainBtn.disabled = false;
        dom.startTrainBtn.innerText = '停止训练';
        dom.startTrainBtn.onclick = handleStopTraining;
    } else {
        dom.startTrainBtn.disabled = false;
        dom.startTrainBtn.innerText = '开始训练';
        dom.startTrainBtn.onclick = window.startTraining;
    }
}

// ===== 训练状态轮询 =====

/** 启动 固定时间间隔的训练状态轮询，更新 Dashboard 和按钮状态 */
export function startTrainingPoller() {
    if (trainingPoller) clearInterval(trainingPoller);

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
            const data = await api.getTrainingProgress();

            if (data.status === 'training' || data.status === 'success' || data.status === 'error') {
                if (data.model_name) {
                    dom.trainingDashboard.style.display = 'block';

                    if (state.trainingMode === 'multi' && multiTaskManager.isQueueRunning) {
                        const currentTask = multiTaskManager.getCurrentTask();
                        if (currentTask) {
                            data.taskTitle = currentTask.title;
                        }
                    }

                    ui.updateTrainingDashboard(data);
                }
            }

            updateTrainButton(data.status);

            const isMultiQueueRunning = state.trainingMode === 'multi' && multiTaskManager.isQueueRunning;

            if (state.lastTrainingStatus === 'training' && data.status === 'success') {
                state.lastTrainingStatus = 'success';
                if (!isMultiQueueRunning) {
                    const detail = data.early_stopped
                        ? `早停轮次: 第 ${data.early_stop_epoch}/${data.total} 轮 (连续多轮指标无提升，自动停止)`
                        : '';
                    const msg = data.early_stopped
                        ? `训练早停完成！新模型 "${data.model_name}" 已就绪。\n${detail}`
                        : `训练完成！新模型 "${data.model_name}" 已就绪。`;
                    showMessage(msg, 'success', () => window.location.reload());
                }
            } else if (state.lastTrainingStatus === 'training' && data.status === 'error') {
                state.lastTrainingStatus = 'error';
                if (!isMultiQueueRunning) {
                    showMessage(`训练出错：${data.error_msg || '未知错误'}`, 'warning');
                }
            } else if (state.lastTrainingStatus === 'training' && data.status === 'stopped') {
                state.lastTrainingStatus = 'stopped';
                if (!isMultiQueueRunning) {
                    showMessage('训练已停止。', 'info');
                }
            } else {
                state.lastTrainingStatus = data.status;
            }
        } catch (e) {
            console.warn("拉取训练状态失败", e);
        }
    }, TRAINING_POLL_INTERVAL);
}

// ===== 模型详情加载 =====

/** 获取指定模型的训练历史并渲染详情面板 */
export async function loadModelDetails(modelName) {
    try {
        const res = await api.getTrainingHistory(modelName);
        if (res.status === 'success') {
            ui.renderModelDetails(res.data);
        } else {
            ui.renderModelDetails(null);
            showMessage(res.detail || '未找到该模型的训练记录', 'warning');
        }
    } catch (e) {
        ui.renderModelDetails(null);
        showMessage('获取历史记录失败: ' + e.message, 'warning');
    }
}

// ===== 多任务模式切换 =====

/** 切换单任务/多任务模式，带训练中保护和队列清空确认 */
export function switchTrainingMode(mode) {
    if (mode === 'multi' && (state.lastTrainingStatus === 'training' || multiTaskManager.isQueueRunning)) {
        showMessage('当前有训练任务正在进行，请先停止训练', 'warning');
        return;
    }

    if (mode === 'single' && multiTaskManager.tasks.length > 0) {
        showConfirm('切换至单任务模式将清空当前多任务队列，是否继续？', 'warning', () => {
            applyTrainingMode(mode, true);
        });
        return;
    }

    applyTrainingMode(mode, false);
}

/** 应用训练模式的 UI 切换（单/多任务容器显隐） */
export function applyTrainingMode(mode, clearQueue = true) {
    const singleTaskBtn = document.getElementById('singleTaskModeBtn');
    const multiTaskBtn = document.getElementById('multiTaskModeBtn');
    const singleTaskContainer = document.querySelector('.training-controls');
    const multiTaskContainer = document.getElementById('multiTaskContainer');
    const multiTaskControls = document.querySelector('.multi-task-controls');

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

        if (multiTaskManager.tasks.length === 0) {
            multiTaskManager.addTask();
        }

        renderTaskList();
        updateQueueControls();
        state.trainingMode = 'multi';
    }
}

// ===== 任务列表渲染 =====

/** 渲染多任务卡片列表，绑定各任务的编辑、上传、删除事件 */
export function renderTaskList() {
    const taskList = document.getElementById('taskList');
    taskList.innerHTML = '';

    multiTaskManager.tasks.forEach((task, index) => {
        const template = document.getElementById('taskCardTemplate');
        const clone = template.content.cloneNode(true);
        const taskCard = clone.querySelector('.task-card');

        taskCard.dataset.taskIndex = index;

        const title = taskCard.querySelector('.task-title');
        title.textContent = task.title;

        const modelSourceSelect = taskCard.querySelector('.model-source-select');
        modelSourceSelect.value = task.modelSource;

        if (index === 0) {
            modelSourceSelect.innerHTML = '<option value="existing">使用现有模型</option>';
        } else {
            modelSourceSelect.innerHTML = `
                <option value="existing">使用现有模型</option>
                <option value="previous">承接上个任务的模型</option>
            `;
            modelSourceSelect.value = task.modelSource;
        }

        const baseModelSelect = taskCard.querySelector('.base-model-select');
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
        if (task.baseModel) {
            baseModelSelect.value = task.baseModel;
        }

        updateModelSourceDisplay(taskCard, task.modelSource);

        const newModelName = taskCard.querySelector('.new-model-name');
        newModelName.value = task.newModelName;

        const modelDescription = taskCard.querySelector('.model-description');
        modelDescription.value = task.description;

        const datasetName = taskCard.querySelector('.dataset-name');
        datasetName.textContent = task.datasetName;

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

        if (multiTaskManager.isQueueRunning) {
            taskCard.querySelector('.task-delete-btn').disabled = true;
            taskCard.querySelectorAll('input, select, button').forEach(el => {
                if (!el.classList.contains('task-delete-btn')) {
                    el.disabled = true;
                }
            });
        }

        if (multiTaskManager.isQueueRunning && index === multiTaskManager.currentTaskIndex) {
            taskCard.classList.add('current-task');
        }

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

    document.getElementById('taskCount').textContent = multiTaskManager.tasks.length;

    const hint = document.getElementById('multiTaskHint');
    if (multiTaskManager.tasks.length >= MAX_TRAINING_TASKS) {
        hint.textContent = `已达到最大任务数(${MAX_TRAINING_TASKS}个)`;
    } else {
        hint.textContent = `默认显示"任务一"，新增任务会按顺序编号`;
    }
}

/** 根据模型来源选项切换任务卡片中的相关 UI 区域 */
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

// ===== 多任务增删 =====

/** 添加一个训练任务到队列（UI 按钮入口） */
export function addTrainingTask() {
    if (multiTaskManager.isQueueRunning) {
        showMessage('队列运行中，请先停止', 'warning');
        return;
    }

    if (multiTaskManager.tasks.length >= 6) {
        showMessage('最多支持6个任务', 'warning');
        return;
    }

    const newTask = multiTaskManager.addTask();
    if (newTask) {
        renderTaskList();
        updateQueueControls();
    }
}

/** 通过卡片删除按钮删除任务（DOM 事件入口） */
export function deleteTask(button) {
    const taskCard = button.closest('.task-card');
    const index = parseInt(taskCard.dataset.taskIndex);
    deleteTaskByIndex(index);
}

/** 按索引删除任务并刷新列表 */
function deleteTaskByIndex(index) {
    if (multiTaskManager.deleteTask(index)) {
        renderTaskList();
        updateQueueControls();
    }
}

// ===== 多任务数据集上传 =====

/** 多任务模式下处理数据集文件选择，检查重名 */
async function handleMultiTaskDatasetUpload(e, taskIndex) {
    const file = e.target.files[0];
    if (!file) return;

    const datasetName = file.name.replace(/\.zip$/i, '');

    try {
        const { datasets } = await api.getDatasets();
        const existing = datasets && datasets.find(d => d.name === datasetName);
        if (existing) {
            showThreeChoice(
                `数据集 "${datasetName}" 已存在，请选择处理方式：`,
                'warning',
                '是，覆盖', () => doMultiTaskUpload(file, taskIndex, e.target),
                '否，直接用', () => {
                    multiTaskManager.updateTask(taskIndex, {
                        datasetPath: existing.path,
                        datasetName: `[就绪] ${datasetName} (使用已有)`
                    });
                    const taskCard = document.querySelector(`.task-card[data-task-index="${taskIndex}"]`);
                    if (taskCard) {
                        const datasetNameEl = taskCard.querySelector('.dataset-name');
                        if (datasetNameEl) {
                            datasetNameEl.textContent = `[就绪] ${datasetName} (使用已有)`;
                            datasetNameEl.style.color = '#4ade80';
                        }
                    }
                    e.target.value = '';
                },
                '取消', () => { e.target.value = ''; }
            );
            return;
        }
    } catch (_) { /* 检查失败不影响上传 */ }

    doMultiTaskUpload(file, taskIndex, e.target);
}

/** 上传多任务数据集并更新对应任务卡片的 UI */
async function doMultiTaskUpload(file, taskIndex, inputEl) {
    const taskCard = document.querySelector(`.task-card[data-task-index="${taskIndex}"]`);
    const datasetNameEl = taskCard.querySelector('.dataset-name');
    datasetNameEl.textContent = '上传并解压中...';
    datasetNameEl.style.color = '#fbbf24';

    try {
        const res = await api.uploadDataset(file);
        const data = await res.json();

        if (res.ok && data.status === 'success') {
            multiTaskManager.updateTask(taskIndex, {
                datasetPath: data.dataset_path,
                datasetName: `[就绪] ${file.name}`
            });

            datasetNameEl.textContent = `[就绪] ${file.name}`;
            datasetNameEl.style.color = '#4ade80';
        } else {
            throw new Error(data.detail || '未知错误');
        }
    } catch (err) {
        showMessage(err.message, 'warning');
        datasetNameEl.textContent = '上传失败/格式错误';
        datasetNameEl.style.color = '#f87171';
        inputEl.value = '';

        multiTaskManager.updateTask(taskIndex, {
            datasetPath: '',
            datasetName: '未选择'
        });
    }
}

/** 打开训练参数弹窗并加载指定任务的参数 */
function openMultiTaskParamsModal(taskIndex) {
    editingTaskParamsIndex = taskIndex;

    const task = multiTaskManager.tasks[taskIndex];
    const taskParams = task ? task.parameters : {};

    window.openTrainingParamsModal();

    setTimeout(() => {
        loadTrainingParams(taskParams);
    }, 10);
}

// ===== 队列训练执行 =====

/** 启动/停止队列训练（UI 入口，运行中点击即为停止） */
export async function startQueueTraining() {
    if (multiTaskManager.isQueueRunning) {
        showConfirm('停止后将终止当前训练，所有任务重置为未开始。确定吗？', 'warning', confirmStopQueue);
        return;
    }

    if (await multiTaskManager.startQueue()) {
        updateQueueControls();
        renderTaskList();
        executeNextTaskInQueue();
    }
}

/** 顺序执行队列中的下一个待训练任务 */
export async function executeNextTaskInQueue() {
    const currentTask = multiTaskManager.getCurrentTask();
    if (!currentTask) {
        showMessage('所有训练任务已完成！', 'success');
        updateQueueControls();
        return;
    }

    multiTaskManager.updateTask(multiTaskManager.currentTaskIndex, {
        status: 'running'
    });

    renderTaskList();

    try {
        let baseModel = '';
        if (currentTask.modelSource === 'existing') {
            baseModel = currentTask.baseModel;
        } else if (currentTask.modelSource === 'previous' && multiTaskManager.currentTaskIndex > 0) {
            const prevTask = multiTaskManager.tasks[multiTaskManager.currentTaskIndex - 1];
            baseModel = prevTask.newModelName + '.pt';
        } else {
            throw new Error('无效的模型来源配置');
        }

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

        await waitForTaskCompletion();

    } catch (error) {
        multiTaskManager.taskFailed(multiTaskManager.currentTaskIndex, error.message);
        showMessage(`任务 ${multiTaskManager.currentTaskIndex + 1} 失败: ${error.message}`, 'warning');
        updateQueueControls();
        renderTaskList();
    }
}

/** 轮询等待当前训练任务完成（成功/失败/停止） */
export async function waitForTaskCompletion() {
    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(async () => {
            try {
                const data = await api.getTrainingProgress();

                if (data.status === 'success') {
                    clearInterval(checkInterval);

                    const completedTaskIndex = multiTaskManager.currentTaskIndex;
                    const currentTask = multiTaskManager.getCurrentTask();
                    if (currentTask) {
                        multiTaskManager.updateTask(completedTaskIndex, {
                            status: 'completed',
                            progress: data.progress || currentTask.totalEpochs,
                            totalEpochs: data.total || currentTask.totalEpochs
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

                    resolve();

                } else if (data.status === 'error' || data.status === 'stopped') {
                    clearInterval(checkInterval);

                    let errorMsg = data.error_msg || '训练失败';
                    if (data.status === 'stopped') {
                        errorMsg = '训练被停止';
                    }

                    multiTaskManager.taskFailed(multiTaskManager.currentTaskIndex, errorMsg);
                    showMessage(`任务 ${multiTaskManager.currentTaskIndex + 1} 失败: ${errorMsg}`, 'warning');
                    updateQueueControls();
                    renderTaskList();
                    reject(new Error(errorMsg));
                }

            } catch (error) {
                clearInterval(checkInterval);
                reject(error);
            }
        }, QUEUE_POLL_INTERVAL);
    });
}

/** 停止队列训练（UI 入口，弹出确认后停止） */
export function stopQueueTraining() {
    if (!multiTaskManager.isQueueRunning) return;
    showConfirm('停止后将终止当前训练，所有任务重置为未开始。确定吗？', 'warning', confirmStopQueue);
}

/** 确认停止：发送停止信号 + 重置队列状态 */
async function confirmStopQueue() {
    try {
        const result = await api.stopTraining();
        if (result.status !== 'success') {
            showMessage('停止训练失败: ' + result.message, 'warning');
        }
    } catch (e) {
        console.error('停止训练请求失败:', e);
    }

    multiTaskManager.stopQueue();
    updateQueueControls();
    renderTaskList();
}

/** 根据队列运行状态更新添加/开始按钮的可用性和文案 */
export function updateQueueControls() {
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

// ===== 训练参数弹窗的 window 级绑定（供 HTML onclick 调用） =====

/** 将训练参数弹窗的打开/关闭/保存函数挂载到 window */
export function setupTrainingWindowFunctions() {
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
            showMessage(`训练参数已保存到任务${taskIndex + 1}`, 'success');
            return;
        }
        window.closeTrainingParamsModal();
        showMessage('训练参数已记录', 'success');
    };
}
