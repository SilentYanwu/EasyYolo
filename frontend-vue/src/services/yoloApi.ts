import axios from 'axios'

import type {
  BatchPredictStreamEvent,
  EditableModelCategory,
  InferenceHistoryRecord,
  ModelsResponse,
  SinglePredictResponse,
  TrainingHistoryResponse,
  TrainingParameters,
  TrainingProgressState,
  VideoPredictStreamEvent,
} from '@/types/yolo'

/**
 * API 基础地址支持 .env 配置，同时保留本地默认值。
 */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'http://127.0.0.1:8000'

/**
 * 常规请求统一走 Axios，便于统一超时与错误处理。
 */
const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60_000,
})

/**
 * 将后端错误对象转换成更可读的信息文本。
 */
function toReadableErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail

    if (detail) {
      return detail
    }

    if (error.message) {
      return error.message
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return '请求失败，请稍后重试。'
}

/**
 * 从 SSE 连接中逐条解析 data 事件。
 * 该函数兼容后端按 "\n\n" 分隔的标准事件块。
 */
async function consumeSseStream<T extends object>(
  response: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`流式请求失败，状态码 ${response.status}`)
  }

  if (!response.body) {
    throw new Error('浏览器未返回可读取的数据流。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''

    for (const chunk of chunks) {
      let dataPayload = ''

      for (const line of chunk.split('\n')) {
        const trimmedLine = line.trim()

        if (trimmedLine.startsWith('data:')) {
          dataPayload += trimmedLine.replace(/^data:\s?/, '')
        }
      }

      if (!dataPayload) {
        continue
      }

      onEvent(JSON.parse(dataPayload) as T)
    }
  }
}

/**
 * 获取模型列表与当前推理模型。
 */
export async function fetchModels(): Promise<ModelsResponse> {
  const { data } = await httpClient.get<ModelsResponse>('/models')
  return data
}

/**
 * 切换当前推理模型。
 */
export async function switchModel(modelName: string, category: string): Promise<void> {
  const formData = new FormData()
  formData.append('model_name', modelName)
  formData.append('category', category)
  await httpClient.post('/switch_model', formData)
}

/**
 * 上传新模型文件到 yolo 目录。
 */
export async function uploadModel(modelFile: File, customName: string): Promise<void> {
  const formData = new FormData()
  formData.append('file', modelFile)
  formData.append('custom_name', customName)
  await httpClient.post('/upload_model', formData)
}

/**
 * 重命名已有模型。
 */
export async function renameModel(
  oldName: string,
  newName: string,
  category: EditableModelCategory,
): Promise<void> {
  await httpClient.post('/rename_model', {
    old_name: oldName,
    new_name: newName,
    category,
  })
}

/**
 * 删除模型文件。
 */
export async function deleteModel(modelName: string, category: EditableModelCategory): Promise<void> {
  await httpClient.delete('/delete_model', {
    params: {
      model_name: modelName,
      category,
    },
  })
}

/**
 * 获取当前模型的推理历史记录。
 */
export async function fetchHistory(modelName: string): Promise<InferenceHistoryRecord[]> {
  const { data } = await httpClient.get<InferenceHistoryRecord[]>('/history', {
    params: {
      model_name: modelName,
    },
  })
  return data
}

/**
 * 删除指定历史记录。
 */
export async function deleteHistoryRecord(recordId: number): Promise<void> {
  await httpClient.delete(`/history/${recordId}`)
}

/**
 * 清空某模型的历史记录。
 */
export async function clearHistory(modelName: string): Promise<void> {
  await httpClient.delete('/history', {
    params: {
      model_name: modelName,
    },
  })
}

/**
 * 单张图片推理。
 */
export async function predictSingleImage(file: File): Promise<SinglePredictResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await httpClient.post<SinglePredictResponse>('/predict', formData)
  return data
}

/**
 * 批量图片推理（SSE 流式）。
 */
export async function streamBatchPredict(
  files: File[],
  onEvent: (event: BatchPredictStreamEvent) => void,
): Promise<void> {
  const formData = new FormData()
  files.forEach((fileItem) => formData.append('files', fileItem))

  const response = await fetch(`${API_BASE_URL}/predict_batch`, {
    method: 'POST',
    body: formData,
  })

  await consumeSseStream<BatchPredictStreamEvent>(response, onEvent)
}

/**
 * 视频推理（SSE 流式）。
 */
export async function streamVideoPredict(
  file: File,
  onEvent: (event: VideoPredictStreamEvent) => void,
): Promise<void> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE_URL}/predict_video`, {
    method: 'POST',
    body: formData,
  })

  await consumeSseStream<VideoPredictStreamEvent>(response, onEvent)
}

/**
 * 上传训练数据集压缩包。
 */
export async function uploadDataset(zipFile: File): Promise<{ dataset_path: string }> {
  const formData = new FormData()
  formData.append('file', zipFile)
  const { data } = await httpClient.post<{ status: string; dataset_path: string }>('/upload_dataset', formData)
  return { dataset_path: data.dataset_path }
}

/**
 * 启动训练任务。
 */
export async function startTraining(payload: {
  modelName: string
  baseModel: string
  datasetYamlPath: string
  description: string
  parameters: TrainingParameters
}): Promise<void> {
  const formData = new FormData()
  formData.append('model_name', payload.modelName)
  formData.append('base_model', payload.baseModel)
  formData.append('dataset_yaml_path', payload.datasetYamlPath)
  formData.append('description', payload.description)
  formData.append('parameters', JSON.stringify(payload.parameters))
  await httpClient.post('/start_training', formData)
}

/**
 * 轮询获取训练进度。
 */
export async function fetchTrainingProgress(): Promise<TrainingProgressState> {
  const { data } = await httpClient.get<TrainingProgressState>('/training_progress')
  return data
}

/**
 * 获取模型训练详情。
 */
export async function fetchTrainingHistory(modelName: string): Promise<TrainingHistoryResponse> {
  const { data } = await httpClient.get<TrainingHistoryResponse>(`/training_history/${encodeURIComponent(modelName)}`)
  return data
}

/**
 * 更新模型描述。
 */
export async function updateModelDescription(modelName: string, description: string): Promise<void> {
  await httpClient.post('/update_model_description', {
    model_name: modelName,
    description,
  })
}

export const yoloApiError = {
  toReadableErrorMessage,
}
