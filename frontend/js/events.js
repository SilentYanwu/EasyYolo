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
        dom.trainingParamsModal.classList.add('hidden');
    };
    window.saveTrainingParams = () => {
        // 其实只需要隐藏即可，因为实际是用的时候实时取DOM值
        window.closeTrainingParamsModal();
        alert('训练参数已记录');
    };
    window.startTraining = handleStartTraining;

    dom.uploadDatasetBtn.onclick = () => dom.trainDatasetInput.click();
    dom.trainDatasetInput.onchange = handleDatasetUpload;

    // 绑定按钮事件
    dom.btnOpenTrainingParams.onclick = window.openTrainingParamsModal;
    dom.startTrainBtn.onclick = window.startTraining;

    // 启动训练轮询
    startTrainingPoller();

    // 9. 模态框优化：ESC键关闭和点击背景关闭
    setupModalOptimizations();

    // 10. 绑定模型详情页的基础模型跳转点击事件
    dom.detailsBaseModelLink.onclick = async (e) => {
        e.preventDefault();
        const targetModel = e.target.dataset.target;
        if (targetModel) {
            state.currentDetailsModelName = targetModel;
            await loadModelDetails(targetModel);
            await refreshApp();
        }
    };

    // 11. 模型详情页管理菜单事件
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

let uploadedDatasetPath = "";
let trainingPoller = null;

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
        } else {
            alert(data.detail || '启动训练失败');
        }
    } catch (e) {
        alert('启动训练出错: ' + e.message);
    } finally {
        // 解除按钮锁定
        dom.startTrainBtn.disabled = false;
        dom.startTrainBtn.innerText = '开始训练';
    }
}

function startTrainingPoller() {
    if (trainingPoller) clearInterval(trainingPoller);

    trainingPoller = setInterval(async () => {
        try {
            // 每 2 秒拉取一次训练状态并更新 UI
            const data = await api.getTrainingProgress();

            // 如果后端正在训练或刚结束，渲染 Dashboard
            if (data.status === 'training' || data.status === 'success' || data.status === 'error') {
                if (data.model_name) {
                    dom.trainingDashboard.style.display = 'block';
                    ui.updateTrainingDashboard(data);
                }
            }

            // --- 新增：检测训练完成并弹出通知 ---
            if (state.lastTrainingStatus === 'training' && data.status === 'success') {
                state.lastTrainingStatus = 'success';
                alert(`🎉 训练完成！新模型 "${data.model_name}" 已就绪。\n点击确认后将刷新页面以加载最新数据。`);
                window.location.reload(); // 刷新页面，让 Part 1 和 Part 3 看到模型
            } else if (state.lastTrainingStatus === 'training' && data.status === 'error') {
                state.lastTrainingStatus = 'error';
                alert(`❌ 训练出错：${data.error_msg || '未知错误'}`);
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