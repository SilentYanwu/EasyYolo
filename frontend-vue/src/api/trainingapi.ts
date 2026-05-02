// 训练 API — 数据集上传、训练启停、进度查询
import request from '@/utils/request'
import type { TrainingParams } from '@/types'

// 上传并解压训练数据集（ZIP 格式，需包含 data.yaml）
export function uploadDataset(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/upload_dataset', fd)
}

// 启动训练任务（parameters 序列化为 JSON 字符串传入）
export function startTraining(
  modelName: string,
  baseModel: string,
  datasetYamlPath: string,
  parameters: TrainingParams,
  description: string
) {
  const fd = new FormData()
  fd.append('model_name', modelName)
  fd.append('base_model', baseModel)
  fd.append('dataset_yaml_path', datasetYamlPath)
  fd.append('parameters', JSON.stringify(parameters))
  fd.append('description', description || '')
  return request.post('/start_training', fd)
}

// 查询当前训练进度（轮询用，返回 training_state 字典）
export function getTrainingProgress() {
  return request.get('/training_progress')
}

// 停止当前训练（发送停止信号，训练线程在下一 batch 响应）
export function stopTraining() {
  return request.post('/stop_training')
}

// 获取已有数据集列表（用于去重检测）
export function getDatasets() {
  return request.get('/datasets')
}

// 获取某模型的训练历史详情（参数、指标、评估表格、图表）
export function getTrainingHistory(modelName: string) {
  return request.get(`/training_history/${modelName}`)
}

// SSE 请求完整 URL（fetch 不走 axios baseURL，需拼接 /api 前缀）
export function buildSSEUrl(path: string): string {
  return `/api${path}`
}
