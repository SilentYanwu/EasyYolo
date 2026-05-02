// 模型 Store — 管理模型列表、当前选中模型、增删改操作
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as modelApi from '@/api/modelsapi'
import type { ModelCategory } from '@/types'

export const useModelStore = defineStore('models', () => {
  const models = ref({ raw: [] as string[], yolo: [] as string[], trained: [] as string[] })
  const currentModelName = ref('')
  const currentCategory = ref<ModelCategory>('raw')
  const loading = ref(false)

  const currentModel = computed(() => currentModelName.value)
  const allModels = computed(() => [...models.value.raw, ...models.value.yolo, ...models.value.trained])

  // 从后端拉取模型列表并更新当前模型名
  async function fetchModels() {
    loading.value = true
    try {
      const res = await modelApi.getModels()
      models.value = res.data.models
      currentModelName.value = res.data.current_model
    } finally {
      loading.value = false
    }
  }

  // 切换推理模型 → 通知后端加载模型 → 刷新列表
  async function switchModel(name: string, category: string) {
    await modelApi.switchModel(name, category)
    currentModelName.value = name
    currentCategory.value = category as ModelCategory
    await fetchModels()
  }

  // 上传模型文件 → 刷新列表
  async function uploadModel(file: File, customName: string) {
    await modelApi.uploadModel(file, customName)
    await fetchModels()
  }

  // 重命名模型 → 后端同步数据库引用 → 刷新列表
  async function renameModel(oldName: string, newName: string, category: string) {
    await modelApi.renameModel(oldName, newName, category)
    await fetchModels()
  }

  // 删除模型 → 后端清理关联数据 → 刷新列表
  async function deleteModel(name: string, category: string) {
    await modelApi.deleteModel(name, category)
    await fetchModels()
  }

  // 更新模型介绍（不刷新列表，仅更新数据库记录）
  async function updateDescription(modelName: string, description: string) {
    await modelApi.updateModelDescription(modelName, description)
  }

  return {
    models,
    currentModelName,
    currentCategory,
    loading,
    currentModel,
    allModels,
    fetchModels,
    switchModel,
    uploadModel,
    renameModel,
    deleteModel,
    updateDescription
  }
})
