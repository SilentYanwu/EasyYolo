// 推理 API — 单张/批量/视频预测、历史记录管理
// 批量推理和视频推理使用原生 fetch 以支持 SSE 流式响应
import request from '@/utils/request'
import { API_BASE } from '@/config'

// 单张图片推理
export function predictSingle(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/predict', fd)
}

// 摄像头拍照推理（可附带预处理配置）
export function predictCamera(file: File, preprocessing?: Record<string, unknown>) {
  const fd = new FormData()
  fd.append('file', file)
  if (preprocessing) {
    fd.append('preprocessing', JSON.stringify(preprocessing))
  }
  return request.post('/predict_camera', fd)
}

// 批量图片推理（fetch + SSE 流式响应，后端逐张推送进度和结果）
export function predictBatch(files: File[]): Promise<Response> {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  return fetch(`${API_BASE}/predict_batch`, { method: 'POST', body: fd })
}

// 视频推理（fetch + SSE 流式响应，后端逐帧推送进度）
export function predictVideo(file: File): Promise<Response> {
  const fd = new FormData()
  fd.append('file', file)
  return fetch(`${API_BASE}/predict_video`, { method: 'POST', body: fd })
}

// 获取当前模型的推理历史记录
export function getHistory(modelName: string) {
  return request.get('/history', { params: { model_name: modelName } })
}

// 删除单条推理历史记录
export function deleteHistoryItem(recordId: number) {
  return request.delete(`/history/${recordId}`)
}

// 清空当前模型的所有推理历史记录
export function clearHistory(modelName: string) {
  return request.delete('/history', { params: { model_name: modelName } })
}
