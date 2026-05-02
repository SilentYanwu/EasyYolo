// EasyYolo 全局类型定义
// 模型列表 API 返回结构
export interface ModelsData {
  models: {
    raw: string[]
    yolo: string[]
    trained: string[]
  }
  current_model: string
}

export type ModelCategory = 'raw' | 'yolo' | 'trained'

// 推理历史
export interface HistoryItem {
  id: number
  model_name: string
  original: string
  result: string
  time: string
}

// 训练状态
export interface TrainingState {
  model_name: string | null
  status: 'idle' | 'training' | 'success' | 'error' | 'stopped' | 'early_stopped'
  progress: number
  total: number
  metrics: Record<string, number>
  eta: string
  error_msg: string
  start_time: number
  last_epoch_time: number
  is_early_stopped: boolean
  early_stopped_epoch: number
  taskTitle?: string
}

// 训练参数
export interface TrainingParams {
  epochs: number
  patience: number
  batch: number
  imgsz: number
  optimizer: string
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

// 模型详情
export interface ModelDetail {
  model_name: string
  base_model: string
  dataset: string
  parameters: string
  description: string
  time: string
  best_metrics?: string
  best_epoch?: number
  early_stopped?: number
  early_stop_epoch?: number
  eval_table?: string
}

// 多任务
export interface TrainingTask {
  id: number
  index: number
  title: string
  modelSource: 'existing' | 'previous'
  baseModel: string
  newModelName: string
  description: string
  datasetPath: string
  datasetName: string
  parameters: TrainingParams
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  totalEpochs: number
  errorMessage: string
}

// 数据集
export interface DatasetInfo {
  name: string
  path: string
}

// 每类评估指标行
export interface EvalTableRow {
  class: string
  images: number
  instances: number
  p: number
  r: number
  map50: number
  map50_95: number
}
