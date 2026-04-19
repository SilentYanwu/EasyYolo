/**
 * 项目中统一使用的类型定义文件。
 * 通过集中声明接口，确保页面层、服务层和状态层的命名与数据结构一致。
 */

export type PageName = 'inference' | 'training' | 'details'

export type ModelCategory = 'raw' | 'yolo' | 'trained'

export type EditableModelCategory = Exclude<ModelCategory, 'raw'>

/**
 * 后端 /models 接口返回的模型集合。
 */
export interface ModelCollections {
  raw: string[]
  yolo: string[]
  trained: string[]
}

/**
 * 后端 /models 接口完整返回体。
 */
export interface ModelsResponse {
  models: ModelCollections
  current_model: string
}

/**
 * 推理历史记录项。
 */
export interface InferenceHistoryRecord {
  id: number
  original: string
  result: string
  time: string
}

/**
 * 单张推理接口返回结果。
 */
export interface SinglePredictResponse {
  original_url: string
  result_url: string
  detections?: unknown
}

/**
 * 批量推理流式事件。
 */
export interface BatchPredictStreamEvent {
  current?: number
  total?: number
  original_url?: string
  result_url?: string
  error?: string
  filename?: string
  done?: boolean
}

/**
 * 视频推理流式事件。
 */
export interface VideoPredictStreamEvent {
  current_frame?: number
  total_frames?: number
  percent?: number
  status?: 'processing' | 'completed' | 'failed'
  original_url?: string
  result_url?: string
  error?: string
  done?: boolean
}

/**
 * 训练参数。字段名严格对齐后端约定。
 */
export interface TrainingParameters {
  epochs: number
  patience: number
  batch: number
  imgsz: number
  optimizer: 'auto' | 'SGD' | 'Adam' | 'AdamW'
  lr0: number
  lrf: number
  momentum: number
  weight_decay: number
  warmup_epochs: number
  warmup_momentum: number
  cos_lr: boolean
  hsv_h: number
  hsv_s: number
  hsv_v: number
  degrees: number
  translate: number
  scale: number
  shear: number
  perspective: number
  flipud: number
  fliplr: number
  mosaic: number
  mixup: number
  copy_paste: number
  seed: number
  workers: number
  device: string
  amp: boolean
}

/**
 * 训练状态轮询接口返回值。
 */
export interface TrainingProgressState {
  model_name: string | null
  status: 'idle' | 'training' | 'success' | 'error'
  progress: number
  total: number
  metrics: Record<string, number>
  eta: string
  error_msg: string
  start_time: number
  last_epoch_time: number
}

/**
 * 模型详情页中的训练记录。
 */
export interface TrainingRecord {
  model_name: string
  base_model: string
  dataset: string
  parameters: string
  description: string
  final_metrics: string
  time: string
}

/**
 * 后端 /training_history/{model_name} 接口返回体。
 */
export interface TrainingHistoryResponse {
  status: 'success' | 'error'
  data?: TrainingRecord
  message?: string
}
