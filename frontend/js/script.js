/**
 * 全局配置与状态
 * 后端地址
 */
const API_BASE = "http://127.0.0.1:8000";
let currentModelName = "";
let currentCategory = "";
let activeMenuId = null; // 用于记录当前哪个菜单是打开的

// DOM 元素统一引用
const dom = {
    imageInput: document.getElementById('imageInput'),
    originalImg: document.getElementById('originalImg'),
    resultImg: document.getElementById('resultImg'),
    predictBtn: document.getElementById('predictBtn'),
    statusText: document.getElementById('statusText'),
    downloadLink: document.getElementById('downloadLink'),
    rawList: document.getElementById('raw-model-list'),
    yoloList: document.getElementById('yolo-model-list'),
    historyGrid: document.getElementById('historyGrid'),
    currentModelLabel: document.getElementById('currentModelName'),
    uploadModal: document.getElementById('uploadModal'),
    renameModal: document.getElementById('renameModal'),
    renameInput: document.getElementById('renameInput'),
    oldNameHidden: document.getElementById('oldNameHidden'),
    categoryHidden: document.getElementById('categoryHidden'),
    // 批量导入相关
    thumbnailPreview: document.getElementById('thumbnailPreview'),
    batchProgress: document.getElementById('batchProgress'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
};

// 缩略图最大显示数量
const MAX_THUMBNAILS = 8;

/**
 * 页面切换控制 (SPA 路由模拟)
 */
window.switchPage = function (pageId, btnElement) {
    // 1. 隐藏所有的 app-container (识别、训练、详情)
    document.querySelectorAll('.app-container').forEach(page => {
        page.style.display = 'none';
    });

    // 2. 取消所有顶部导航按钮的高亮
    document.querySelectorAll('.top-nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // 3. 显示目标页面
    document.getElementById(`page-${pageId}`).style.display = 'flex';

    // 4. 给当前点击的按钮加高亮
    if (btnElement) {
        btnElement.classList.add('active');
    }
}
/**
 * 1. 初始化
 */
window.onload = async function () {
    // 全局点击监听：点击页面空白处，关闭所有弹出的菜单
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('menu-trigger')) {
            closeAllMenus();
        }
    });
    await loadModelList();
};

/**
 * 2. 模型列表管理
 */
async function loadModelList() {
    try {
        const res = await fetch(`${API_BASE}/models`);
        const data = await res.json();

        // 渲染列表：raw(官方), yolo(导入), trained(训练)
        // 注意：data.models.trained 如果后端没传，这里暂时不会报错，后续有了自动会渲染
        renderList(dom.rawList, data.models.raw, 'raw', data.current_model);
        renderList(dom.yoloList, data.models.yolo, 'yolo', data.current_model);

        currentModelName = data.current_model;
        dom.currentModelLabel.innerText = currentModelName;
        loadHistory(currentModelName);

    } catch (error) {
        console.error("加载列表失败:", error);
        dom.statusText.innerText = "连接后端失败";
    }
}

// 渲染函数：支持生成“三个点”菜单
function renderList(container, items, category, activeName) {
    container.innerHTML = '';

    items.forEach((name, index) => {
        // 创建行容器
        const div = document.createElement('div');
        div.className = `model-item ${name === activeName ? 'active' : ''}`;

        // 1. 模型名称部分
        const nameSpan = document.createElement('span');
        nameSpan.className = 'model-name';
        nameSpan.innerText = name;
        // 点击名字 -> 切换模型
        div.onclick = () => switchModel(name, category);

        div.appendChild(nameSpan);

        // 2. 菜单部分 (只有非raw类型的模型才显示三个点)
        if (category !== 'raw') {
            const menuId = `menu-${category}-${index}`;

            // 三个点按钮
            const dots = document.createElement('div');
            dots.className = 'menu-trigger';
            dots.innerText = '⋮';
            // 【关键】阻止冒泡：点击三个点时，不要触发外层的 switchModel
            dots.onclick = (e) => {
                e.stopPropagation();
                toggleMenu(menuId);
            };

            // 隐藏的菜单 (重命名/删除)
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.id = menuId;
            menu.innerHTML = `
                <div class="context-menu-item">重命名</div>
                <div class="context-menu-item danger">删除</div>
            `;

            // 给菜单项绑定事件
            const menuItems = menu.querySelectorAll('.context-menu-item');

            // 重命名按钮
            menuItems[0].onclick = (e) => {
                e.stopPropagation();
                openRenameModal(name, category);
            };

            // 删除按钮
            menuItems[1].onclick = (e) => {
                e.stopPropagation();
                deleteModel(name, category);
            };

            div.appendChild(dots);
            div.appendChild(menu);
        }

        container.appendChild(div);
    });
}

// 菜单控制逻辑
function toggleMenu(menuId) {
    const menu = document.getElementById(menuId);
    // 如果点的是当前已经打开的，就关闭它
    if (activeMenuId === menuId) {
        menu.classList.remove('show');
        activeMenuId = null;
    } else {
        closeAllMenus(); // 关掉别的
        menu.classList.add('show'); // 打开这个
        activeMenuId = menuId;
    }
}

function closeAllMenus() {
    document.querySelectorAll('.context-menu').forEach(el => el.classList.remove('show'));
    activeMenuId = null;
}

/**
 * 3. 切换模型逻辑
 */
async function switchModel(name, category) {
    // 如果已经选中，就不刷新了，防止闪烁
    if (name === currentModelName) return;

    dom.statusText.innerText = `正在切换...`;

    const formData = new FormData();
    formData.append('model_name', name);
    formData.append('category', category);

    try {
        const res = await fetch(`${API_BASE}/switch_model`, { method: 'POST', body: formData });

        if (res.ok) {
            currentModelName = name;
            // 局部刷新UI
            loadModelList();
            dom.resultImg.src = "";
            dom.downloadLink.style.display = 'none';
            dom.statusText.innerText = `当前模型: ${name}`;
            loadHistory(name);
        } else {
            alert("切换失败");
        }
    } catch (error) {
        alert("网络错误");
    }
}

/**
 * 4. 识别推理逻辑（支持单张/多张自适应）
 */
let selectedFiles = [];

dom.imageInput.addEventListener('change', function (e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // 校验上限
    if (files.length > 99) {
        alert('单次最多支持 99 张图片，请减少选择数量');
        e.target.value = '';
        return;
    }

    selectedFiles = files;
    dom.resultImg.src = '';
    dom.downloadLink.style.display = 'none';
    dom.predictBtn.disabled = false;

    // 隐藏进度条（可能上次的还显示着）
    dom.batchProgress.style.display = 'none';

    if (files.length === 1) {
        // --- 单张模式 ---
        dom.thumbnailPreview.style.display = 'none';
        const reader = new FileReader();
        reader.onload = function (ev) { dom.originalImg.src = ev.target.result; };
        reader.readAsDataURL(files[0]);
        dom.statusText.innerText = '准备就绪';
    } else {
        // --- 多张模式：显示缩略图预览 ---
        dom.originalImg.src = '';
        renderThumbnails(files);
        dom.statusText.innerText = '已选择 ' + files.length + ' 张图片，点击"开始识别"进行批量处理';
    }
});

/**
 * 渲染缩略图预览
 */
function renderThumbnails(files) {
    dom.thumbnailPreview.innerHTML = '';
    dom.thumbnailPreview.style.display = 'flex';

    const showCount = Math.min(files.length, MAX_THUMBNAILS);
    const remaining = files.length - showCount;

    for (let i = 0; i < showCount; i++) {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-item';
        const img = document.createElement('img');
        img.alt = files[i].name;

        const reader = new FileReader();
        reader.onload = (ev) => { img.src = ev.target.result; };
        reader.readAsDataURL(files[i]);

        thumb.appendChild(img);
        dom.thumbnailPreview.appendChild(thumb);
    }

    if (remaining > 0) {
        const more = document.createElement('div');
        more.className = 'thumbnail-more';
        more.innerText = '+' + remaining;
        dom.thumbnailPreview.appendChild(more);
    }

    const countLabel = document.createElement('span');
    countLabel.className = 'thumbnail-count';
    countLabel.innerText = '共 ' + files.length + ' 张';
    dom.thumbnailPreview.appendChild(countLabel);
}

/**
 * 开始识别按钮（自适应单张/批量）
 */
dom.predictBtn.addEventListener('click', async function () {
    if (selectedFiles.length === 0) return;

    if (selectedFiles.length === 1) {
        await predictSingle(selectedFiles[0]);
    } else {
        await startBatchPredict(selectedFiles);
    }
});

/**
 * 单张推理
 */
async function predictSingle(file) {
    dom.statusText.innerText = '识别中...';
    dom.predictBtn.disabled = true;
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(`${API_BASE}/predict`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error();
        const data = await res.json();
        dom.resultImg.src = data.result_url; // 显示结果图片
        dom.downloadLink.href = data.result_url; // 下载链接
        dom.downloadLink.style.display = 'inline-block';// 显示下载按钮
        dom.statusText.innerText = '完成';
        loadHistory(currentModelName);
    } catch (error) {
        dom.statusText.innerText = '识别出错';
    } finally {
        dom.predictBtn.disabled = false;
    }
}

/**
 * 批量推理：通过 SSE 事件流读取后端进度
 */
async function startBatchPredict(files) {
    dom.predictBtn.disabled = true;
    dom.statusText.innerText = '批量识别中...';

    // 显示进度条并初始化
    dom.batchProgress.style.display = 'block';
    dom.progressFill.style.width = '0%';
    dom.progressFill.classList.remove('done');
    dom.progressText.innerText = '0/' + files.length;

    // 打包 FormData
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    try {
        const response = await fetch(`${API_BASE}/predict_batch`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || '批量识别请求失败');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let errorCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split('\n\n');
            buffer = parts.pop();

            for (const part of parts) {
                const line = part.trim();
                if (!line.startsWith('data: ')) continue;

                const jsonStr = line.slice(6);
                let event;
                try { event = JSON.parse(jsonStr); } catch { continue; }

                if (event.done) {
                    dom.progressFill.style.width = '100%';
                    dom.progressFill.classList.add('done');
                    const msg = errorCount > 0
                        ? '完成（' + errorCount + ' 张识别失败）'
                        : '批量识别完成';
                    dom.statusText.innerText = msg;
                    dom.progressText.innerText = event.total + '/' + event.total;
                } else if (event.error) {
                    errorCount++;
                    updateProgress(event.current, event.total);
                } else {
                    updateProgress(event.current, event.total);
                    dom.originalImg.src = event.original_url;
                    dom.resultImg.src = event.result_url;
                    dom.downloadLink.href = event.result_url;
                    dom.downloadLink.style.display = 'inline-block';
                }
            }
        }

        loadHistory(currentModelName);

    } catch (error) {
        dom.statusText.innerText = '批量识别出错: ' + error.message;
    } finally {
        dom.predictBtn.disabled = false;
        setTimeout(() => {
            dom.thumbnailPreview.style.display = 'none';
            dom.thumbnailPreview.innerHTML = '';
        }, 1500);
    }
}

/**
 * 更新进度条
 */
function updateProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    dom.progressFill.style.width = percent + '%';
    dom.progressText.innerText = current + '/' + total;
    dom.statusText.innerText = '批量识别中 ' + current + '/' + total;
}

/**
 * 5. 模型管理 (上传、重命名、删除)
 */

// 上传
async function uploadModel() {
    const file = document.getElementById('modelFile').files[0];
    const name = document.getElementById('modelName').value.trim();
    if (!file || !name) return alert("请填写完整");

    const formData = new FormData();
    formData.append('file', file);
    formData.append('custom_name', name);

    const btn = document.querySelector('#uploadModal .btn.primary');
    btn.innerText = "上传中...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/upload_model`, { method: 'POST', body: formData });
        if (res.ok) {
            closeUploadModal();
            loadModelList();
            document.getElementById('modelFile').value = "";
            document.getElementById('modelName').value = "";
        } else alert("上传失败");
    } catch (e) { alert("网络错误"); }
    finally { btn.innerText = "确定导入"; btn.disabled = false; }
}

// 删除模型
async function deleteModel(name, category) {
    closeAllMenus();
    if (!confirm(`确定彻底删除 ${name} 吗？`)) return;

    try {
        const res = await fetch(`${API_BASE}/delete_model?model_name=${name}&category=${category}`, { method: 'DELETE' });
        if (res.ok) loadModelList();
        else alert("删除失败");
    } catch (e) { alert("网络错误"); }
}

// 重命名逻辑
function openRenameModal(name, category) {
    closeAllMenus();
    dom.oldNameHidden.value = name;
    dom.categoryHidden.value = category;
    dom.renameInput.value = name.replace('.pt', '');
    dom.renameModal.classList.remove('hidden');
}

async function confirmRename() {
    const newName = dom.renameInput.value.trim();
    if (!newName) return;

    try {
        const res = await fetch(`${API_BASE}/rename_model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_name: dom.oldNameHidden.value,
                new_name: newName,
                category: dom.categoryHidden.value
            })
        });
        if (res.ok) {
            dom.renameModal.classList.add('hidden');
            loadModelList();
        } else {
            const err = await res.json();
            alert(err.detail);
        }
    } catch (e) { alert("重命名失败"); }
}

/**
 * 6. 历史记录
 */
async function loadHistory(modelName) {
    if (!modelName) return;
    try {
        const res = await fetch(`${API_BASE}/history?model_name=${modelName}`);
        const history = await res.json();
        dom.historyGrid.innerHTML = '';
        if (history.length === 0) {
            dom.historyGrid.innerHTML = '<p style="color:#999;font-size:12px;text-align:center;width:100%">暂无记录</p>';
            return;
        }
        history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `<img src="${item.result}"><span>${item.time.substring(5, 16).replace('T', ' ')}</span>`;
            div.onclick = () => viewHistoryImage(item.result, item.original);
            dom.historyGrid.appendChild(div);
        });
    } catch (e) { }
}

async function clearHistory() {
    if (!confirm("清空记录？")) return;
    await fetch(`${API_BASE}/history?model_name=${currentModelName}`, { method: 'DELETE' });
    loadHistory(currentModelName);
}

function viewHistoryImage(res, ori) {
    dom.resultImg.src = res;
    dom.originalImg.src = ori;
    dom.downloadLink.href = res;
    dom.downloadLink.style.display = 'inline-block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 将隐藏框的值赋给全局变量
window.openUploadModal = () => dom.uploadModal.classList.remove('hidden');
window.closeUploadModal = () => dom.uploadModal.classList.add('hidden');
window.closeRenameModal = () => dom.renameModal.classList.add('hidden');
window.uploadModel = uploadModel;
window.clearHistory = clearHistory;
window.confirmRename = confirmRename;

// ====== 侧边栏折叠/展开逻辑 ======
window.toggleSidebar = function (btn) {
    const container = btn.closest('.app-container');
    if (!container) return;

    const sidebar = container.querySelector('.sidebar');
    const openBtn = container.querySelector('.open-sidebar-btn');

    if (sidebar.classList.contains('collapsed')) {
        // 展开
        sidebar.classList.remove('collapsed');
        if (openBtn) {
            openBtn.classList.remove('visible');
        }
    } else {
        // 折叠
        sidebar.classList.add('collapsed');
        if (openBtn) {
            // 等待折叠动画差不多完成再显示打开按钮
            setTimeout(() => {
                if (sidebar.classList.contains('collapsed')) {
                    openBtn.classList.add('visible');
                }
            }, 250);
        }
    }
};