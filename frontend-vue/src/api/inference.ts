// 推理 API — 单张/批量/视频预测、历史记录管理
// 批量推理和视频推理使用原生 fetch 以支持 SSE 流式响应
import request from '@/utils/request'
import { API_BASE } from '@/config'

export function predictSingle(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/predict', fd)
}

export function predictBatch(files: File[]): Promise<Response> {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  return fetch(`${API_BASE}/predict_batch`, { method: 'POST', body: fd })
}

export function predictVideo(file: File): Promise<Response> {
  const fd = new FormData()
  fd.append('file', file)
  return fetch(`${API_BASE}/predict_video`, { method: 'POST', body: fd })
}

export function getHistory(modelName: string) {
  return request.get('/history', { params: { model_name: modelName } })
}

export function deleteHistoryItem(recordId: number) {
  return request.delete(`/history/${recordId}`)
}

export function clearHistory(modelName: string) {
  return request.delete('/history', { params: { model_name: modelName } })
}
