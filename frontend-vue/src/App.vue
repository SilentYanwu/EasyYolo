<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import {
  API_BASE_URL,
  clearHistory,
  deleteHistoryRecord,
  deleteModel,
  fetchHistory,
  fetchModels,
  fetchTrainingHistory,
  fetchTrainingProgress,
  predictSingleImage,
  renameModel,
  startTraining,
  streamBatchPredict,
  streamVideoPredict,
  switchModel,
  updateModelDescription,
  uploadDataset,
  uploadModel,
  yoloApiError,
} from '@/services/yoloApi'
import type {
  EditableModelCategory,
  InferenceHistoryRecord,
  ModelCategory,
  ModelCollections,
  PageName,
  TrainingParameters,
  TrainingProgressState,
  TrainingRecord,
} from '@/types/yolo'

/**
 * 本地存储键：用于记住页面和侧边栏状态。
 */
const LOCAL_STORAGE_KEYS = {
  activePage: 'easyyolo.active_page',
  collapsedSidebar: 'easyyolo.sidebar_collapsed',
} as const

const PAGE_NAMES: PageName[] = ['inference', 'training', 'details']
const MAX_BATCH_IMAGE_COUNT = 99
const MAX_THUMBNAIL_COUNT = 8

/**
 * 模型详情页固定展示的训练图文件列表。
 */
const TRAINING_CHART_FILES = [
  'results.png',
  'confusion_matrix.png',
  'confusion_matrix_normalized.png',
  'F1_curve.png',
  'PR_curve.png',
  'P_curve.png',
  'R_curve.png',
  'BoxF1_curve.png',
  'BoxPR_curve.png',
  'BoxP_curve.png',
  'BoxR_curve.png',
  'labels.jpg',
  'labels_correlogram.jpg',
] as const

/**
 * 训练指标中文解释。
 */
const METRIC_DESCRIPTION_MAP: Record<string, string> = {
  mAP50: 'IoU=0.50 时的平均精度，越高越好。',
  'mAP50-95': 'IoU=0.50~0.95 的综合平均精度，越高越好。',
  Precision: '预测为目标的结果中，正确比例有多高。',
  Recall: '真实目标中，被模型成功找回的比例。',
  'Box Loss': '框回归损失，越低越好。',
  'Cls Loss': '分类损失，越低越好。',
  'Dfl Loss': '分布焦点损失，越低越好。',
}

/**
 * 训练参数中文解释。
 */
const PARAMETER_DESCRIPTION_MAP: Record<string, string> = {
  epochs: '训练轮次',
  patience: '早停耐心值',
  batch: '批大小',
  imgsz: '输入图像尺寸',
  optimizer: '优化器',
  lr0: '初始学习率',
  lrf: '最终学习率系数',
  momentum: '动量',
  weight_decay: '权重衰减',
  warmup_epochs: '预热轮次',
  warmup_momentum: '预热动量',
  cos_lr: '是否使用余弦学习率',
  hsv_h: '色相增强',
  hsv_s: '饱和度增强',
  hsv_v: '亮度增强',
  degrees: '随机旋转角度',
  translate: '随机平移比例',
  scale: '随机缩放比例',
  shear: '随机错切角度',
  perspective: '透视变换比例',
  flipud: '上下翻转概率',
  fliplr: '左右翻转概率',
  mosaic: 'Mosaic 增强概率',
  mixup: 'MixUp 增强概率',
  copy_paste: 'Copy-Paste 增强概率',
  seed: '随机种子',
  workers: '数据加载线程数',
  device: '训练设备',
  amp: '混合精度训练',
}

/**
 * 训练图表中文说明。
 */
const CHART_DESCRIPTION_MAP: Record<(typeof TRAINING_CHART_FILES)[number], string> = {
  'results.png': '训练期间的关键指标总览图。',
  'confusion_matrix.png': '混淆矩阵，显示各类别间误判关系。',
  'confusion_matrix_normalized.png': '归一化混淆矩阵，更便于比较不同类别。',
  'F1_curve.png': 'F1 随阈值变化曲线。',
  'PR_curve.png': 'Precision-Recall 曲线，面积越大通常越好。',
  'P_curve.png': 'Precision 随阈值变化曲线。',
  'R_curve.png': 'Recall 随阈值变化曲线。',
  'BoxF1_curve.png': '检测框任务 F1 曲线。',
  'BoxPR_curve.png': '检测框任务 PR 曲线。',
  'BoxP_curve.png': '检测框任务 Precision 曲线。',
  'BoxR_curve.png': '检测框任务 Recall 曲线。',
  'labels.jpg': '标注数据分布可视化。',
  'labels_correlogram.jpg': '标注特征相关性图。',
}

/**
 * 训练参数默认值，直接对齐后端原始实现。
 */
function createDefaultTrainingParameters(): TrainingParameters {
  return {
    epochs: 5,
    patience: 50,
    batch: 16,
    imgsz: 640,
    optimizer: 'auto',
    lr0: 0.01,
    lrf: 0.01,
    momentum: 0.937,
    weight_decay: 0.0005,
    warmup_epochs: 3.0,
    warmup_momentum: 0.8,
    cos_lr: false,
    hsv_h: 0.015,
    hsv_s: 0.7,
    hsv_v: 0.4,
    degrees: 0,
    translate: 0.1,
    scale: 0.5,
    shear: 0,
    perspective: 0,
    flipud: 0,
    fliplr: 0.5,
    mosaic: 1,
    mixup: 0,
    copy_paste: 0,
    seed: 42,
    workers: 8,
    device: '',
    amp: true,
  }
}

/**
 * 训练进度默认值。
 */
function createDefaultTrainingProgressState(): TrainingProgressState {
  return {
    model_name: null,
    status: 'idle',
    progress: 0,
    total: 0,
    metrics: {},
    eta: '--',
    error_msg: '',
    start_time: 0,
    last_epoch_time: 0,
  }
}

/**
 * 将字符串规范化成 .pt 模型文件名。
 */
function normalizeModelFileName(modelName: string): string {
  return modelName.toLowerCase().endsWith('.pt') ? modelName : `${modelName}.pt`
}

/**
 * 安全 JSON 解析：发生异常时返回空对象，避免页面崩溃。
 */
function safelyParseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * 当前主页面状态。
 */
const activePage = ref<PageName>('inference')

/**
 * 侧边栏折叠状态（所有页面共享）。
 */
const isSidebarCollapsed = ref(false)

/**
 * 模型集合与当前推理模型。
 */
const modelCollections = reactive<ModelCollections>({
  raw: [],
  yolo: [],
  trained: [],
})
const currentModelName = ref('')

/**
 * 模型菜单状态：只允许一个菜单打开。
 */
const currentContextMenuKey = ref<string | null>(null)
const detailsActionMenuVisible = ref(false)

/**
 * 推理页文件输入与媒体展示状态。
 */
const imageInputElement = ref<HTMLInputElement | null>(null)
const videoInputElement = ref<HTMLInputElement | null>(null)
const resultVideoElement = ref<HTMLVideoElement | null>(null)

const selectedImageFiles = ref<File[]>([])
const selectedVideoFile = ref<File | null>(null)
const thumbnailPreviewUrls = ref<string[]>([])

const originalImageUrl = ref('')
const originalVideoUrl = ref('')
const resultImageUrl = ref('')
const resultVideoUrl = ref('')
const downloadResultUrl = ref('')

const statusText = ref('等待上传文件...')
const isPredicting = ref(false)

const batchProgressVisible = ref(false)
const batchProgressCurrent = ref(0)
const batchProgressTotal = ref(0)

const historyRecords = ref<InferenceHistoryRecord[]>([])

/**
 * 本地 ObjectURL 池，用于统一回收浏览器内存。
 */
const objectUrlPool = new Set<string>()

/**
 * 上传模型对话框状态。
 */
const uploadModelDialogVisible = ref(false)
const uploadModelFile = ref<File | null>(null)
const uploadModelCustomName = ref('')
const isUploadingModel = ref(false)

/**
 * 重命名对话框状态。
 */
const renameDialogVisible = ref(false)
const renameForm = reactive<{
  oldName: string
  newName: string
  category: EditableModelCategory
}>({
  oldName: '',
  newName: '',
  category: 'yolo',
})
const isRenamingModel = ref(false)

/**
 * 描述编辑对话框状态。
 */
const descriptionDialogVisible = ref(false)
const descriptionForm = reactive({
  modelName: '',
  content: '',
})
const isSavingDescription = ref(false)

/**
 * 训练页状态。
 */
const trainBaseModel = ref('')
const trainNewModelName = ref('')
const trainModelDescription = ref('')

const trainingDatasetInputElement = ref<HTMLInputElement | null>(null)
const uploadedDatasetPath = ref('')
const trainingDatasetDisplayName = ref('尚未上传数据集')
const isUploadingDataset = ref(false)

const trainingParametersDialogVisible = ref(false)
const trainingParameters = reactive<TrainingParameters>(createDefaultTrainingParameters())

const trainingProgressState = reactive<TrainingProgressState>(createDefaultTrainingProgressState())
const previousTrainingStatus = ref<TrainingProgressState['status']>('idle')
const isStartingTraining = ref(false)
let trainingPollingTimerId: number | null = null

/**
 * 模型详情页状态。
 */
const detailsModelName = ref('')
const modelDetails = ref<TrainingRecord | null>(null)
const isModelDetailsLoading = ref(false)
const chartCacheBuster = ref(Date.now())
const chartVisibleMap = reactive<Record<string, boolean>>({})

/**
 * 统一追加 ObjectURL 到池中，方便后续清理。
 */
function rememberObjectUrl(url: string): string {
  objectUrlPool.add(url)
  return url
}

/**
 * 基于文件创建 ObjectURL。
 */
function createObjectUrl(file: File): string {
  return rememberObjectUrl(URL.createObjectURL(file))
}

/**
 * 页面切换时清理所有临时 URL，防止内存泄露。
 */
function revokeAllObjectUrls(): void {
  for (const objectUrl of objectUrlPool) {
    URL.revokeObjectURL(objectUrl)
  }
  objectUrlPool.clear()
}

/**
 * 工具函数：判断 URL 是否为视频结果。
 */
function isVideoResultUrl(resultUrl: string): boolean {
  return resultUrl.toLowerCase().endsWith('.mp4')
}

/**
 * 推理输入区域是否可以点击“开始识别”。
 */
const canStartPrediction = computed(() => {
  if (isPredicting.value) {
    return false
  }

  return selectedVideoFile.value !== null || selectedImageFiles.value.length > 0
})

/**
 * 批量缩略图展示（最多显示前 N 张）。
 */
const visibleThumbnailUrls = computed(() => thumbnailPreviewUrls.value.slice(0, MAX_THUMBNAIL_COUNT))
const hiddenThumbnailCount = computed(() =>
  Math.max(0, selectedImageFiles.value.length - visibleThumbnailUrls.value.length),
)

/**
 * 批量进度百分比。
 */
const batchProgressPercent = computed(() => {
  if (batchProgressTotal.value <= 0) {
    return 0
  }

  return Math.min(100, Math.round((batchProgressCurrent.value / batchProgressTotal.value) * 100))
})

/**
 * 历史记录面板是否为空。
 */
const historyIsEmpty = computed(() => historyRecords.value.length === 0)

/**
 * 训练页是否已上传数据集。
 */
const trainingDatasetUploaded = computed(() => Boolean(uploadedDatasetPath.value))

/**
 * 训练页是否应显示 Dashboard。
 */
const shouldShowTrainingDashboard = computed(() => {
  // 当训练状态为training、success或error时显示Dashboard
  // 同时确保当前页面是训练页面
  return activePage.value === 'training' && 
         ['training', 'success', 'error'].includes(trainingProgressState.status)
})

/**
 * 训练进度百分比。
 */
const trainingProgressPercent = computed(() => {
  if (trainingProgressState.total <= 0) {
    return 0
  }

  return Math.min(100, (trainingProgressState.progress / trainingProgressState.total) * 100)
})

/**
 * 训练指标键值数组，用于模板遍历。
 */
const trainingMetricEntries = computed(() => Object.entries(trainingProgressState.metrics ?? {}))

/**
 * 顶部导航当前页面对应标题。
 */
const currentPageTitle = computed(() => {
  if (activePage.value === 'inference') {
    return '图像识别推理'
  }

  if (activePage.value === 'training') {
    return '模型训练管理'
  }

  return '模型详情分析'
})

/**
 * 训练页模型下拉统一数据源（raw + yolo + trained）。
 */
const trainingBaseModelOptions = computed(() => [
  ...modelCollections.raw,
  ...modelCollections.yolo,
  ...modelCollections.trained,
])

/**
 * 详情页参数表数据。
 */
const detailParameterEntries = computed(() => {
  const rawParameters = modelDetails.value?.parameters ?? ''
  const parsed = safelyParseJsonRecord(rawParameters)

  return Object.entries(parsed).map(([key, value]) => ({
    key,
    value: String(value),
    description: PARAMETER_DESCRIPTION_MAP[key] ?? '暂无参数说明。',
  }))
})

/**
 * 详情页最终指标数据。
 */
const detailFinalMetricEntries = computed(() => {
  const rawMetrics = modelDetails.value?.final_metrics ?? ''
  const parsed = safelyParseJsonRecord(rawMetrics)

  return Object.entries(parsed).map(([key, value]) => ({
    key,
    value: String(value),
    description: METRIC_DESCRIPTION_MAP[key] ?? '暂无指标说明。',
  }))
})

/**
 * 设置 activePage，同时触发存储与数据同步逻辑。
 */
function switchPage(nextPage: PageName): void {
  activePage.value = nextPage
}

/**
 * 控制全局侧边栏收起/展开。
 */
function toggleSidebarCollapse(nextCollapsed?: boolean): void {
  isSidebarCollapsed.value = typeof nextCollapsed === 'boolean' ? nextCollapsed : !isSidebarCollapsed.value
}

/**
 * 统一生成模型操作菜单 key。
 */
function buildModelMenuKey(scope: string, category: ModelCategory, modelName: string): string {
  return `${scope}-${category}-${modelName}`
}

/**
 * 打开/关闭某个模型菜单。
 */
function toggleModelMenu(menuKey: string): void {
  detailsActionMenuVisible.value = false
  currentContextMenuKey.value = currentContextMenuKey.value === menuKey ? null : menuKey
}

/**
 * 关闭所有右键菜单/操作菜单。
 */
function closeAllContextMenus(): void {
  currentContextMenuKey.value = null
  detailsActionMenuVisible.value = false
}

/**
 * 详情页专属操作菜单开关。
 */
function toggleDetailsActionMenu(): void {
  currentContextMenuKey.value = null
  detailsActionMenuVisible.value = !detailsActionMenuVisible.value
}

/**
 * 页面级点击事件：用于点击空白处时关闭菜单。
 */
function handleGlobalDocumentClick(): void {
  closeAllContextMenus()
}

/**
 * 根据模型名查找它所属的分类目录。
 */
function findModelCategory(modelName: string): ModelCategory | null {
  if (modelCollections.raw.includes(modelName)) {
    return 'raw'
  }

  if (modelCollections.yolo.includes(modelName)) {
    return 'yolo'
  }

  if (modelCollections.trained.includes(modelName)) {
    return 'trained'
  }

  return null
}

/**
 * 选择“最合适的详情模型”：
 * 1. 优先使用传入模型名
 * 2. 不存在则回退当前 detailsModelName
 * 3. 最后兜底 trained 列表第一项
 */
function resolveDetailsModelName(preferredModelName?: string): string {
  const trainedModels = modelCollections.trained
  const candidates = [preferredModelName, detailsModelName.value].filter((item): item is string => Boolean(item))

  for (const candidate of candidates) {
    if (trainedModels.includes(candidate)) {
      return candidate
    }

    const normalizedCandidate = normalizeModelFileName(candidate)
    if (trainedModels.includes(normalizedCandidate)) {
      return normalizedCandidate
    }
  }

  return trainedModels[0] ?? ''
}

/**
 * 推理显示区复位。
 */
function resetInferenceDisplay(options?: { preserveStatusText?: boolean }): void {
  originalImageUrl.value = ''
  originalVideoUrl.value = ''
  resultImageUrl.value = ''
  resultVideoUrl.value = ''
  downloadResultUrl.value = ''
  batchProgressVisible.value = false
  batchProgressCurrent.value = 0
  batchProgressTotal.value = 0
  thumbnailPreviewUrls.value = []

  if (!options?.preserveStatusText) {
    statusText.value = '等待上传文件...'
  }
}

/**
 * 打开图片文件选择器。
 */
function openImageFilePicker(): void {
  imageInputElement.value?.click()
}

/**
 * 打开视频文件选择器。
 */
function openVideoFilePicker(): void {
  videoInputElement.value?.click()
}

/**
 * 图片输入变化：支持单图与多图两种模式。
 */
function handleImageInputChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])

  if (files.length === 0) {
    return
  }

  if (files.length > MAX_BATCH_IMAGE_COUNT) {
    ElMessage.warning(`最多支持 ${MAX_BATCH_IMAGE_COUNT} 张图片批量推理。`)
    input.value = ''
    return
  }

  revokeAllObjectUrls()
  selectedVideoFile.value = null
  selectedImageFiles.value = files
  resetInferenceDisplay({ preserveStatusText: true })
  videoInputElement.value && (videoInputElement.value.value = '')

  if (files.length === 1) {
    const imageFile = files[0]
    if (imageFile) {
      originalImageUrl.value = createObjectUrl(imageFile)
    }
    statusText.value = '图片已加载，点击“开始识别”即可推理。'
    return
  }

  thumbnailPreviewUrls.value = files.map((fileItem) => createObjectUrl(fileItem))
  statusText.value = `已选择 ${files.length} 张图片，准备批量识别。`
}

/**
 * 视频输入变化：进入视频推理模式。
 */
function handleVideoInputChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file) {
    return
  }

  revokeAllObjectUrls()
  selectedImageFiles.value = []
  selectedVideoFile.value = file
  resetInferenceDisplay({ preserveStatusText: true })
  imageInputElement.value && (imageInputElement.value.value = '')

  originalVideoUrl.value = createObjectUrl(file)
  statusText.value = '视频已加载，点击“开始识别”进行处理。'
}

/**
 * 执行单图推理。
 */
async function predictSingleImageFlow(imageFile: File): Promise<void> {
  statusText.value = '正在识别图片...'
  const response = await predictSingleImage(imageFile)
  originalImageUrl.value = response.original_url || originalImageUrl.value
  resultImageUrl.value = response.result_url
  downloadResultUrl.value = response.result_url
  statusText.value = '识别完成。'
  await refreshHistoryRecords()
}

/**
 * 执行批量图片推理（流式）。
 */
async function predictBatchImageFlow(imageFiles: File[]): Promise<void> {
  statusText.value = '正在进行批量识别...'
  batchProgressVisible.value = true
  batchProgressCurrent.value = 0
  batchProgressTotal.value = imageFiles.length

  await streamBatchPredict(imageFiles, (event) => {
    if (event.error) {
      statusText.value = `处理文件失败：${event.filename ?? 'unknown'}`
      return
    }

    if (event.done) {
      batchProgressCurrent.value = batchProgressTotal.value
      statusText.value = '批量识别完成。'
      return
    }

    if (typeof event.current === 'number') {
      batchProgressCurrent.value = event.current
    }

    if (typeof event.total === 'number') {
      batchProgressTotal.value = event.total
    }

    if (event.original_url) {
      originalImageUrl.value = event.original_url
    }

    if (event.result_url) {
      resultImageUrl.value = event.result_url
      downloadResultUrl.value = event.result_url
    }
  })

  await refreshHistoryRecords()
}

/**
 * 执行视频推理（流式）。
 */
async function predictVideoFlow(videoFile: File): Promise<void> {
  statusText.value = '正在处理视频...'
  batchProgressVisible.value = true
  batchProgressCurrent.value = 0
  batchProgressTotal.value = 100

  let streamErrorMessage = ''

  await streamVideoPredict(videoFile, (event) => {
    if (event.error) {
      streamErrorMessage = event.error
      return
    }

    if (event.status === 'processing') {
      if (typeof event.percent === 'number') {
        batchProgressCurrent.value = event.percent
      }
      statusText.value = `视频处理中：${event.current_frame ?? 0}/${event.total_frames ?? 0}`
      return
    }

    if (event.done || event.status === 'completed') {
      batchProgressCurrent.value = 100
      batchProgressTotal.value = 100

      if (event.original_url) {
        originalVideoUrl.value = event.original_url
      }

      if (event.result_url) {
        resultVideoUrl.value = event.result_url
        downloadResultUrl.value = event.result_url
      }

      statusText.value = '视频识别完成。'
    }
  })

  if (streamErrorMessage) {
    throw new Error(streamErrorMessage)
  }

  await refreshHistoryRecords()
}

/**
 * 推理主入口：
 * 根据当前输入自动分发到单图、批量图或视频流程。
 */
async function startPrediction(): Promise<void> {
  if (!canStartPrediction.value) {
    return
  }

  isPredicting.value = true

  try {
    if (selectedVideoFile.value) {
      await predictVideoFlow(selectedVideoFile.value)
      return
    }

    if (selectedImageFiles.value.length === 1) {
      const imageFile = selectedImageFiles.value[0]
      if (imageFile) {
        await predictSingleImageFlow(imageFile)
      }
      return
    }

    if (selectedImageFiles.value.length > 1) {
      await predictBatchImageFlow(selectedImageFiles.value)
    }
  } catch (error) {
    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
    statusText.value = '识别失败，请检查后端服务状态。'
  } finally {
    isPredicting.value = false
  }
}

/**
 * 推理结果视频播放/暂停。
 */
function toggleResultVideoPlayback(): void {
  const videoElement = resultVideoElement.value

  if (!videoElement) {
    return
  }

  if (videoElement.paused) {
    void videoElement.play()
  } else {
    videoElement.pause()
  }
}

/**
 * 刷新历史记录（以当前推理模型为维度）。
 */
async function refreshHistoryRecords(): Promise<void> {
  if (!currentModelName.value) {
    historyRecords.value = []
    return
  }

  historyRecords.value = await fetchHistory(currentModelName.value)
}

/**
 * 点击历史记录后恢复展示对应结果。
 */
function previewHistoryRecord(record: InferenceHistoryRecord): void {
  revokeAllObjectUrls()
  resetInferenceDisplay({ preserveStatusText: true })

  const isVideoRecord = isVideoResultUrl(record.result)
  if (isVideoRecord) {
    originalVideoUrl.value = record.original
    resultVideoUrl.value = record.result
  } else {
    originalImageUrl.value = record.original
    resultImageUrl.value = record.result
  }

  downloadResultUrl.value = record.result
  statusText.value = '已加载历史记录。'
}

/**
 * 删除单条历史记录。
 */
async function confirmDeleteHistoryRecord(recordId: number): Promise<void> {
  try {
    await ElMessageBox.confirm('确定删除这条历史记录吗？该操作不可恢复。', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })

    await deleteHistoryRecord(recordId)
    await refreshHistoryRecords()
    ElMessage.success('历史记录已删除。')
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return
    }

    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  }
}

/**
 * 清空当前模型全部历史记录。
 */
async function confirmClearHistory(): Promise<void> {
  if (!currentModelName.value) {
    return
  }

  try {
    await ElMessageBox.confirm('确定清空当前模型的全部历史记录吗？', '清空确认', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
    })

    await clearHistory(currentModelName.value)
    await refreshHistoryRecords()
    ElMessage.success('历史记录已清空。')
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return
    }

    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  }
}

/**
 * 上传模型对话框：文件变更处理。
 */
function handleUploadModelFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  uploadModelFile.value = input.files?.[0] ?? null
}

/**
 * 重置上传模型对话框状态。
 */
function resetUploadModelDialog(): void {
  uploadModelFile.value = null
  uploadModelCustomName.value = ''
}

/**
 * 提交上传模型。
 */
async function submitUploadModel(): Promise<void> {
  if (!uploadModelFile.value) {
    ElMessage.warning('请先选择模型文件。')
    return
  }

  const customModelName = uploadModelCustomName.value.trim()
  if (!customModelName) {
    ElMessage.warning('请填写模型名称。')
    return
  }

  isUploadingModel.value = true

  try {
    await uploadModel(uploadModelFile.value, customModelName)
    uploadModelDialogVisible.value = false
    resetUploadModelDialog()
    await synchronizeModelState()
    ElMessage.success('模型上传成功。')
  } catch (error) {
    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  } finally {
    isUploadingModel.value = false
  }
}

/**
 * 打开重命名对话框。
 */
function openRenameDialog(modelName: string, category: EditableModelCategory): void {
  closeAllContextMenus()
  renameForm.oldName = modelName
  renameForm.newName = modelName.replace(/\.pt$/i, '')
  renameForm.category = category
  renameDialogVisible.value = true
}

/**
 * 提交模型重命名。
 */
async function submitRenameModel(): Promise<void> {
  const nextModelNameInput = renameForm.newName.trim()
  if (!nextModelNameInput) {
    ElMessage.warning('新模型名称不能为空。')
    return
  }

  const nextModelFileName = normalizeModelFileName(nextModelNameInput)
  const oldModelFileName = renameForm.oldName

  isRenamingModel.value = true

  try {
    await renameModel(oldModelFileName, nextModelNameInput, renameForm.category)
    renameDialogVisible.value = false

    const preferredDetailModelName =
      detailsModelName.value === oldModelFileName ? nextModelFileName : undefined

    await synchronizeModelState(preferredDetailModelName)
    ElMessage.success('模型重命名成功。')
  } catch (error) {
    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  } finally {
    isRenamingModel.value = false
  }
}

/**
 * 打开编辑描述对话框。
 */
async function openDescriptionDialog(modelName: string): Promise<void> {
  closeAllContextMenus()
  descriptionForm.modelName = modelName
  descriptionForm.content = ''
  descriptionDialogVisible.value = true

  try {
    const response = await fetchTrainingHistory(modelName)
    if (response.status === 'success' && response.data) {
      descriptionForm.content = response.data.description ?? ''
    }
  } catch (error) {
    ElMessage.warning(`读取旧描述失败：${yoloApiError.toReadableErrorMessage(error)}`)
  }
}

/**
 * 提交模型描述修改。
 */
async function submitDescriptionUpdate(): Promise<void> {
  if (!descriptionForm.modelName) {
    return
  }

  isSavingDescription.value = true

  try {
    await updateModelDescription(descriptionForm.modelName, descriptionForm.content.trim())
    descriptionDialogVisible.value = false

    if (detailsModelName.value === descriptionForm.modelName) {
      await loadModelDetails(descriptionForm.modelName)
    }

    ElMessage.success('模型描述已更新。')
  } catch (error) {
    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  } finally {
    isSavingDescription.value = false
  }
}

/**
 * 删除模型前确认。
 */
async function confirmDeleteModel(modelName: string, category: EditableModelCategory): Promise<void> {
  closeAllContextMenus()

  try {
    await ElMessageBox.confirm(`确定删除模型 ${modelName} 吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })

    await deleteModel(modelName, category)

    const preferredDetailModelName = detailsModelName.value === modelName ? '' : detailsModelName.value
    await synchronizeModelState(preferredDetailModelName)

    ElMessage.success('模型已删除。')
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return
    }

    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  }
}

/**
 * 推理页切换模型。
 */
async function handleInferenceModelSwitch(modelName: string, category: ModelCategory): Promise<void> {
  if (modelName === currentModelName.value) {
    return
  }

  try {
    await switchModel(modelName, category)
    await synchronizeModelState()
    statusText.value = `当前模型：${modelName}`
    ElMessage.success(`已切换到模型 ${modelName}`)
  } catch (error) {
    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  }
}

/**
 * 详情页切换训练模型。
 */
async function handleDetailsModelSwitch(modelName: string): Promise<void> {
  if (modelName === detailsModelName.value && modelDetails.value) {
    return
  }

  detailsModelName.value = modelName
  await loadModelDetails(modelName)
}

/**
 * 打开训练数据集选择器。
 */
function openDatasetFilePicker(): void {
  trainingDatasetInputElement.value?.click()
}

/**
 * 处理训练数据集上传。
 */
async function handleDatasetFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const datasetFile = input.files?.[0]

  if (!datasetFile) {
    return
  }

  isUploadingDataset.value = true
  trainingDatasetDisplayName.value = '正在上传并校验数据集...'

  try {
    const { dataset_path } = await uploadDataset(datasetFile)
    uploadedDatasetPath.value = dataset_path
    trainingDatasetDisplayName.value = `已上传：${datasetFile.name}`
    ElMessage.success('数据集上传成功。')
  } catch (error) {
    uploadedDatasetPath.value = ''
    trainingDatasetDisplayName.value = '上传失败，请重新选择。'
    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  } finally {
    isUploadingDataset.value = false
    input.value = ''
  }
}

/**
 * 启动训练任务。
 */
async function startTrainingTask(): Promise<void> {
  if (!trainBaseModel.value) {
    ElMessage.warning('请先选择基础模型。')
    return
  }

  if (!trainNewModelName.value.trim()) {
    ElMessage.warning('请填写新模型名称。')
    return
  }

  if (!uploadedDatasetPath.value) {
    ElMessage.warning('请先上传并校验训练数据集。')
    return
  }

  isStartingTraining.value = true

  try {
    await startTraining({
      modelName: trainNewModelName.value.trim(),
      baseModel: trainBaseModel.value,
      datasetYamlPath: uploadedDatasetPath.value,
      description: trainModelDescription.value.trim(),
      parameters: { ...trainingParameters },
    })

    trainingProgressState.status = 'training'
    trainingProgressState.progress = 0
    trainingProgressState.total = trainingParameters.epochs
    trainingProgressState.metrics = {}
    trainingProgressState.eta = '训练任务已提交，等待后端启动...'
    previousTrainingStatus.value = 'training'

    ElMessage.success('训练任务已提交，请关注下方实时进度。')
  } catch (error) {
    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  } finally {
    isStartingTraining.value = false
  }
}

/**
 * 轮询训练进度一次，并处理状态迁移通知。
 */
async function pollTrainingProgressOnce(): Promise<void> {
  try {
    const latestState = await fetchTrainingProgress()
    Object.assign(trainingProgressState, latestState)

    const latestStatus = latestState.status
    if (previousTrainingStatus.value === 'training' && latestStatus === 'success') {
      const preferredModelName = latestState.model_name ? normalizeModelFileName(latestState.model_name) : undefined
      await synchronizeModelState(preferredModelName)
      ElMessage.success(`训练完成：${latestState.model_name ?? '新模型'}`)
    }

    if (previousTrainingStatus.value === 'training' && latestStatus === 'error') {
      ElMessage.error(`训练失败：${latestState.error_msg || '未知错误'}`)
    }

    previousTrainingStatus.value = latestStatus
  } catch {
    // 轮询失败通常是后端暂时不可达，不打断页面操作，仅静默重试。
  }
}

/**
 * 开始训练进度轮询。
 */
function startTrainingProgressPolling(): void {
  if (trainingPollingTimerId !== null) {
    window.clearInterval(trainingPollingTimerId)
    trainingPollingTimerId = null
  }

  void pollTrainingProgressOnce()
  trainingPollingTimerId = window.setInterval(() => {
    void pollTrainingProgressOnce()
  }, 2000)
}

/**
 * 停止训练进度轮询。
 */
function stopTrainingProgressPolling(): void {
  if (trainingPollingTimerId !== null) {
    window.clearInterval(trainingPollingTimerId)
    trainingPollingTimerId = null
  }
}

/**
 * 重置图表可见性（每次切换详情模型时重置）。
 */
function resetChartVisibleMap(): void {
  for (const chartFileName of TRAINING_CHART_FILES) {
    chartVisibleMap[chartFileName] = true
  }
}

/**
 * 模型详情加载。
 */
async function loadModelDetails(modelName: string): Promise<void> {
  if (!modelName) {
    modelDetails.value = null
    return
  }

  isModelDetailsLoading.value = true

  try {
    const response = await fetchTrainingHistory(modelName)
    if (response.status === 'success' && response.data) {
      modelDetails.value = response.data
      detailsModelName.value = modelName
      chartCacheBuster.value = Date.now()
      resetChartVisibleMap()
      return
    }

    modelDetails.value = null
  } catch (error) {
    modelDetails.value = null
    ElMessage.error(yoloApiError.toReadableErrorMessage(error))
  } finally {
    isModelDetailsLoading.value = false
  }
}

/**
 * 详情页图表 URL（附加时间戳避免缓存）。
 */
function getChartImageUrl(chartFileName: (typeof TRAINING_CHART_FILES)[number]): string {
  const modelFolderName = detailsModelName.value.replace(/\.pt$/i, '')
  return `${API_BASE_URL}/trainchart/${encodeURIComponent(modelFolderName)}/${chartFileName}?t=${chartCacheBuster.value}`
}

/**
 * 图表加载失败时隐藏该图，避免出现破图占位。
 */
function handleChartLoadError(chartFileName: string): void {
  // 设置图表不可见
  chartVisibleMap[chartFileName] = false
  // 显示提示信息
  console.log(`图表 ${chartFileName} 加载失败，已隐藏`)
}

/**
 * 点击基础模型链接：
 * 1. 若基础模型也是 trained 模型，则直接在详情页切换
 * 2. 否则切换到推理页并切换当前推理模型
 */
async function openBaseModelReference(): Promise<void> {
  const baseModelName = modelDetails.value?.base_model
  if (!baseModelName) {
    return
  }

  const matchedCategory = findModelCategory(baseModelName)
  if (!matchedCategory) {
    ElMessage.warning('未在当前模型列表中找到该基础模型。')
    return
  }

  if (matchedCategory === 'trained') {
    activePage.value = 'details'
    await handleDetailsModelSwitch(baseModelName)
    return
  }

  activePage.value = 'inference'
  await handleInferenceModelSwitch(baseModelName, matchedCategory)
}

/**
 * 刷新模型集合，并同步所有依赖模型名的页面状态。
 */
async function synchronizeModelState(preferredDetailModelName?: string): Promise<void> {
  const response = await fetchModels()

  modelCollections.raw = [...response.models.raw]
  modelCollections.yolo = [...response.models.yolo]
  modelCollections.trained = [...response.models.trained]
  currentModelName.value = response.current_model

  if (!trainingBaseModelOptions.value.includes(trainBaseModel.value)) {
    trainBaseModel.value = currentModelName.value
  }

  detailsModelName.value = resolveDetailsModelName(preferredDetailModelName)

  await refreshHistoryRecords()

  if (activePage.value === 'details') {
    if (detailsModelName.value) {
      await loadModelDetails(detailsModelName.value)
    } else {
      modelDetails.value = null
    }
  }
}

/**
 * 根据 localStorage 恢复用户上次界面偏好。
 */
function restoreUiPreferences(): void {
  const savedPage = localStorage.getItem(LOCAL_STORAGE_KEYS.activePage)
  if (savedPage && (PAGE_NAMES as readonly string[]).includes(savedPage)) {
    activePage.value = savedPage as PageName
  }

  isSidebarCollapsed.value = localStorage.getItem(LOCAL_STORAGE_KEYS.collapsedSidebar) === 'true'
}

/**
 * 页面初始化流程。
 */
async function initializeApplication(): Promise<void> {
  restoreUiPreferences()
  resetChartVisibleMap()
  startTrainingProgressPolling()
  await synchronizeModelState()

  if (activePage.value === 'details' && detailsModelName.value) {
    await loadModelDetails(detailsModelName.value)
  }
}

/**
 * 顶部页面切换后持久化当前页面。
 */
watch(activePage, async (nextPage) => {
  localStorage.setItem(LOCAL_STORAGE_KEYS.activePage, nextPage)
  closeAllContextMenus()

  if (nextPage === 'details' && detailsModelName.value && !modelDetails.value) {
    await loadModelDetails(detailsModelName.value)
  }
})

/**
 * 侧边栏折叠状态持久化。
 */
watch(isSidebarCollapsed, (collapsed) => {
  localStorage.setItem(LOCAL_STORAGE_KEYS.collapsedSidebar, String(collapsed))
})

onMounted(() => {
  document.addEventListener('click', handleGlobalDocumentClick)
  void initializeApplication()
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalDocumentClick)
  stopTrainingProgressPolling()
  revokeAllObjectUrls()
})
</script>

<template>
  <header class="global-header">
    <div class="logo">EASY YOLO</div>
    <nav class="top-nav">
      <button class="top-nav-btn" :class="{ active: activePage === 'inference' }" @click="switchPage('inference')">
        YOLO识别
      </button>
      <button class="top-nav-btn" :class="{ active: activePage === 'training' }" @click="switchPage('training')">
        YOLO训练
      </button>
      <button class="top-nav-btn" :class="{ active: activePage === 'details' }" @click="switchPage('details')">
        YOLO模型详情
      </button>
    </nav>
  </header>

  <div v-show="activePage === 'inference'" class="app-container" :class="{ 'page-active': activePage === 'inference' }">
    <aside class="sidebar" :class="{ collapsed: isSidebarCollapsed }">
      <div class="sidebar-header">
        <button class="sidebar-close-btn" title="收起侧边栏" @click="toggleSidebarCollapse(true)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
      </div>

      <div class="model-section">
        <h3>内置模型 (Raw)</h3>
        <div class="model-list">
          <div
            v-for="modelName in modelCollections.raw"
            :key="`inference-raw-${modelName}`"
            class="model-item"
            :class="{ active: modelName === currentModelName }"
            @click="handleInferenceModelSwitch(modelName, 'raw')"
          >
            <span class="model-name">{{ modelName }}</span>
          </div>
        </div>

        <h3>导入模型 (Yolo)</h3>
        <div class="model-list">
          <div
            v-for="modelName in modelCollections.yolo"
            :key="`inference-yolo-${modelName}`"
            class="model-item"
            :class="{ active: modelName === currentModelName }"
            @click="handleInferenceModelSwitch(modelName, 'yolo')"
          >
            <span class="model-name">{{ modelName }}</span>
            <div class="menu-trigger" @click.stop="toggleModelMenu(buildModelMenuKey('inference', 'yolo', modelName))">
              ⋮
            </div>
            <div
              class="context-menu"
              :class="{ show: currentContextMenuKey === buildModelMenuKey('inference', 'yolo', modelName) }"
              @click.stop
            >
              <div class="context-menu-item" @click="openRenameDialog(modelName, 'yolo')">重命名</div>
              <div class="context-menu-item" @click="openDescriptionDialog(modelName)">编辑描述</div>
              <div class="context-menu-item danger" @click="confirmDeleteModel(modelName, 'yolo')">删除模型</div>
            </div>
          </div>
        </div>

        <h3>训练模型 (Trained)</h3>
        <div class="model-list">
          <div
            v-for="modelName in modelCollections.trained"
            :key="`inference-trained-${modelName}`"
            class="model-item"
            :class="{ active: modelName === currentModelName }"
            @click="handleInferenceModelSwitch(modelName, 'trained')"
          >
            <span class="model-name">{{ modelName }}</span>
            <div class="menu-trigger" @click.stop="toggleModelMenu(buildModelMenuKey('inference', 'trained', modelName))">
              ⋮
            </div>
            <div
              class="context-menu"
              :class="{ show: currentContextMenuKey === buildModelMenuKey('inference', 'trained', modelName) }"
              @click.stop
            >
              <div class="context-menu-item" @click="openRenameDialog(modelName, 'trained')">重命名</div>
              <div class="context-menu-item" @click="openDescriptionDialog(modelName)">编辑描述</div>
              <div class="context-menu-item danger" @click="confirmDeleteModel(modelName, 'trained')">删除模型</div>
            </div>
          </div>
        </div>

        <button class="btn-outline" @click="uploadModelDialogVisible = true">+ 导入新模型</button>
      </div>
    </aside>

    <main class="main-content">
      <header class="top-bar">
        <button class="open-sidebar-btn" :class="{ visible: isSidebarCollapsed }" title="展开侧边栏" @click="toggleSidebarCollapse(false)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
        <h1>{{ currentPageTitle }}</h1>
      </header>

      <div class="workspace">
        <div class="control-panel">
          <input ref="imageInputElement" type="file" accept="image/*" multiple hidden @change="handleImageInputChange" />
          <input ref="videoInputElement" type="file" accept="video/*" hidden @change="handleVideoInputChange" />

          <button class="btn primary" @click="openImageFilePicker">上传图片</button>
          <button class="btn info" @click="openVideoFilePicker">上传视频</button>
          <button class="btn success" :disabled="!canStartPrediction" @click="startPrediction">
            {{ isPredicting ? '识别中...' : '开始识别' }}
          </button>
          <span id="statusText">{{ statusText }}</span>
        </div>

        <div v-if="selectedImageFiles.length > 1" class="thumbnail-preview">
          <div v-for="thumbnailUrl in visibleThumbnailUrls" :key="thumbnailUrl" class="thumbnail-item">
            <img :src="thumbnailUrl" alt="thumbnail" />
          </div>
          <div v-if="hiddenThumbnailCount > 0" class="thumbnail-more">+{{ hiddenThumbnailCount }}</div>
          <span class="thumbnail-count">共 {{ selectedImageFiles.length }} 张图片</span>
        </div>

        <div v-if="batchProgressVisible" class="batch-progress">
          <div class="progress-info">
            <span class="progress-label">批量识别进度</span>
            <span class="progress-text">{{ batchProgressCurrent }}/{{ batchProgressTotal }}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :class="{ done: batchProgressPercent === 100 }" :style="{ width: `${batchProgressPercent}%` }"></div>
          </div>
        </div>

        <div class="display-area">
          <div class="image-box">
            <div class="box-header">
              <h4>原始输入</h4>
            </div>
            <div class="img-wrapper" data-placeholder="请先上传图片或视频">
              <img v-show="Boolean(originalImageUrl)" :src="originalImageUrl" alt="original" />
              <video
                v-show="Boolean(originalVideoUrl)"
                :src="originalVideoUrl"
                controls
                muted
                playsinline
                style="width: 100%; height: 100%; object-fit: contain"
              ></video>
            </div>
          </div>

          <div class="image-box">
            <div class="box-header">
              <h4>识别结果</h4>
              <div class="actions">
                <button v-if="resultVideoUrl" class="btn-action btn-brown" @click="toggleResultVideoPlayback">播放/暂停</button>
                <a v-if="downloadResultUrl" :href="downloadResultUrl" class="btn-action btn-purple" download>下载结果</a>
              </div>
            </div>
            <div class="img-wrapper" data-placeholder="识别结果将在这里显示">
              <img v-show="Boolean(resultImageUrl)" :src="resultImageUrl" alt="result" />
              <video
                v-show="Boolean(resultVideoUrl)"
                ref="resultVideoElement"
                :src="resultVideoUrl"
                controls
                muted
                playsinline
                style="width: 100%; height: 100%; object-fit: contain"
              ></video>
            </div>
          </div>
        </div>

        <div class="history-panel">
          <div class="panel-header">
            <h3>推理历史（当前模型：<span id="currentModelName">{{ currentModelName || '未选择' }}</span>）</h3>
            <button class="btn-text" :class="{ empty: historyIsEmpty }" @click="confirmClearHistory">清空历史</button>
          </div>

          <div v-if="historyIsEmpty" class="empty-history">暂无历史记录</div>
          <div v-else class="history-grid">
            <div
              v-for="record in historyRecords"
              :key="record.id"
              class="history-item"
              :class="{ 'video-type': isVideoResultUrl(record.result) }"
              @click="previewHistoryRecord(record)"
            >
              <template v-if="isVideoResultUrl(record.result)">
                <div class="video-placeholder">
                  <svg viewBox="0 0 24 24" width="40" height="40" fill="white">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </template>
              <template v-else>
                <img :src="record.result" alt="history result" />
              </template>

              <span>{{ record.time }}</span>
              <div class="delete-record-btn" title="删除记录" @click.stop="confirmDeleteHistoryRecord(record.id)">×</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div v-show="activePage === 'training'" class="app-container" :class="{ 'page-active': activePage === 'training' }">
    <aside class="sidebar" :class="{ collapsed: isSidebarCollapsed }">
      <div class="sidebar-header">
        <button class="sidebar-close-btn" title="收起侧边栏" @click="toggleSidebarCollapse(true)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
      </div>

      <div class="model-section training-guide">
        <h3>训练操作指引</h3>
        <div>
          <div class="guide-item">
            <b style="color: #60a5fa">1. 选择基础模型</b>
            推荐先从小模型开始试训，再逐步升级到更大模型。
          </div>
          <div class="guide-item" style="border-left-color: #8b5cf6">
            <b style="color: #a78bfa">2. 命名新模型</b>
            建议包含业务语义，例如 <code>steel_v1</code>、<code>pcb_defect_v2</code>。
          </div>
          <div class="guide-item" style="border-left-color: #10b981">
            <b style="color: #34d399">3. 上传数据集</b>
            上传 YOLO 结构的 ZIP 压缩包，系统会自动校验 <code>data.yaml</code>。
          </div>
          <div class="guide-item" style="border-left-color: #f59e0b">
            <b style="color: #fbbf24">4. 调整训练参数</b>
            可从默认参数开始，确认流程正常后再精调学习率、增强参数等。
          </div>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <header class="top-bar">
        <button class="open-sidebar-btn" :class="{ visible: isSidebarCollapsed }" title="展开侧边栏" @click="toggleSidebarCollapse(false)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
        <h1>{{ currentPageTitle }}</h1>
      </header>

      <div id="training-workspace" class="workspace">
        <div class="control-panel training-controls">
          <div class="training-controls-header">
            <span class="training-controls-icon">⚙️</span>
            <h2>训练任务配置</h2>
          </div>

          <div class="training-row">
            <div class="form-group">
              <label class="label-primary">基础模型</label>
              <select v-model="trainBaseModel" class="form-select">
                <option v-for="modelName in trainingBaseModelOptions" :key="`base-${modelName}`" :value="modelName">
                  {{ modelName }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label class="label-purple">新模型名称</label>
              <input v-model.trim="trainNewModelName" type="text" class="form-input" placeholder="例如：steel_defect_v1" />
            </div>
            <div class="form-group">
              <label class="label-success">模型描述</label>
              <input
                v-model.trim="trainModelDescription"
                type="text"
                class="form-input"
                placeholder="例如：钢板表面缺陷检测第一版"
              />
            </div>
          </div>

          <div class="training-row dataset-upload-section">
            <div class="form-group">
              <label class="label-warning">训练数据集（ZIP）</label>
              <div class="dataset-upload-controls">
                <input ref="trainingDatasetInputElement" type="file" accept=".zip" hidden @change="handleDatasetFileChange" />
                <button class="btn info" :disabled="isUploadingDataset" @click="openDatasetFilePicker">
                  {{ isUploadingDataset ? '上传中...' : '上传数据集' }}
                </button>
                <span :class="trainingDatasetUploaded ? 'dataset-status-success' : 'dataset-status-pending'">
                  {{ trainingDatasetDisplayName }}
                </span>
              </div>
            </div>

            <div class="form-group">
              <label class="label-primary" style="visibility: hidden">训练参数</label>
              <button class="btn info" @click="trainingParametersDialogVisible = true">打开训练参数</button>
            </div>

            <div class="form-group">
              <label class="label-primary" style="visibility: hidden">开始训练</label>
              <button class="btn success" :disabled="isStartingTraining" @click="startTrainingTask">
                {{ isStartingTraining ? '提交中...' : '开始训练' }}
              </button>
            </div>
          </div>
        </div>

        <div v-show="shouldShowTrainingDashboard" class="training-dashboard">
          <h3>训练实时看板</h3>
          <div class="training-status">
            <span id="trainStatusLabel">
              状态：
              {{
                trainingProgressState.status === 'training'
                  ? '训练中'
                  : trainingProgressState.status === 'success'
                    ? '训练完成'
                    : trainingProgressState.status === 'error'
                      ? '训练失败'
                      : '等待中'
              }}
            </span>
            <span id="trainEtaLabel">预计剩余时间：{{ trainingProgressState.eta || '--' }}</span>
          </div>

          <div class="progress-bar training-progress">
            <div id="trainProgressFill" :style="{ width: `${trainingProgressPercent}%` }"></div>
            <span id="trainEpochLabel">
              {{ trainingProgressState.progress }} / {{ trainingProgressState.total }} Epochs ({{
                trainingProgressPercent.toFixed(1)
              }}%)
            </span>
          </div>

          <div v-if="trainingMetricEntries.length > 0" class="metrics-grid">
            <div v-for="[metricName, metricValue] in trainingMetricEntries" :key="metricName" class="metric-card">
              <div class="metric-name">{{ metricName }}</div>
              <div class="metric-value">{{ metricValue }}</div>
              <div class="metric-description">{{ METRIC_DESCRIPTION_MAP[metricName] ?? '暂无说明' }}</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <div v-show="activePage === 'details'" class="app-container" :class="{ 'page-active': activePage === 'details' }">
    <aside class="sidebar" :class="{ collapsed: isSidebarCollapsed }">
      <div class="sidebar-header">
        <button class="sidebar-close-btn" title="收起侧边栏" @click="toggleSidebarCollapse(true)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
      </div>

      <div class="model-section">
        <h3>训练模型列表</h3>
        <div class="model-list">
          <div
            v-for="modelName in modelCollections.trained"
            :key="`details-trained-${modelName}`"
            class="model-item"
            :class="{ active: modelName === detailsModelName }"
            @click="handleDetailsModelSwitch(modelName)"
          >
            <span class="model-name">{{ modelName }}</span>
            <div class="menu-trigger" @click.stop="toggleModelMenu(buildModelMenuKey('details', 'trained', modelName))">
              ⋮
            </div>
            <div
              class="context-menu"
              :class="{ show: currentContextMenuKey === buildModelMenuKey('details', 'trained', modelName) }"
              @click.stop
            >
              <div class="context-menu-item" @click="openRenameDialog(modelName, 'trained')">重命名</div>
              <div class="context-menu-item" @click="openDescriptionDialog(modelName)">编辑描述</div>
              <div class="context-menu-item danger" @click="confirmDeleteModel(modelName, 'trained')">删除模型</div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <header class="top-bar">
        <button class="open-sidebar-btn" :class="{ visible: isSidebarCollapsed }" title="展开侧边栏" @click="toggleSidebarCollapse(false)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
        <h1>{{ currentPageTitle }}</h1>
      </header>

      <div id="details-workspace" class="workspace">
        <div v-if="!detailsModelName" id="detailsPlaceholder">
          <div class="placeholder-icon">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="#94a3b8">
              <path
                d="M19 3H5c-1.1 0-2 .9-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7v-5zm4-4h2v9h-2V8zm4 2h2v7h-2v-7z"
              />
            </svg>
          </div>
          <h2>请选择一个训练模型查看详情</h2>
        </div>

        <div v-else-if="isModelDetailsLoading" id="detailsPlaceholder">
          <div class="placeholder-icon loading-spinner"></div>
          <h2>正在加载模型详情...</h2>
        </div>

        <div v-else-if="!modelDetails" id="detailsPlaceholder">
          <h2>未找到该模型的训练记录</h2>
        </div>

        <div v-else id="detailsContent" class="show">
          <div class="model-info-card">
            <div class="model-info-header">
              <div class="model-name-section">
                <h2>{{ modelDetails.model_name }}</h2>
                <div class="model-dataset">数据集：{{ modelDetails.dataset || '--' }}</div>
              </div>

              <div class="model-desc-section">
                {{
                  modelDetails.description && modelDetails.description.trim()
                    ? `模型描述：${modelDetails.description}`
                    : '暂无模型描述'
                }}
              </div>

              <div class="model-meta-section">
                <div class="base-model">
                  基础模型：
                  <a href="#" @click.prevent="openBaseModelReference">{{ modelDetails.base_model || '--' }}</a>
                </div>
                <div class="training-time">训练时间：<span>{{ modelDetails.time || '--' }}</span></div>
                <div class="details-action-anchor">
                  <button class="btn-action btn-purple" @click.stop="toggleDetailsActionMenu">模型操作</button>
                  <div class="context-menu details-action-menu" :class="{ show: detailsActionMenuVisible }" @click.stop>
                    <div class="context-menu-item" @click="openRenameDialog(detailsModelName, 'trained')">重命名</div>
                    <div class="context-menu-item" @click="openDescriptionDialog(detailsModelName)">编辑描述</div>
                    <div class="context-menu-item danger" @click="confirmDeleteModel(detailsModelName, 'trained')">删除模型</div>
                  </div>
                </div>
              </div>
            </div>

            <h3>训练参数</h3>
            <div class="params-table-container">
              <table class="params-table">
                <thead>
                  <tr>
                    <th>参数名</th>
                    <th>参数值</th>
                    <th>参数说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="parameterItem in detailParameterEntries" :key="parameterItem.key">
                    <td>{{ parameterItem.key }}</td>
                    <td>{{ parameterItem.value }}</td>
                    <td>{{ parameterItem.description }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="detailFinalMetricEntries.length > 0" class="final-metrics-section">
            <h3>训练最终指标</h3>
            <div class="metrics-grid">
              <div v-for="metricItem in detailFinalMetricEntries" :key="metricItem.key" class="metric-card">
                <div class="metric-name">{{ metricItem.key }}</div>
                <div class="metric-value">{{ metricItem.value }}</div>
                <div class="metric-description">{{ metricItem.description }}</div>
              </div>
            </div>
          </div>

          <div class="charts-section">
            <h3>训练图表分析</h3>
            <div class="charts-grid">
              <div
                v-for="chartFileName in TRAINING_CHART_FILES"
                v-show="chartVisibleMap[chartFileName]"
                :key="chartFileName"
                class="chart-card"
              >
                <div class="chart-title">{{ chartFileName.replace(/\.(png|jpg)$/i, '').replace(/_/g, ' ') }}</div>
                <div class="chart-desc">{{ CHART_DESCRIPTION_MAP[chartFileName] }}</div>
                <img
                  class="chart-image"
                  :src="getChartImageUrl(chartFileName)"
                  :alt="chartFileName"
                  @error="handleChartLoadError(chartFileName)"
                  style="display: block;"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <el-dialog
    v-model="uploadModelDialogVisible"
    title="导入模型"
    width="460px"
    @closed="resetUploadModelDialog"
  >
    <div class="dialog-form-row">
      <label>模型文件（.pt）</label>
      <input type="file" accept=".pt" @change="handleUploadModelFileChange" />
    </div>
    <div class="dialog-form-row">
      <label>模型名称</label>
      <input v-model.trim="uploadModelCustomName" type="text" placeholder="例如：steel_v1" />
    </div>
    <template #footer>
      <el-button @click="uploadModelDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="isUploadingModel" @click="submitUploadModel">上传</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="renameDialogVisible" title="重命名模型" width="460px">
    <div class="dialog-form-row">
      <label>原名称</label>
      <input :value="renameForm.oldName" type="text" readonly />
    </div>
    <div class="dialog-form-row">
      <label>新名称</label>
      <input v-model.trim="renameForm.newName" type="text" placeholder="请输入新模型名称" />
    </div>
    <template #footer>
      <el-button @click="renameDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="isRenamingModel" @click="submitRenameModel">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="descriptionDialogVisible" title="编辑模型描述" width="560px">
    <div class="dialog-form-row">
      <label>模型名称</label>
      <input :value="descriptionForm.modelName" type="text" readonly />
    </div>
    <div class="dialog-form-row">
      <label>描述内容</label>
      <textarea v-model="descriptionForm.content" rows="4" placeholder="请输入模型用途、版本信息等"></textarea>
    </div>
    <template #footer>
      <el-button @click="descriptionDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="isSavingDescription" @click="submitDescriptionUpdate">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="trainingParametersDialogVisible"
    title="训练参数设置"
    width="900px"
    align-center
    class="training-params-dialog"
    :close-on-click-modal="false"
  >
    <div class="params-container">
      <fieldset class="param-fieldset">
        <legend>基础参数 (Base)</legend>
        <div class="param-grid">
          <div class="param-item">
            <label>Epochs <span class="help-text">训练的轮数</span></label>
            <input v-model.number="trainingParameters.epochs" type="number" min="1" class="form-input" />
          </div>
          <div class="param-item">
            <label>Patience <span class="help-text">早停轮数(防过拟合)</span></label>
            <input v-model.number="trainingParameters.patience" type="number" min="0" class="form-input" />
          </div>
          <div class="param-item">
            <label>Batch Size <span class="help-text">批大小</span></label>
            <input v-model.number="trainingParameters.batch" type="number" min="1" class="form-input" />
          </div>
          <div class="param-item">
            <label>Image Size <span class="help-text">图片输入尺寸</span></label>
            <input v-model.number="trainingParameters.imgsz" type="number" min="32" step="32" class="form-input" />
          </div>
        </div>
      </fieldset>

      <fieldset class="param-fieldset">
        <legend>优化策略 (Optimizer & LR)</legend>
        <div class="param-grid">
          <div class="param-item">
            <label>Optimizer <span class="help-text">优化器类型</span></label>
            <select v-model="trainingParameters.optimizer" class="form-select">
              <option value="auto">auto</option>
              <option value="SGD">SGD</option>
              <option value="Adam">Adam</option>
              <option value="AdamW">AdamW</option>
            </select>
          </div>
          <div class="param-item">
            <label>lr0 <span class="help-text">初始学习率</span></label>
            <input v-model.number="trainingParameters.lr0" type="number" step="0.001" class="form-input" />
          </div>
          <div class="param-item">
            <label>lrf <span class="help-text">最终学习率倍数</span></label>
            <input v-model.number="trainingParameters.lrf" type="number" step="0.001" class="form-input" />
          </div>
          <div class="param-item">
            <label>Momentum <span class="help-text">动量</span></label>
            <input v-model.number="trainingParameters.momentum" type="number" step="0.001" class="form-input" />
          </div>
          <div class="param-item">
            <label>Weight Decay <span class="help-text">权重衰减正则化</span></label>
            <input v-model.number="trainingParameters.weight_decay" type="number" step="0.0001" class="form-input" />
          </div>
          <div class="param-item">
            <label>Warmup Epochs <span class="help-text">预热轮数</span></label>
            <input v-model.number="trainingParameters.warmup_epochs" type="number" step="0.1" class="form-input" />
          </div>
          <div class="param-item">
            <label>Warmup Momentum <span class="help-text">预热动量</span></label>
            <input v-model.number="trainingParameters.warmup_momentum" type="number" step="0.01" class="form-input" />
          </div>
          <div class="param-item checkbox-item">
            <input id="param_cos_lr" v-model="trainingParameters.cos_lr" type="checkbox" />
            <label for="param_cos_lr">Cosine LR <span class="help-text">余弦退火学习率</span></label>
          </div>
        </div>
      </fieldset>

      <fieldset class="param-fieldset">
        <legend>数据增强 (Augmentation)</legend>
        <div class="param-grid">
          <div class="param-item"><label>hsv_h <span class="help-text">色调</span></label><input v-model.number="trainingParameters.hsv_h" type="number" step="0.001" class="form-input" /></div>
          <div class="param-item"><label>hsv_s <span class="help-text">饱和度</span></label><input v-model.number="trainingParameters.hsv_s" type="number" step="0.1" class="form-input" /></div>
          <div class="param-item"><label>hsv_v <span class="help-text">明度</span></label><input v-model.number="trainingParameters.hsv_v" type="number" step="0.1" class="form-input" /></div>
          <div class="param-item"><label>degrees <span class="help-text">旋转角度</span></label><input v-model.number="trainingParameters.degrees" type="number" step="1" class="form-input" /></div>
          <div class="param-item"><label>translate <span class="help-text">平移</span></label><input v-model.number="trainingParameters.translate" type="number" step="0.1" class="form-input" /></div>
          <div class="param-item"><label>scale <span class="help-text">缩放</span></label><input v-model.number="trainingParameters.scale" type="number" step="0.1" class="form-input" /></div>
          <div class="param-item"><label>shear <span class="help-text">剪切</span></label><input v-model.number="trainingParameters.shear" type="number" step="1" class="form-input" /></div>
          <div class="param-item"><label>perspective <span class="help-text">透视</span></label><input v-model.number="trainingParameters.perspective" type="number" step="0.001" class="form-input" /></div>
          <div class="param-item"><label>flipud <span class="help-text">上下翻转概率</span></label><input v-model.number="trainingParameters.flipud" type="number" step="0.1" class="form-input" /></div>
          <div class="param-item"><label>fliplr <span class="help-text">左右翻转概率</span></label><input v-model.number="trainingParameters.fliplr" type="number" step="0.1" class="form-input" /></div>
          <div class="param-item"><label>mosaic <span class="help-text">马赛克概率</span></label><input v-model.number="trainingParameters.mosaic" type="number" step="0.1" class="form-input" /></div>
          <div class="param-item"><label>mixup <span class="help-text">Mixup概率</span></label><input v-model.number="trainingParameters.mixup" type="number" step="0.1" class="form-input" /></div>
          <div class="param-item"><label>copy_paste <span class="help-text">Copy-Paste概率</span></label><input v-model.number="trainingParameters.copy_paste" type="number" step="0.1" class="form-input" /></div>
        </div>
      </fieldset>

      <fieldset class="param-fieldset">
        <legend>系统参数 (System)</legend>
        <div class="param-grid">
          <div class="param-item">
            <label>Seed <span class="help-text">随机种子</span></label>
            <input v-model.number="trainingParameters.seed" type="number" class="form-input" />
          </div>
          <div class="param-item">
            <label>Workers <span class="help-text">数据加载线程数</span></label>
            <input v-model.number="trainingParameters.workers" type="number" min="0" class="form-input" />
          </div>
          <div class="param-item">
            <label>Device <span class="help-text">显卡编号 (0, cpu 等)</span></label>
            <input v-model="trainingParameters.device" type="text" class="form-input" placeholder="例如：0 / cpu" />
          </div>
          <div class="param-item checkbox-item">
            <input id="param_amp" v-model="trainingParameters.amp" type="checkbox" />
            <label for="param_amp">AMP <span class="help-text">自动混合精度训练</span></label>
          </div>
        </div>
      </fieldset>
    </div>

    <template #footer>
      <el-button @click="trainingParametersDialogVisible = false">关闭</el-button>
      <el-button type="primary" @click="trainingParametersDialogVisible = false">保存参数</el-button>
    </template>
  </el-dialog>
</template>

<style>
#app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.context-menu {
  position: absolute;
  right: 10px;
  top: 35px;
  background: white;
  color: var(--text-dark);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  z-index: 100;
  display: none;
  flex-direction: column;
  width: 120px;
  overflow: hidden;
}

.context-menu.show {
  display: flex;
  animation: fadeIn 0.2s;
}

.context-menu-item {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background-color var(--transition-fast);
}

.context-menu-item:hover {
  background-color: #f1f5f9;
}

.context-menu-item.danger {
  color: var(--danger-color);
}

.context-menu-item.danger:hover {
  background-color: #fee2e2;
}

.dataset-status-success {
  color: #4ade80;
  font-size: 13px;
}

.dataset-status-pending {
  color: #cbd5e1;
  font-size: 13px;
}

.metric-card {
  background: #0f172a;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid #334155;
  text-align: center;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
}

.metric-name {
  color: #cbd5e1;
  font-size: 13px;
  margin-bottom: 5px;
}

.metric-value {
  color: #38bdf8;
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 6px;
}

.metric-description {
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
}

.details-action-anchor {
  position: relative;
}

.details-action-menu {
  top: 38px;
  right: 0;
}

.chart-card {
  background: #0f172a;
  border-radius: 8px;
  padding: 15px;
  border: 1px solid #334155;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.chart-title {
  color: #38bdf8;
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
}

.chart-desc {
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
  line-height: 1.5;
}

.chart-image {
  width: 100%;
  height: auto;
  border-radius: 6px;
  display: block;
  object-fit: contain;
  min-height: 180px;
}

.dialog-form-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.dialog-form-row label {
  font-size: 13px;
  color: #334155;
  font-weight: 600;
}

.dialog-form-row input,
.dialog-form-row textarea {
  width: 100%;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  font-size: 14px;
  box-sizing: border-box;
}

.dialog-form-row input:focus,
.dialog-form-row textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgb(59 130 246 / 0.2);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #64748b;
  border-top-color: #38bdf8;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@media (max-width: 1200px) {
  .display-area {
    flex-direction: column;
    min-height: auto;
  }
}
</style>
