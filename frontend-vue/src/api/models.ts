// 模型管理 API — 获取、切换、上传、重命名、删除、修改介绍
import request from '@/utils/request'
import type { ModelsData } from '@/types'

export function getModels(): Promise<{ data: ModelsData }> {
  return request.get('/models')
}

export function switchModel(modelName: string, category: string) {
  const fd = new FormData()
  fd.append('model_name', modelName)
  fd.append('category', category)
  return request.post('/switch_model', fd)
}

export function uploadModel(file: File, customName: string) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('custom_name', customName)
  return request.post('/upload_model', fd)
}

export function renameModel(oldName: string, newName: string, category: string) {
  return request.post('/rename_model', { old_name: oldName, new_name: newName, category })
}

export function deleteModel(modelName: string, category: string) {
  return request.delete('/delete_model', { params: { model_name: modelName, category } })
}

export function updateModelDescription(modelName: string, description: string) {
  return request.post('/update_model_description', { model_name: modelName, description })
}
