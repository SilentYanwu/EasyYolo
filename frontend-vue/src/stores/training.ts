// 训练 Store — 单任务/多任务队列、参数管理、进度轮询
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as trainingApi from '@/api/trainingapi'
import { useModelStore } from './models'
import type { TrainingState, TrainingParams, TrainingTask } from '@/types'
import { MAX_TRAINING_TASKS, TRAINING_POLL_INTERVAL } from '@/config'
import { ElMessage } from 'element-plus'

// 训练超参数默认值
export const defaultTrainParams: TrainingParams = {
  epochs: 60, patience: 15, batch: 12, imgsz: 640,
  optimizer: 'auto', lr0: 0.01, lrf: 0.01,
  momentum: 0.937, weight_decay: 0.0005,
  warmup_epochs: 3.0, warmup_momentum: 0.8, cos_lr: false,
  hsv_h: 0.015, hsv_s: 0.7, hsv_v: 0.4,
  degrees: 0.0, translate: 0.1, scale: 0.5, shear: 0.0, perspective: 0.0,
  flipud: 0.0, fliplr: 0.5, mosaic: 1.0, mixup: 0.0, copy_paste: 0.0,
  seed: 42, workers: 4, device: '', amp: true
}

export const useTrainingStore = defineStore('training', () => {
  // 单任务状态
  const uploadedDatasetPath = ref('')
  const uploadedDatasetName = ref('未选择')
  const trainParams = ref<TrainingParams>({ ...defaultTrainParams })

  // 训练进度
  const trainingState = ref<TrainingState>({
    model_name: null, status: 'idle', progress: 0, total: 0,
    metrics: {}, eta: '--', error_msg: '', start_time: 0, last_epoch_time: 0,
    is_early_stopped: false, early_stopped_epoch: 0
  })

  const isTraining = computed(() => trainingState.value.status === 'training')

  // 训练模式
  const trainingMode = ref<'single' | 'multi'>(
    (localStorage.getItem('trainingMode') as 'single' | 'multi') || 'single'
  )

  // 多任务队列
  const tasks = ref<TrainingTask[]>([])
  const currentTaskIndex = ref(-1)
  const isQueueRunning = ref(false)
  const queueStatus = ref<'idle' | 'running' | 'stopped' | 'error' | 'completed'>('idle')

  const currentTask = computed(() => {
    if (currentTaskIndex.value >= 0 && currentTaskIndex.value < tasks.value.length) {
      return tasks.value[currentTaskIndex.value]
    }
    return null
  })

  // 切换单任务/多任务模式（持久化到 localStorage）
  function setTrainingMode(mode: 'single' | 'multi') {
    trainingMode.value = mode
    localStorage.setItem('trainingMode', mode)
  }

  // 单任务操作
  // 记录上传数据集的路径和显示名
  function setDatasetPath(path: string, name: string) {
    uploadedDatasetPath.value = path
    uploadedDatasetName.value = name
  }

  // 合并部分参数到当前训练参数
  function updateTrainParams(params: Partial<TrainingParams>) {
    Object.assign(trainParams.value, params)
  }

  // 重置训练参数为默认值
  function resetTrainParams() {
    trainParams.value = { ...defaultTrainParams }
  }

  // 训练进度轮询
  let poller: ReturnType<typeof setInterval> | null = null
  let lastStatus = 'idle'

  // 启动全局训练进度轮询器（TRAINING_POLL_INTERVAL 间隔），检测训练完成/失败/早停
  function startPoller() {
    if (poller) return
    poller = setInterval(async () => {
      try {
        const res = await trainingApi.getTrainingProgress()
        const data = res.data as TrainingState
        trainingState.value = data

        if (data.status !== 'training' && lastStatus === 'training') {
          // 队列运行中时不弹窗/刷页面，由队列自身的 waitForTaskCompletion 处理流转
          if (!isQueueRunning.value) {
            if (data.status === 'success') {
              ElMessage.success('训练完成！新模型已就绪。')
              setTimeout(() => window.location.reload(), 2000)
            } else if (data.status === 'early_stopped') {
              ElMessage.warning(`训练已早停完成！在第${data.early_stopped_epoch}轮提前结束。`)
              setTimeout(() => window.location.reload(), 2000)
            } else if (data.status === 'stopped') {
              ElMessage.info('训练已停止')
            } else if (data.status === 'error') {
              ElMessage.error(`训练出错: ${data.error_msg}`)
            }
          }
        }
        lastStatus = data.status
      } catch {
        // 轮询失败时忽略
      }
    }, TRAINING_POLL_INTERVAL)
  }

  // 停止全局轮询器
  function stopPoller() {
    if (poller) {
      clearInterval(poller)
      poller = null
    }
  }

  // 多任务操作
  // 从 localStorage 恢复多任务队列状态（页面刷新后自动还原）
  function initFromStorage() {
    try {
      const saved = localStorage.getItem('multiTaskQueue')
      if (saved) {
        const data = JSON.parse(saved)
        tasks.value = data.tasks || []
        currentTaskIndex.value = data.currentTaskIndex ?? -1
        isQueueRunning.value = data.isQueueRunning || false
        queueStatus.value = data.queueStatus || 'idle'
      }
    } catch { /* ignore */ }
  }

  // 将当前队列状态序列化到 localStorage
  function saveToStorage() {
    localStorage.setItem('multiTaskQueue', JSON.stringify({
      tasks: tasks.value,
      currentTaskIndex: currentTaskIndex.value,
      isQueueRunning: isQueueRunning.value,
      queueStatus: queueStatus.value
    }))
  }

  // 创建一个新任务（包含默认参数，首任务默认 modelSource='existing'，后续默认 'previous'）
  function createTask(index: number): TrainingTask {
    const chineseNumbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
    return {
      id: Date.now() + Math.random(),
      index,
      title: `任务${chineseNumbers[index - 1] || index}`,
      modelSource: index === 1 ? 'existing' : 'previous',
      baseModel: '',
      newModelName: '',
      description: '',
      datasetPath: '',
      datasetName: '未选择',
      parameters: { ...defaultTrainParams },
      status: 'pending',
      progress: 0,
      totalEpochs: 0,
      errorMessage: ''
    }
  }

  // 向队列末尾添加一个新任务
  function addTask() {
    if (tasks.value.length >= MAX_TRAINING_TASKS) {
      ElMessage.warning(`最多支持${MAX_TRAINING_TASKS}个任务`)
      return
    }
    tasks.value.push(createTask(tasks.value.length + 1))
    saveToStorage()
  }

  // 删除指定位置的任务（自动修复后续任务的依赖关系和序号）
  function deleteTask(index: number) {
    if (isQueueRunning.value) {
      ElMessage.warning('队列运行中，请先停止')
      return
    }
    // 修复后续任务的依赖
    for (let i = index + 1; i < tasks.value.length; i++) {
      if (tasks.value[i].modelSource === 'previous') {
        tasks.value[i].modelSource = 'existing'
        tasks.value[i].baseModel = ''
      }
    }
    tasks.value.splice(index, 1)
    tasks.value.forEach((t, i) => {
      t.index = i + 1
      const nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
      t.title = `任务${nums[i] || i + 1}`
    })
    saveToStorage()
  }

  // 更新指定任务的属性（局部合并）
  function updateTask(index: number, updates: Partial<TrainingTask>) {
    if (index < 0 || index >= tasks.value.length) return
    Object.assign(tasks.value[index], updates)
    saveToStorage()
  }

  // 将当前任务标记为完成，推进到下一个任务
  function moveToNextTask() {
    const task = tasks.value[currentTaskIndex.value]
    if (task) {
      task.status = 'completed'
    }
    currentTaskIndex.value++
    if (currentTaskIndex.value >= tasks.value.length) {
      isQueueRunning.value = false
      queueStatus.value = 'completed'
      currentTaskIndex.value = -1
    }
    saveToStorage()
  }

  // 重置所有训练状态（单任务 + 轮询器）
  function reset() {
    uploadedDatasetPath.value = ''
    uploadedDatasetName.value = '未选择'
    trainParams.value = { ...defaultTrainParams }
    trainingState.value = {
      model_name: null, status: 'idle', progress: 0, total: 0,
      metrics: {}, eta: '--', error_msg: '', start_time: 0, last_epoch_time: 0,
      is_early_stopped: false, early_stopped_epoch: 0
    }
    stopPoller()
    lastStatus = 'idle'
  }

  return {
    uploadedDatasetPath, uploadedDatasetName, trainParams,
    trainingState, isTraining, trainingMode,
    tasks, currentTaskIndex, isQueueRunning, queueStatus, currentTask,
    setTrainingMode, setDatasetPath, updateTrainParams, resetTrainParams,
    startPoller, stopPoller,
    initFromStorage, saveToStorage, addTask, deleteTask, updateTask, moveToNextTask,
    reset
  }
})
