/**
 * API 通信模块：封装所有与后端的 Fetch 和 SSE 请求
 */
import { API_BASE } from './config.js';

export const api = {
    /**
     * 获取模型列表
     */
    async getModels() {
        const res = await fetch(`${API_BASE}/models`);
        return await res.json();
    },

    /**
     * 切换当前后端模型
     */
    async switchModel(name, category) {
        const formData = new FormData();
        formData.append('model_name', name);
        formData.append('category', category);
        const res = await fetch(`${API_BASE}/switch_model`, { method: 'POST', body: formData });
        return res;
    },

    /**
     * 单张图片预测
     */
    async predictSingle(file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE}/predict`, { method: 'POST', body: formData });
        return await res.json();
    },

    /**
     * 批量预测（SSE 流）
     */
    async predictBatch(files) {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        return await fetch(`${API_BASE}/predict_batch`, {
            method: 'POST',
            body: formData
        });
    },

    /**
     * 视频预测（SSE 流）
     */
    async predictVideo(file) {
        const formData = new FormData();
        formData.append('file', file);
        return await fetch(`${API_BASE}/predict_video`, {
            method: 'POST',
            body: formData
        });
    },

    /**
     * 导入上传模型
     */
    async uploadModel(file, customName) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('custom_name', customName);
        return await fetch(`${API_BASE}/upload_model`, { method: 'POST', body: formData });
    },

    /**
     * 删除模型
     */
    async deleteModel(name, category) {
        return await fetch(`${API_BASE}/delete_model?model_name=${name}&category=${category}`, { method: 'DELETE' });
    },

    /**
     * 重命名模型
     */
    async renameModel(oldName, newName, category) {
        return await fetch(`${API_BASE}/rename_model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_name: oldName,
                new_name: newName,
                category: category
            })
        });
    },

    /**
     * 获取历史记录
     */
    async getHistory(modelName) {
        const res = await fetch(`${API_BASE}/history?model_name=${modelName}`);
        return await res.json();
    },

    /**
     * 删除单条历史记录
     */
    async deleteHistoryItem(recordId) {
        return await fetch(`${API_BASE}/history/${recordId}`, { method: 'DELETE' });
    },

    /**
     * 清空当前模型历史
     */
    async clearHistory(modelName) {
        return await fetch(`${API_BASE}/history?model_name=${modelName}`, { method: 'DELETE' });
    },

    /**
     * 上传并解压数据集
     */
    async uploadDataset(file) {
        const formData = new FormData();
        formData.append('file', file);
        return await fetch(`${API_BASE}/upload_dataset`, { method: 'POST', body: formData });
    },

    /**
     * 开始模型训练
     */
    async startTraining(modelName, baseModel, datasetYamlPath, parameters, description) {
        const formData = new FormData();
        formData.append('model_name', modelName);
        formData.append('base_model', baseModel);
        formData.append('dataset_yaml_path', datasetYamlPath);
        formData.append('parameters', JSON.stringify(parameters));
        formData.append('description', description || '');
        return await fetch(`${API_BASE}/start_training`, { method: 'POST', body: formData });
    },

    /**
     * 获取训练实时进度
     */
    async getTrainingProgress() {
        const res = await fetch(`${API_BASE}/training_progress`);
        return await res.json();
    },

    /**
     * 获取单一模型训练详细历史
     */
    async getTrainingHistory(modelName) {
        const res = await fetch(`${API_BASE}/training_history/${modelName}`);
        return await res.json();
    }
};
