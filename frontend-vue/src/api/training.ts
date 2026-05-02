// 训练 API — 数据集上传、训练启停、进度查询
import request from '@/utils/request'
import type { TrainingParams } from '@/types'

export function uploadDataset(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/upload_dataset', fd)
}

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

export function getTrainingProgress() {
  return request.get('/training_progress')
}

export function stopTraining() {
  return request.post('/stop_training')
}

export function getDatasets() {
  return request.get('/datasets')
}

export function getTrainingHistory(modelName: string) {
  return request.get(`/training_history/${modelName}`)
}

// SSE 请求完整 URL（fetch 不走 axios baseURL，需拼接 /api 前缀）
export function buildSSEUrl(path: string): string {
  return `/api${path}`
}
