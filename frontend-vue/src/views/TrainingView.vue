<script setup lang="ts">
// 训练页面 — 单任务/多任务队列、数据集上传、参数调节、训练启停与进度监控
import { ref, computed } from 'vue'
import ModelSidebar from '@/components/sidebar/ModelSidebar.vue'
import { useModelStore } from '@/stores/models'
import { useTrainingStore, defaultTrainParams } from '@/stores/training'
import { useAppStore } from '@/stores/app'
import * as trainingApi from '@/api/training'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MAX_TRAINING_TASKS, QUEUE_POLL_INTERVAL } from '@/config'

const modelStore = useModelStore()
const trainingStore = useTrainingStore()
const appStore = useAppStore()

// 单任务本地状态
const newModelName = ref('')
const modelDesc = ref('')
const datasetPath = ref('')
const datasetName = ref('未选择')
const datasetInput = ref<HTMLInputElement>()

// UI状态
const showParamsDialog = ref(false)
const editingTaskIndex = ref(-1) // -1: single task mode
const paramsDialogTitle = computed(() => editingTaskIndex.value >= 0 ? `任务${editingTaskIndex.value + 1} 训练参数` : '训练参数调节')

// 本地参数副本
const localParams = ref({ ...defaultTrainParams })

// 训练进度指标说明
const metricDescriptions: Record<string, string> = {
  'mAP50': '平均精度(IoU=0.50)：衡量模型在 50% 重叠阈值下的整体检测准确度，越接近 1 越好',
  'mAP50-95': '平均精度(IoU=0.50:0.95)：在多个 IoU 阈值下的综合评估，是最严格的检测性能指标',
  'Precision': '精确率：预测为正样本中实际为正样本的比例，越高说明误报越少',
  'Recall': '召回率：实际正样本中被正确检测到的比例，越高说明漏检越少',
  'Box Loss': '边界框回归损失：衡量预测框与真实框的位置偏差，训练中应持续降低',
  'Cls Loss': '分类损失：衡量目标类别预测的准确性，训练中应持续降低',
  'Dfl Loss': '分布焦点损失：YOLO11 特有的边界框精细化损失，辅助提升定位精度'
}

// 训练参数说明
const paramDesc: Record<string, string> = {
  Epochs: '完整遍历数据集的次数，值越大训练越充分，但耗时越长',
  Patience: '早停耐心值，连续 N 轮无提升则提前终止训练，0 表示不早停',
  'Batch Size': '每次迭代加载的图片数量，受显存限制，越大训练越稳定',
  'Image Size': '输入图片缩放到的尺寸（像素），通常设为 640',
  Optimizer: '优化算法：auto 自动选择，SGD 经典，Adam/AdamW 自适应',
  lr0: '初始学习率，控制参数更新步长，过大不收敛过小收敛慢',
  lrf: '最终学习率因子，lr0 × lrf = 最终学习率',
  Momentum: '动量因子，SGD 优化器的加速参数，帮助跳出局部最优',
  'Weight Decay': '权重衰减系数（L2 正则化），防止过拟合',
  'Warmup Epochs': '学习率预热轮数，从 0 逐步升至 lr0，防止初期震荡',
  'Warmup Momentum': '预热阶段的初始动量值，逐步升至设定动量',
  'Cos LR': '余弦学习率调度，学习率按余弦曲线下降，训练更平滑',
  hsv_h: '色相（Hue）随机扰动范围，增强颜色不变性',
  hsv_s: '饱和度（Saturation）随机扰动范围',
  hsv_v: '明度（Value）随机扰动范围，模拟不同光照条件',
  degrees: '随机旋转角度范围（度），0 表示不旋转',
  translate: '随机平移比例（相对图片尺寸）',
  scale: '随机缩放比例范围，值越大缩放变化越剧烈',
  shear: '随机剪切角度范围（度）',
  perspective: '随机透视变换强度',
  flipud: '上下翻转概率，0 表示从不翻转',
  fliplr: '左右翻转概率，0.5 表示一半概率翻转',
  mosaic: '马赛克增强概率，将 4 张图拼为 1 张，丰富背景多样性',
  mixup: 'Mixup 增强概率，混合两张图及其标签',
  'copy_paste': '实例复制粘贴增强概率，增加小目标样本',
  Seed: '随机种子，固定后可复现训练结果',
  Workers: '数据加载的 CPU 线程数，设为 CPU 核心数以内',
  Device: '训练设备，留空自动检测，指定如 0 表示第 1 块 GPU',
  AMP: '自动混合精度训练，节省显存并加速，推荐开启'
}

// 模型对话框
const showUploadDialog = ref(false)
const uploadFile = ref<File | null>(null)
const uploadModelName = ref('')
const showRenameDialog = ref(false)
const renameOldName = ref('')
const renameCategory = ref('')
const renameNewName = ref('')
const showDeleteDialog = ref(false)
const deleteModelName = ref('')
const deleteCategory = ref('')
const showEditDescDialog = ref(false)
const editDescModelName = ref('')
const editDescText = ref('')

// 数据集重复检测 — 三选对话框状态
const dupState = ref<{
  visible: boolean
  datasetName: string
  existingPath: string
  mode: 'single' | 'multi'
  taskIndex: number
  file: File | null
  inputEl: HTMLInputElement | null
}>({ visible: false, datasetName: '', existingPath: '', mode: 'single', taskIndex: -1, file: null, inputEl: null })

// 数据集上传 — 单任务
async function handleDatasetUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const datasetsRes = await trainingApi.getDatasets()
    const datasets = datasetsRes.data.datasets || []
    const dn = file.name.replace(/\.zip$/i, '')
    const existing = datasets.find((d: any) => d.name === dn)

    if (existing) {
      dupState.value = { visible: true, datasetName: dn, existingPath: existing.path, mode: 'single', taskIndex: -1, file, inputEl: input }
      return
    }
    await doSingleUpload(file, input)
  } catch (e: any) {
    ElMessage.error('上传失败: ' + (e.response?.data?.detail || e.message))
    datasetName.value = '未选择'
    input.value = ''
  }
}

async function doSingleUpload(file: File, input: HTMLInputElement) {
  datasetName.value = '上传并解压中...'
  try {
    const res = await trainingApi.uploadDataset(file)
    setDatasetResult(res.data)
  } catch (e: any) {
    ElMessage.error('上传失败: ' + (e.response?.data?.detail || e.message))
    datasetName.value = '未选择'
  }
  input.value = ''
}

// 多任务文件输入映射
const multiTaskInputs = ref<Record<number, HTMLInputElement>>({})

function triggerMultiUpload(idx: number) {
  multiTaskInputs.value[idx]?.click()
}
async function handleMultiTaskDatasetUpload(e: Event, taskIndex: number) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const datasetsRes = await trainingApi.getDatasets()
    const datasets = datasetsRes.data.datasets || []
    const dn = file.name.replace(/\.zip$/i, '')
    const existing = datasets.find((d: any) => d.name === dn)

    if (existing) {
      dupState.value = { visible: true, datasetName: dn, existingPath: existing.path, mode: 'multi', taskIndex, file, inputEl: input }
      return
    }
    await doMultiUpload(file, taskIndex, input)
  } catch (e: any) {
    ElMessage.error('上传失败: ' + (e.response?.data?.detail || e.message))
    trainingStore.updateTask(taskIndex, { datasetName: '未选择' })
    input.value = ''
  }
}

async function doMultiUpload(file: File, taskIndex: number, input: HTMLInputElement) {
  trainingStore.updateTask(taskIndex, { datasetName: '上传并解压中...' })
  try {
    const res = await trainingApi.uploadDataset(file)
    trainingStore.updateTask(taskIndex, {
      datasetPath: res.data.dataset_path,
      datasetName: `[就绪] ${file.name}`
    })
  } catch (e: any) {
    ElMessage.error('上传失败: ' + (e.response?.data?.detail || e.message))
    trainingStore.updateTask(taskIndex, { datasetName: '未选择' })
  }
  input.value = ''
}

// 三选回调
function onDupOverwrite() {
  const s = dupState.value
  dupState.value = { visible: false, datasetName: '', existingPath: '', mode: 'single', taskIndex: -1, file: null, inputEl: null }
  if (s.mode === 'single') {
    doSingleUpload(s.file!, s.inputEl!)
  } else {
    doMultiUpload(s.file!, s.taskIndex, s.inputEl!)
  }
}

function onDupReuse() {
  const s = dupState.value
  dupState.value = { visible: false, datasetName: '', existingPath: '', mode: 'single', taskIndex: -1, file: null, inputEl: null }
  if (s.mode === 'single') {
    datasetPath.value = s.existingPath
    datasetName.value = s.datasetName
    trainingStore.setDatasetPath(s.existingPath, s.datasetName)
  } else {
    trainingStore.updateTask(s.taskIndex, {
      datasetPath: s.existingPath,
      datasetName: `[就绪] ${s.datasetName} (使用已有)`
    })
  }
  ElMessage.success(`已复用已有数据集 "${s.datasetName}"`)
  if (s.inputEl) s.inputEl.value = ''
}

function onDupCancel() {
  const s = dupState.value
  dupState.value = { visible: false, datasetName: '', existingPath: '', mode: 'single', taskIndex: -1, file: null, inputEl: null }
  if (s.mode === 'single') datasetName.value = '未选择'
  else trainingStore.updateTask(s.taskIndex, { datasetName: '未选择' })
  if (s.inputEl) s.inputEl.value = ''
}

function setDatasetResult(data: any) {
  datasetPath.value = data.dataset_path
  datasetName.value = data.dataset_path.split('/').pop() || '已就绪'
  trainingStore.setDatasetPath(data.dataset_path, datasetName.value)
}

// 单任务开始训练
async function startSingleTraining() {
  if (!newModelName.value.trim()) {
    ElMessage.warning('请输入新模型名称')
    return
  }
  if (!datasetPath.value) {
    ElMessage.warning('请上传数据集')
    return
  }
  const baseModel = modelStore.allModels.find(m => m === modelStore.currentModelName) || modelStore.allModels[0]
  if (!baseModel) {
    ElMessage.warning('请选择基础模型')
    return
  }

  try {
    ElMessage.info('训练任务已启动！请查看进度面板。')
    await trainingApi.startTraining(
      newModelName.value.trim(), baseModel, datasetPath.value,
      trainingStore.trainParams, modelDesc.value
    )
    trainingStore.trainingState.status = 'training'
  } catch (e: any) {
    ElMessage.error('启动训练失败: ' + (e.response?.data?.detail || e.message))
  }
}

async function stopCurrentTraining() {
  try {
    await ElMessageBox.confirm('确定要停止当前训练吗？', '确认停止', {
      confirmButtonText: '确定停止',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await trainingApi.stopTraining()
    ElMessage.info('已发送停止信号')
  } catch { /* cancelled */ }
}

// 多任务操作
function addNewTask() {
  if (trainingStore.tasks.length >= MAX_TRAINING_TASKS) {
    ElMessage.warning(`最多支持${MAX_TRAINING_TASKS}个任务`)
    return
  }
  trainingStore.addTask()
}

function deleteTaskByIndex(index: number) {
  trainingStore.deleteTask(index)
}

// 队列训练
async function startQueue() {
  // 验证所有任务
  for (let i = 0; i < trainingStore.tasks.length; i++) {
    const task = trainingStore.tasks[i]
    if (!task?.newModelName?.trim()) { ElMessage.warning(`任务${i+1}的新模型名称不能为空`); return }
    if (!task?.datasetPath) { ElMessage.warning(`任务${i+1}的数据集未上传`); return }
    if (task?.modelSource === 'existing' && !task?.baseModel) { ElMessage.warning(`任务${i+1}的基础模型未选择`); return }
  }

  trainingStore.isQueueRunning = true
  trainingStore.queueStatus = 'running'
  trainingStore.currentTaskIndex = 0
  trainingStore.saveToStorage()

  // 执行第一个任务
  await executeCurrentTask()
}

async function executeCurrentTask() {
  const task = trainingStore.currentTask
  if (!task) {
    finishQueue()
    return
  }

  trainingStore.updateTask(trainingStore.currentTaskIndex, { status: 'running' })
  let baseModel = task.baseModel
  if (task.modelSource === 'previous') {
    const prevTask = trainingStore.tasks[trainingStore.currentTaskIndex - 1]
    if (!prevTask) throw new Error('找不到上一个任务的模型')
    baseModel = prevTask.newModelName + '.pt'
  }

  try {
    await trainingApi.startTraining(
      task.newModelName, baseModel,
      task.datasetPath, task.parameters, task.description
    )
    // 等待任务完成
    await waitForTaskCompletion()
  } catch (e: any) {
    trainingStore.updateTask(trainingStore.currentTaskIndex, {
      status: 'failed',
      errorMessage: e.response?.data?.detail || e.message
    })
    trainingStore.isQueueRunning = false
    trainingStore.queueStatus = 'error'
    trainingStore.saveToStorage()
    ElMessage.error('队列训练出错，已停止')
    return
  }
}

function waitForTaskCompletion(): Promise<void> {
  return new Promise((resolve) => {
    const check = setInterval(async () => {
      try {
        const res = await trainingApi.getTrainingProgress()
        const data = res.data
        trainingStore.trainingState = data

        if (data.status !== 'training') {
          clearInterval(check)
          if (data.status === 'success' || data.status === 'early_stopped') {
            trainingStore.updateTask(trainingStore.currentTaskIndex, { status: 'completed' })
            trainingStore.moveToNextTask()
            trainingStore.saveToStorage()
            if (trainingStore.isQueueRunning && trainingStore.currentTask) {
              await executeCurrentTask()
            } else {
              finishQueue()
            }
          } else if (data.status === 'stopped' || data.status === 'error') {
            trainingStore.updateTask(trainingStore.currentTaskIndex, { status: 'failed' })
            trainingStore.isQueueRunning = false
            trainingStore.queueStatus = 'stopped'
            trainingStore.saveToStorage()
          }
          resolve()
        }
      } catch {
        // ignore polling errors
      }
    }, QUEUE_POLL_INTERVAL)
  })
}

function finishQueue() {
  trainingStore.isQueueRunning = false
  trainingStore.queueStatus = 'completed'
  trainingStore.currentTaskIndex = -1
  trainingStore.saveToStorage()
  ElMessage.success('所有训练任务已完成！')
  setTimeout(() => window.location.reload(), 2000)
}

async function stopQueue() {
  try {
    await ElMessageBox.confirm('确定要停止队列训练吗？', '确认停止队列', {
      confirmButtonText: '确定停止',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await trainingApi.stopTraining()
    trainingStore.isQueueRunning = false
    trainingStore.queueStatus = 'stopped'
    trainingStore.tasks.forEach((t, i) => {
      if (t.status === 'running' || t.status === 'pending') {
        trainingStore.updateTask(i, { status: 'pending' })
      }
    })
    trainingStore.saveToStorage()
    ElMessage.info('队列已停止')
  } catch { /* cancelled */ }
}

// 参数对话框
function openParamsDialog(taskIndex: number = -1) {
  editingTaskIndex.value = taskIndex
  if (taskIndex >= 0) {
    const task = trainingStore.tasks[taskIndex]
    if (task) localParams.value = { ...task.parameters }
  } else {
    localParams.value = { ...trainingStore.trainParams }
  }
  showParamsDialog.value = true
}

function saveParams() {
  if (editingTaskIndex.value >= 0) {
    trainingStore.updateTask(editingTaskIndex.value, { parameters: { ...localParams.value } })
  } else {
    trainingStore.updateTrainParams({ ...localParams.value })
  }
  showParamsDialog.value = false
  ElMessage.success('参数已保存')
}

// 模式切换
function switchMode(mode: 'single' | 'multi') {
  if (trainingStore.isTraining && mode !== trainingStore.trainingMode) {
    ElMessage.warning('训练进行中，无法切换模式')
    return
  }
  trainingStore.setTrainingMode(mode)
}

// 模型对话框（复用）
function openUploadDialog() {
  uploadFile.value = null
  uploadModelName.value = ''
  showUploadDialog.value = true
}
async function confirmUpload() {
  if (!uploadFile.value || !uploadModelName.value.trim()) return
  try {
    await modelStore.uploadModel(uploadFile.value, uploadModelName.value.trim())
    showUploadDialog.value = false
    ElMessage.success('模型上传成功！')
  } catch (e: any) {
    ElMessage.error('上传失败')
  }
}
function openRenameDialog(name: string, category: string) {
  renameOldName.value = name
  renameCategory.value = category
  renameNewName.value = name.replace('.pt', '')
  showRenameDialog.value = true
}
async function confirmRename() {
  if (!renameNewName.value.trim()) return
  try {
    await modelStore.renameModel(renameOldName.value, renameNewName.value.trim(), renameCategory.value)
    showRenameDialog.value = false
    ElMessage.success('重命名成功！')
  } catch (e: any) { ElMessage.error('重命名失败') }
}
function openDeleteDialog(name: string, category: string) {
  deleteModelName.value = name
  deleteCategory.value = category
  showDeleteDialog.value = true
}
async function confirmDelete() {
  try {
    await modelStore.deleteModel(deleteModelName.value, deleteCategory.value)
    showDeleteDialog.value = false
    ElMessage.success('删除成功！')
  } catch (e: any) { ElMessage.error('删除失败') }
}
function openEditDescDialog(name: string, _category: string) {
  editDescModelName.value = name
  editDescText.value = ''
  showEditDescDialog.value = true
}
async function confirmEditDesc() {
  try {
    await modelStore.updateDescription(editDescModelName.value, editDescText.value)
    showEditDescDialog.value = false
    ElMessage.success('描述修改成功！')
  } catch (e: any) { ElMessage.error('修改失败') }
}

// 训练状态辅助
const trainProgressWidth = computed(() => {
  const s = trainingStore.trainingState
  if (!s.total) return '0%'
  return Math.min(100, (s.progress / s.total) * 100).toFixed(1) + '%'
})

const statusLabel = computed(() => {
  const s = trainingStore.trainingState.status
  const map: Record<string, string> = { training: '训练中...', success: '已完成', error: '出错', stopped: '已停止', idle: '准备中...', early_stopped: '早停完成' }
  return map[s] || s
})

const hasDashboard = computed(() => trainingStore.trainingState.status !== 'idle')
</script>

<template>
  <div class="app-container">
    <ModelSidebar
      mode="training"
      :show-guide="true"
      @upload-model="openUploadDialog"
      @rename-model="openRenameDialog"
      @edit-desc="openEditDescDialog"
      @delete-model="openDeleteDialog"
    />

    <main class="main-content">
      <div class="top-bar">
        <button :class="['sidebar-trigger', { visible: appStore.sidebarCollapsed }]" @click="appStore.toggleSidebar()" title="展开侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
        <h1>模型训练工作台</h1>
        <div class="mode-switcher">
          <button :class="['mode-btn', { active: trainingStore.trainingMode === 'single' }]" @click="switchMode('single')">单任务模式</button>
          <button :class="['mode-btn', { active: trainingStore.trainingMode === 'multi' }]" @click="switchMode('multi')">多任务模式</button>
        </div>
        <div class="spacer"></div>
        <template v-if="trainingStore.trainingMode === 'multi' && !trainingStore.isQueueRunning">
          <el-button @click="addNewTask">+ 增加训练任务</el-button>
          <el-button type="success" @click="startQueue">队列开始训练</el-button>
        </template>
        <template v-if="trainingStore.isQueueRunning">
          <el-button type="danger" @click="stopQueue">停止队列</el-button>
        </template>
      </div>

      <div class="workspace">
        <!-- 单任务模式 -->
        <div v-if="trainingStore.trainingMode === 'single'" class="config-card">
          <div class="card-title">
            <span class="card-icon">&#9881;</span>
            <h2>训练任务配置</h2>
          </div>

          <div class="config-row">
            <div class="form-group">
              <label>选取基础模型</label>
              <el-select v-model="modelStore.currentModelName" placeholder="选择模型" style="width: 100%;">
                <el-option v-for="m in modelStore.allModels" :key="m" :label="m" :value="m" />
              </el-select>
              <span class="form-hint">选择预训练的 YOLO 模型作为训练起点</span>
            </div>
            <div class="form-group">
              <label>新模型名称</label>
              <el-input v-model="newModelName" placeholder="例如: pcb_defect_v1" />
              <span class="form-hint">训练完成后保存的模型文件名</span>
            </div>
            <div class="form-group">
              <label>模型介绍（选填）</label>
              <el-input v-model="modelDesc" placeholder="例如：钢材表面缺陷检测模型" />
              <span class="form-hint">可在训练详情中查看此介绍</span>
            </div>
          </div>

          <div class="config-row">
            <div class="form-group">
              <label>上传数据集</label>
              <div class="dataset-row">
                <input ref="datasetInput" type="file" accept=".zip" hidden @change="handleDatasetUpload">
                <el-button @click="datasetInput?.click()">📦 上传数据集</el-button>
                <span class="dataset-name">{{ datasetName }}</span>
              </div>
            </div>
            <div class="form-group">
              <label style="visibility:hidden;">占位</label>
              <el-button @click="openParamsDialog(-1)">⚙️ 调整训练参数</el-button>
            </div>
            <div class="form-group">
              <label style="visibility:hidden;">占位</label>
              <template v-if="!trainingStore.isTraining">
                <el-button type="success" size="large" @click="startSingleTraining">🚀 开始训练</el-button>
              </template>
              <template v-else>
                <el-button type="danger" size="large" @click="stopCurrentTraining">⏹ 停止训练</el-button>
              </template>
            </div>
          </div>
        </div>

        <!-- 多任务模式 -->
        <div v-if="trainingStore.trainingMode === 'multi'" class="multi-task-section">
          <div class="multi-header">
            <h3>训练任务队列 ({{ trainingStore.tasks.length }}/{{ MAX_TRAINING_TASKS }})</h3>
          </div>
          <div class="task-cards">
            <div v-for="(task, idx) in trainingStore.tasks" :key="task.id" class="task-card" :class="{ running: task.status === 'running', completed: task.status === 'completed', failed: task.status === 'failed' }">
              <div class="task-header">
                <h4>{{ task.title }}</h4>
                <el-button v-if="!trainingStore.isQueueRunning" text size="small" type="danger" @click="deleteTaskByIndex(idx)">✕</el-button>
              </div>
              <div class="task-body">
                <div class="form-row">
                  <div class="fg">
                    <label>模型来源</label>
                    <el-select v-model="task.modelSource" style="width:100%;" :disabled="trainingStore.isQueueRunning">
                      <el-option label="使用现有模型" value="existing" />
                      <el-option label="承接上个任务的模型" value="previous" :disabled="idx === 0" />
                    </el-select>
                  </div>
                  <div class="fg" v-if="task.modelSource === 'existing'">
                    <label>选取基础模型</label>
                    <el-select v-model="task.baseModel" style="width:100%;" :disabled="trainingStore.isQueueRunning" placeholder="选择模型">
                      <el-option v-for="m in modelStore.allModels" :key="m" :label="m" :value="m" />
                    </el-select>
                  </div>
                  <div class="fg" v-else>
                    <label>承接模型</label>
                    <div class="prev-model-info">将承接上一个任务训练完成的模型</div>
                  </div>
                </div>
                <div class="form-row">
                  <div class="fg">
                    <label>新模型名称</label>
                    <el-input v-model="task.newModelName" placeholder="例如: pcb_defect_v1" :disabled="trainingStore.isQueueRunning" />
                  </div>
                  <div class="fg">
                    <label>模型介绍（选填）</label>
                    <el-input v-model="task.description" placeholder="例如：钢材表面缺陷检测模型" :disabled="trainingStore.isQueueRunning" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="fg">
                    <label>数据集</label>
                    <div class="dataset-row">
                      <input type="file" accept=".zip" hidden :ref="(el: any) => { if (el) { multiTaskInputs[idx] = el; el.onchange = (e: Event) => handleMultiTaskDatasetUpload(e, idx) } }">
                      <el-button @click="triggerMultiUpload(idx)" :disabled="trainingStore.isQueueRunning">📦 上传</el-button>
                      <span class="dataset-name">{{ task.datasetName }}</span>
                    </div>
                  </div>
                  <div class="fg">
                    <label>参数</label>
                    <el-button @click="openParamsDialog(idx)" :disabled="trainingStore.isQueueRunning">⚙️ 调整</el-button>
                  </div>
                </div>
                <div v-if="task.status !== 'pending'" class="task-status-indicator">
                  <span :class="['status-badge', task.status]">
                    {{ task.status === 'running' ? '执行中' : task.status === 'completed' ? '已完成' : '失败' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 训练进度仪表板 -->
        <div v-if="hasDashboard" class="dashboard-card">
          <h3>训练进度监控</h3>
          <div class="dashboard-status">
            <span>状态: {{ statusLabel }}</span>
            <span>预计剩余时间: {{ trainingStore.trainingState.eta || '--' }}</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-fill" :style="{ width: trainProgressWidth }"></div>
            <span class="progress-label">{{ trainingStore.trainingState.progress }} / {{ trainingStore.trainingState.total }} Epochs ({{ trainProgressWidth }})</span>
          </div>

          <div v-if="trainingStore.trainingState.metrics && Object.keys(trainingStore.trainingState.metrics).length" class="metrics-grid">
            <div v-for="(val, key) in trainingStore.trainingState.metrics" :key="key" class="metric-card">
              <div class="metric-key">{{ key }}</div>
              <div class="metric-val">{{ val }}</div>
              <div class="metric-desc">{{ metricDescriptions[key] || '' }}</div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 训练参数对话框 -->
    <el-dialog v-model="showParamsDialog" :title="paramsDialogTitle" width="760px" :close-on-click-modal="false" top="2vh">
      <!-- 基础参数 -->
      <fieldset class="param-fieldset">
        <legend>基础参数</legend>
        <div class="param-grid">
          <div class="param-item"><el-tooltip :content="paramDesc['Epochs']" placement="top"><label>Epochs</label></el-tooltip><el-input-number v-model="localParams.epochs" :min="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Patience']" placement="top"><label>Patience</label></el-tooltip><el-input-number v-model="localParams.patience" :min="0" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Batch Size']" placement="top"><label>Batch Size</label></el-tooltip><el-input-number v-model="localParams.batch" :min="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Image Size']" placement="top"><label>Image Size</label></el-tooltip><el-input-number v-model="localParams.imgsz" :min="32" :step="32" size="small" /></div>
        </div>
      </fieldset>

      <!-- 优化器 -->
      <fieldset class="param-fieldset">
        <legend>优化策略</legend>
        <div class="param-grid">
          <div class="param-item">
            <el-tooltip :content="paramDesc['Optimizer']" placement="top"><label>Optimizer</label></el-tooltip>
            <el-select v-model="localParams.optimizer" size="small">
              <el-option label="auto" value="auto" />
              <el-option label="SGD" value="SGD" />
              <el-option label="Adam" value="Adam" />
              <el-option label="AdamW" value="AdamW" />
            </el-select>
          </div>
          <div class="param-item"><el-tooltip :content="paramDesc['lr0']" placement="top"><label>lr0</label></el-tooltip><el-input-number v-model="localParams.lr0" :step="0.001" :precision="3" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['lrf']" placement="top"><label>lrf</label></el-tooltip><el-input-number v-model="localParams.lrf" :step="0.001" :precision="3" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Momentum']" placement="top"><label>Momentum</label></el-tooltip><el-input-number v-model="localParams.momentum" :step="0.001" :precision="3" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Weight Decay']" placement="top"><label>Weight Decay</label></el-tooltip><el-input-number v-model="localParams.weight_decay" :step="0.0001" :precision="4" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Warmup Epochs']" placement="top"><label>Warmup Epochs</label></el-tooltip><el-input-number v-model="localParams.warmup_epochs" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Warmup Momentum']" placement="top"><label>Warmup Momentum</label></el-tooltip><el-input-number v-model="localParams.warmup_momentum" :step="0.01" :precision="2" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Cos LR']" placement="top"><label>Cos LR</label></el-tooltip><el-switch v-model="localParams.cos_lr" size="small" /></div>
        </div>
      </fieldset>

      <!-- 数据增强 -->
      <fieldset class="param-fieldset">
        <legend>数据增强</legend>
        <div class="param-grid">
          <div class="param-item"><el-tooltip :content="paramDesc['hsv_h']" placement="top"><label>hsv_h</label></el-tooltip><el-input-number v-model="localParams.hsv_h" :step="0.001" :precision="3" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['hsv_s']" placement="top"><label>hsv_s</label></el-tooltip><el-input-number v-model="localParams.hsv_s" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['hsv_v']" placement="top"><label>hsv_v</label></el-tooltip><el-input-number v-model="localParams.hsv_v" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['degrees']" placement="top"><label>degrees</label></el-tooltip><el-input-number v-model="localParams.degrees" :step="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['translate']" placement="top"><label>translate</label></el-tooltip><el-input-number v-model="localParams.translate" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['scale']" placement="top"><label>scale</label></el-tooltip><el-input-number v-model="localParams.scale" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['shear']" placement="top"><label>shear</label></el-tooltip><el-input-number v-model="localParams.shear" :step="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['perspective']" placement="top"><label>perspective</label></el-tooltip><el-input-number v-model="localParams.perspective" :step="0.001" :precision="3" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['flipud']" placement="top"><label>flipud</label></el-tooltip><el-input-number v-model="localParams.flipud" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['fliplr']" placement="top"><label>fliplr</label></el-tooltip><el-input-number v-model="localParams.fliplr" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['mosaic']" placement="top"><label>mosaic</label></el-tooltip><el-input-number v-model="localParams.mosaic" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['mixup']" placement="top"><label>mixup</label></el-tooltip><el-input-number v-model="localParams.mixup" :step="0.1" :precision="1" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['copy_paste']" placement="top"><label>copy_paste</label></el-tooltip><el-input-number v-model="localParams.copy_paste" :step="0.1" :precision="1" size="small" /></div>
        </div>
      </fieldset>

      <!-- 系统设置 -->
      <fieldset class="param-fieldset">
        <legend>系统设置</legend>
        <div class="param-grid">
          <div class="param-item"><el-tooltip :content="paramDesc['Seed']" placement="top"><label>Seed</label></el-tooltip><el-input-number v-model="localParams.seed" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Workers']" placement="top"><label>Workers</label></el-tooltip><el-input-number v-model="localParams.workers" :min="0" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['Device']" placement="top"><label>Device</label></el-tooltip><el-input v-model="localParams.device" placeholder="如: 0" size="small" /></div>
          <div class="param-item"><el-tooltip :content="paramDesc['AMP']" placement="top"><label>AMP</label></el-tooltip><el-switch v-model="localParams.amp" size="small" /></div>
        </div>
      </fieldset>

      <template #footer>
        <el-button @click="showParamsDialog = false">取消</el-button>
        <el-button type="primary" @click="saveParams">确认保存参数</el-button>
      </template>
    </el-dialog>

    <!-- 模型管理对话框 -->
    <el-dialog v-model="showUploadDialog" title="导入模型" width="420px" :close-on-click-modal="false">
      <el-upload :auto-upload="false" :limit="1" accept=".pt" :on-change="(f: any) => uploadFile = f.raw">
        <el-button type="primary">选择 .pt 文件</el-button>
      </el-upload>
      <el-input v-model="uploadModelName" placeholder="模型名称（如 steel_v1）" style="margin-top: 16px;" />
      <template #footer>
        <el-button @click="showUploadDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmUpload">确定导入</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showRenameDialog" title="重命名模型" width="400px" :close-on-click-modal="false">
      <el-input v-model="renameNewName" placeholder="新名称" />
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmRename">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showDeleteDialog" title="确认删除模型" width="400px" :close-on-click-modal="false">
      <p>确定要删除模型 <b>{{ deleteModelName }}</b> 吗？</p>
      <template #footer>
        <el-button @click="showDeleteDialog = false">取消</el-button>
        <el-button type="danger" @click="confirmDelete">确定删除</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditDescDialog" title="修改模型介绍" width="450px" :close-on-click-modal="false">
      <el-input v-model="editDescText" type="textarea" :rows="4" placeholder="请输入模型介绍..." />
      <template #footer>
        <el-button @click="showEditDescDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmEditDesc">确定</el-button>
      </template>
    </el-dialog>

    <!-- 数据集重名三选对话框 -->
    <el-dialog v-model="dupState.visible" title="数据集重名" width="460px" :close-on-click-modal="false" :close-on-press-escape="false">
      <p style="color:#c0c0c8;font-size:14px;margin-bottom:8px;">数据集 <b style="color:#6db0fa;">{{ dupState.datasetName }}</b> 已存在，请选择处理方式：</p>
      <template #footer>
        <el-button @click="onDupCancel">取消</el-button>
        <el-button type="info" @click="onDupReuse">否，直接使用</el-button>
        <el-button type="primary" @click="onDupOverwrite">是，覆盖上传</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  height: 100%;
  width: 100%;
  position: relative;
}

.sidebar-trigger {
  background: transparent;
  border: none;
  color: #8a8a96;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s, background 0.15s, color 0.15s;
  margin-right: 12px;
  flex-shrink: 0;
}
.sidebar-trigger.visible {
  opacity: 1;
  pointer-events: auto;
}
.sidebar-trigger:hover { color: #c0c0c8; background: rgba(255,255,255,0.05); }

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
}

/* ---- Top Bar ---- */
.top-bar {
  padding: 14px 22px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.top-bar h1 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: #f4f4f8;
  letter-spacing: -0.02em;
}

.spacer { flex: 1; }

.mode-switcher {
  display: flex;
  gap: 2px;
  background: #2c2c37;
  border-radius: 9px;
  padding: 3px;
  margin-left: 16px;
}

.mode-btn {
  padding: 5px 14px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #8a8a96;
  cursor: pointer;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s;
}

.mode-btn.active {
  background: #3e3e4e;
  color: #eeeeee;
  box-shadow: 0 1px 2px rgba(0,0,0,0.3);
}
.mode-btn:hover:not(.active) { color: #c0c0c8; }

/* ---- Workspace ---- */
.workspace {
  padding: 0 22px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}

/* ---- Config Card ---- */
.config-card {
  padding: 20px 22px;
  background: #2c2c37;
  border: 1px solid #3e3e4e;
  border-radius: 14px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid #3e3e4e;
}

.card-title h2 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: #f4f4f8;
  letter-spacing: -0.01em;
}

.card-icon { font-size: 18px; }

.config-row {
  display: flex;
  gap: 14px;
  margin-bottom: 14px;
  flex-wrap: wrap;
  align-items: flex-end;
}

.form-group {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-group label {
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: #8a8a96;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-hint {
  font-size: 11px;
  color: #8a8a96;
}

.dataset-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dataset-row .el-button {
  flex: 1;
}

.dataset-name {
  color: #6db0fa;
  font-size: 12px;
  font-weight: 500;
}

/* ---- Multi-Task ---- */
.multi-task-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.multi-header h3 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: #eeeeee;
}

.task-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 12px;
}

.task-card {
  padding: 16px;
  background: #2c2c37;
  border: 1px solid #3e3e4e;
  border-radius: 12px;
  transition: all 0.2s;
}
.task-card:hover { border-color: #505060; }
.task-card.running { border-color: #4b8ff7; box-shadow: 0 0 0 1px rgba(75,143,247,0.2); }
.task-card.completed { border-color: #10b981; opacity: 0.85; }
.task-card.failed { border-color: #dc2626; opacity: 0.85; }

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.task-header h4 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #f4f4f8;
}

.task-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.fg {
  flex: 1;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fg label {
  font-size: 11px;
  font-weight: 600;
  color: #8a8a96;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.prev-model-info {
  color: #8a8a96;
  font-size: 12px;
  font-style: italic;
  padding: 6px 10px;
  background: rgba(139,92,246,0.08);
  border-radius: 6px;
  border: 1px solid rgba(139,92,246,0.15);
}

.task-status-indicator { padding: 4px 0; }

.status-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}
.status-badge.running { background: rgba(75,143,247,0.15); color: #6db0fa; }
.status-badge.completed { background: rgba(16,185,129,0.15); color: #4adea0; }
.status-badge.failed { background: rgba(220,38,38,0.15); color: #f87171; }

/* ---- Dashboard ---- */
.dashboard-card {
  padding: 18px 22px;
  background: #2c2c37;
  border: 1px solid #3e3e4e;
  border-radius: 14px;
}

.dashboard-card h3 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #6db0fa;
}

.dashboard-status {
  display: flex;
  justify-content: space-between;
  color: #c0c0c8;
  font-size: 12px;
  margin-bottom: 10px;
}

.progress-bar-wrap {
  position: relative;
  height: 24px;
  background: #22222c;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 14px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4b8ff7, #8b5cf6);
  border-radius: 6px;
  transition: width 0.4s ease;
}

.progress-label {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 11px;
  font-weight: 600;
  color: #f4f4f8;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.metric-card {
  padding: 10px;
  background: #22222c;
  border: 1px solid #3e3e4e;
  border-radius: 8px;
  text-align: center;
}

.metric-key { color: #c0c0c8; font-size: 11px; margin-bottom: 3px; font-family: 'Space Grotesk', sans-serif; }
.metric-val { color: #6db0fa; font-size: 16px; font-weight: 700; margin-bottom: 3px; font-family: 'DM Sans', sans-serif; }
.metric-desc { color: #8a8a96; font-size: 10px; line-height: 1.3; }

/* ---- Param Dialog ---- */
.param-fieldset {
  border: 1px solid #3e3e4e;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}

.param-fieldset legend {
  padding: 0 6px;
  font-weight: 700;
  color: #6db0fa;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 13px;
}

.param-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

@media (max-width: 600px) {
  .param-grid { grid-template-columns: repeat(2, 1fr); }
  .task-cards { grid-template-columns: 1fr; }
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.param-item label {
  font-size: 11px;
  color: #8a8a96;
  font-weight: 500;
}
</style>
