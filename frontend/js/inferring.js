/**
 * 推理模块：单张/批量/视频预测 + 历史记录刷新与展示
 */
import { dom } from './dom.js';
import { state } from './state.js';
import { ui } from './ui.js';
import { api } from './api.js';

/**
 * 辅助：重置显示
 */
export function resetDisplay(isVideo) {
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
 * 业务处理器：单张预测
 */
export async function handleSinglePredict(file) {
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
export async function handleBatchPredict(files) {
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
export async function handleVideoPredict(file) {
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
 * 业务：历史记录查看
 */
export function handleViewHistory(res, ori) {
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

/**
 * 刷新历史记录列表
 */
export async function refreshHistory() {
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
