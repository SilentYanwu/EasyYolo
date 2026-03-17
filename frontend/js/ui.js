/**
 * UI 渲染与界面操作模块
 */
import { dom } from './dom.js';
import { state } from './state.js';
import { MAX_THUMBNAILS, API_BASE } from './config.js';

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
    },

    // --- 新增：YOLO训练UI逻辑 ---
    /**
     * 渲染训练界面的基础模型下拉列表
     */
    renderTrainBaseModels(models) {
        dom.trainBaseModel.innerHTML = '';
        // 汇总所有可能的基座模型 (raw, yolo, trained)
        const allModels = [...models.raw, ...models.yolo, ...models.trained];
        allModels.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.innerText = name;
            if (name === state.currentModelName) {
                option.selected = true; // 默认选中当前使用的模型
            }
            dom.trainBaseModel.appendChild(option);
        });
    },

    /**
     * 更新训练进度面板
     */
    updateTrainingDashboard(trainState) {
        if (!trainState) return;
        dom.trainingDashboard.style.display = 'block';
        
        const progress = trainState.progress || 0;
        const total = trainState.total || 0;
        const percent = total > 0 ? Math.min(100, (progress / total) * 100).toFixed(1) : 0;
        
        dom.trainProgressFill.style.width = `${percent}%`;
        dom.trainEpochLabel.innerText = `${progress} / ${total} Epochs (${percent}%)`;
        
        dom.trainStatusLabel.innerText = `状态: ${trainState.status === 'training' ? '训练中...' : trainState.status === 'success' ? '已完成' : trainState.status === 'error' ? '出错' : '准备中...'}`;
        dom.trainEtaLabel.innerText = `预计剩余时间: ${trainState.eta || '--'}`;

        // 更新指标卡片
        dom.trainMetricsGrid.innerHTML = '';
        if (trainState.metrics) {
            for (const [key, val] of Object.entries(trainState.metrics)) {
                const card = document.createElement('div');
                card.style.cssText = 'background: #0f172a; padding: 10px; border-radius: 6px; border: 1px solid #334155; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';
                card.innerHTML = `
                    <div style="color: #cbd5e1; font-size: 13px; margin-bottom: 5px;">${key}</div>
                    <div style="color: #38bdf8; font-size: 18px; font-weight: bold;">${val}</div>
                `;
                dom.trainMetricsGrid.appendChild(card);
            }
        }
    },

    /**
     * 渲染模型详情页面
     */
    renderModelDetails(detailsData) {
        if (!detailsData) {
            dom.detailsPlaceholder.style.display = 'flex';
            dom.detailsContent.style.display = 'none';
            return;
        }

        dom.detailsPlaceholder.style.display = 'none';
        dom.detailsContent.style.display = 'flex';

        dom.detailsModelName.innerText = detailsData.model_name;
        
        if (detailsData.base_model) {
            dom.detailsBaseModelLink.innerText = detailsData.base_model;
            // storing the base model name for click events
            dom.detailsBaseModelLink.dataset.target = detailsData.base_model;
        } else {
            dom.detailsBaseModelLink.innerText = '无';
            dom.detailsBaseModelLink.removeAttribute('data-target');
        }

        // 渲染模型介绍
        if (detailsData.description && detailsData.description.trim()) {
            dom.detailsModelDescription.innerText = `📝 ${detailsData.description}`;
            dom.detailsModelDescription.style.display = 'block';
        } else {
            dom.detailsModelDescription.style.display = 'none';
        }

        // 渲染参数表
        dom.detailsParamsTable.innerHTML = '';
        if (detailsData.parameters) {
            let paramsObj = {};
            try { paramsObj = JSON.parse(detailsData.parameters); } catch(e){}
            
            // 详细的参数含义字典
            const paramExplains = {
                "epochs": "训练轮数，模型完整遍历整个数据集的次数",
                "patience": "训练耐心值，若指标连续多少轮无提升则提前停止",
                "batch": "批次大小，每次迭代加载的样本数量",
                "imgsz": "输入图片的缩放尺寸",
                "optimizer": "优化算法，通常选 SGD 或 AdamW",
                "lr0": "初始学习率",
                "lrf": "最终学习率倍数 (lr0 * lrf)",
                "momentum": "动量因子",
                "weight_decay": "权重衰减，用于正则化防止过拟合",
                "warmup_epochs": "预热轮数，学习率从低到高过渡的轮数",
                "warmup_momentum": "预热初始动量",
                "cos_lr": "是否开启余弦学习率调度，使学习率平滑衰减",
                "hsv_h": "HSV-Hue 增强，色调随机调整范围",
                "hsv_s": "HSV-Saturation 增强，饱和度随机调整范围",
                "hsv_v": "HSV-Value 增强，明度随机调整范围",
                "degrees": "随机旋转角度范围",
                "translate": "水平/垂直随机平移比例",
                "scale": "随机缩放比例范围",
                "shear": "随机剪切角度范围",
                "perspective": "随机透视变换强度",
                "flipud": "上下随机翻转概率",
                "fliplr": "左右随机翻转概率",
                "mosaic": "拼贴增强概率（4张图合1），提升检测效果",
                "mixup": "Mixup 增强概率（2张图按比例混合）",
                "copy_paste": "拷贝粘贴增强概率",
                "seed": "随机种子，固定种子可保证结果可复现",
                "workers": "加载数据的 CPU 线程数",
                "device": "显卡编号 (0, cpu 等)",
                "amp": "自动混合精度训练，开启可节省显存并提速"
            };

            for (const [key, val] of Object.entries(paramsObj)) {
                const tr = document.createElement('tr');
                tr.style.cssText = 'border-bottom: 1px solid #2d3748;';
                
                const explain = paramExplains[key] || "自定义训练参数";
                
                tr.innerHTML = `
                    <td style="padding: 10px; font-family: monospace; color: #38bdf8; font-size: 14px;">${key}</td>
                    <td style="padding: 10px; font-weight: bold; font-size: 14px;">${val}</td>
                    <td style="padding: 10px; color: #94a3b8; font-size: 13px;">${explain}</td>
                `;
                dom.detailsParamsTable.appendChild(tr);
            }
        }

        // 渲染图表
        dom.detailsChartsGrid.innerHTML = '';
        
        // 图表文件名到中文功能描述的映射
        const chartDescriptions = {
            'results.png': '训练总览：展示训练/验证阶段各项损失值与评估指标（mAP50、mAP50-95等）随 Epoch 的变化趋势，是训练效果的综合仪表盘。',
            'confusion_matrix.png': '混淆矩阵：以绝对数量展示模型在各类别上的预测正确/错误分布，帮助定位哪些类别容易被混淆。',
            'confusion_matrix_normalized.png': '归一化混淆矩阵：按百分比展示各类别的预测准确率，更直观地反映各类别的识别能力差异。',
            'F1_curve.png': 'F1 曲线：展示不同置信度阈值下的 F1 分数变化（F1 = 精确度与召回率的调和平均），用于找到最佳检测阈值。',
            'PR_curve.png': 'PR 曲线：展示精确度(Precision)与召回率(Recall)的权衡关系，曲线下面积(AP)越大表示模型越优秀。',
            'P_curve.png': 'Precision 曲线：展示不同置信度阈值下精确度的变化，高精确度意味着误检率低。',
            'R_curve.png': 'Recall 曲线：展示不同置信度阈值下召回率的变化，高召回率意味着漏检率低。',
            'labels.jpg': '标签分布：展示数据集中各类别标注的数量和位置分布统计，帮助评估数据集是否均衡。',
            'labels_correlogram.jpg': '标签相关性：展示标注框的宽度、高度、位置等属性之间的相关性分布，用于分析数据集标注的几何特征。'
        };

        // 关键修复：chart 文件夹名是不带 .pt 的！
        const chartModelName = detailsData.model_name.replace('.pt', '');

        const charts = ['results.png', 'confusion_matrix.png', 'confusion_matrix_normalized.png', 'F1_curve.png', 'PR_curve.png', 'P_curve.png', 'R_curve.png', 'labels.jpg', 'labels_correlogram.jpg'];
        charts.forEach(chartName => {
            const imgUrl = `${API_BASE}/trainchart/${chartModelName}/${chartName}?t=${new Date().getTime()}`;
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'background: #0f172a; border-radius: 8px; padding: 15px; border: 1px solid #334155; display: flex; flex-direction: column; align-items: center; gap: 8px;';
            
            // 图表标题
            const title = document.createElement('div');
            title.style.cssText = 'color: #38bdf8; font-size: 15px; font-weight: bold; text-align: center;';
            title.innerText = chartName.split('.')[0].replace(/_/g, ' ').toUpperCase();
            
            // 图表功能描述
            const desc = document.createElement('div');
            desc.style.cssText = 'color: #94a3b8; font-size: 13px; text-align: center; line-height: 1.5; padding: 0 5px; margin-bottom: 5px;';
            desc.innerText = chartDescriptions[chartName] || '训练产物图表';
            
            // 图片
            const img = document.createElement('img');
            img.src = imgUrl;
            img.style.cssText = 'width: 100%; height: auto; border-radius: 6px; display: block; object-fit: contain; min-height: 200px; cursor: pointer;';
            img.title = '点击在新标签页查看大图';
            img.onclick = () => window.open(imgUrl, '_blank');
            
            // 如果不存在该图表则隐藏该卡片
            img.onerror = () => { wrapper.style.display = 'none'; }; 
            
            wrapper.appendChild(title);
            wrapper.appendChild(desc);
            wrapper.appendChild(img);
            dom.detailsChartsGrid.appendChild(wrapper);
        });
    }
};
