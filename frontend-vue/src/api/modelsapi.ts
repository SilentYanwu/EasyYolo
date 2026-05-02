// 模型管理 API — 获取、切换、上传、重命名、删除、修改介绍
import request from '@/utils/request'
import type { ModelsData } from '@/types'

// 获取所有可用模型列表（raw/yolo/trained + current_model）
export function getModels(): Promise<{ data: ModelsData }> {
  return request.get('/models')
}

// 切换当前推理模型
export function switchModel(modelName: string, category: string) {
  const fd = new FormData()
  fd.append('model_name', modelName)
  fd.append('category', category)
  return request.post('/switch_model', fd)
}

// 上传自定义 .pt 模型文件
export function uploadModel(file: File, customName: string) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('custom_name', customName)
  return request.post('/upload_model', fd)
}

// 重命名模型（同步更新推理/训练记录中的引用）
export function renameModel(oldName: string, newName: string, category: string) {
  return request.post('/rename_model', { old_name: oldName, new_name: newName, category })
}

// 删除模型文件及其关联数据（历史记录/训练记录/trainchart）
export function deleteModel(modelName: string, category: string) {
  return request.delete('/delete_model', { params: { model_name: modelName, category } })
}

// 更新模型介绍文本
export function updateModelDescription(modelName: string, description: string) {
  return request.post('/update_model_description', { model_name: modelName, description })
}
