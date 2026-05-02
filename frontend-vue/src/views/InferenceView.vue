<script setup lang="ts">
// 推理页面 — 图片/视频上传、单张/批量预测、SSE 进度流、历史记录
import { ref, onMounted, watch } from 'vue'
import ModelSidebar from '@/components/sidebar/ModelSidebar.vue'
import { useModelStore } from '@/stores/models'
import { useAppStore } from '@/stores/app'
import * as inferenceApi from '@/api/inference'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { HistoryItem } from '@/types'
import { MAX_THUMBNAILS } from '@/config'

const modelStore = useModelStore()
const appStore = useAppStore()

// 文件选择
const selectedFiles = ref<File[]>([])
const isVideo = ref(false)
const imageInput = ref<HTMLInputElement>()
const videoInput = ref<HTMLInputElement>()

// 预览
const originalImgSrc = ref('')
const originalVideoSrc = ref('')

// 结果
const resultImgSrc = ref('')
const resultVideoSrc = ref('')
const showResultImg = ref(false)
const showResultVideo = ref(false)
const downloadUrl = ref('')

// 进度
const showProgress = ref(false)
const progressPercent = ref(0)
const progressText = ref('')
const statusText = ref('等待上传...')
const predicting = ref(false)

// 缩略图
const thumbnails = ref<string[]>([])
const thumbnailCount = ref(0)

// 历史记录
const history = ref<HistoryItem[]>([])
const loadingHistory = ref(false)

// 对话框
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

// 侧边栏显示

function onImageSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length === 0) return
  if (files.length > 99) {
    ElMessage.warning(`单次最多支持 99 张图片，您选择了 ${files.length} 张`)
    return
  }
  selectedFiles.value = files
  isVideo.value = false
  showResultImg.value = false
  showResultVideo.value = false

  if (files.length === 1) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      originalImgSrc.value = ev.target?.result as string
    }
    reader.readAsDataURL(files[0])
    statusText.value = '准备就绪'
    thumbnails.value = []
    thumbnailCount.value = 0
  } else {
    const thumbs: string[] = []
    const count = Math.min(files.length, MAX_THUMBNAILS)
    for (let i = 0; i < count; i++) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        thumbs.push(ev.target?.result as string)
      }
      reader.readAsDataURL(files[i])
    }
    thumbnails.value = thumbs
    thumbnailCount.value = files.length
    statusText.value = `已选择 ${files.length} 张图片`
  }
  if (imageInput.value) imageInput.value.value = ''
}

function onVideoSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  selectedFiles.value = [file]
  isVideo.value = true
  originalVideoSrc.value = URL.createObjectURL(file)
  showResultImg.value = false
  showResultVideo.value = false
  statusText.value = '视频已就绪'
  if (videoInput.value) videoInput.value.value = ''
}

async function handlePredict() {
  if (selectedFiles.value.length === 0) return
  predicting.value = true
  showProgress.value = true

  try {
    if (isVideo.value && selectedFiles.value[0]) {
      await handleVideoPredict(selectedFiles.value[0])
    } else if (selectedFiles.value.length === 1 && selectedFiles.value[0]) {
      await handleSinglePredict(selectedFiles.value[0])
    } else {
      await handleBatchPredict(selectedFiles.value)
    }
  } catch (e: any) {
    ElMessage.error('推理出错: ' + (e.message || '未知错误'))
    statusText.value = '推理出错'
  } finally {
    predicting.value = false
  }
}

async function handleSinglePredict(file: File) {
  progressPercent.value = 0
  progressText.value = '0/1'
  statusText.value = '识别中...'
  const res = await inferenceApi.predictSingle(file)
  resultImgSrc.value = res.data.result_url
  showResultImg.value = true
  downloadUrl.value = res.data.result_url
  progressPercent.value = 100
  progressText.value = '1/1'
  statusText.value = '完成'
  await fetchHistory()
}

async function handleBatchPredict(files: File[]) {
  progressPercent.value = 0
  progressText.value = `0/${files.length}`
  statusText.value = '批量识别中...'

  const response = await inferenceApi.predictBatch(files)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop()!
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data: ')) continue
      const event = JSON.parse(line.slice(6))
      if (event.done) {
        progressPercent.value = 100
        progressText.value = `${event.total}/${event.total}`
        statusText.value = '批量识别完成'
      } else {
        progressPercent.value = Math.round((event.current / event.total) * 100)
        progressText.value = `${event.current}/${event.total}`
        originalImgSrc.value = event.original_url
        resultImgSrc.value = event.result_url
        showResultImg.value = true
        downloadUrl.value = event.result_url
      }
    }
  }
  await fetchHistory()
}

async function handleVideoPredict(file: File) {
  progressPercent.value = 0
  progressText.value = '0%'
  statusText.value = '上传并初始化...'

  const response = await inferenceApi.predictVideo(file)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop()!
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data: ')) continue
      const event = JSON.parse(line.slice(6))
      if (event.done) {
        resultVideoSrc.value = event.result_url + '?t=' + Date.now()
        showResultVideo.value = true
        downloadUrl.value = event.result_url
        progressPercent.value = 100
        progressText.value = '100%'
        statusText.value = '完成'
      } else {
        const pct = event.percent || 0
        progressPercent.value = pct
        progressText.value = `${pct}%`
        statusText.value = `处理中: ${event.current_frame}/${event.total_frames}`
      }
    }
  }
  await fetchHistory()
}

async function fetchHistory() {
  loadingHistory.value = true
  try {
    const res = await inferenceApi.getHistory(modelStore.currentModelName)
    history.value = res.data
  } catch { /* ignore */ }
  finally { loadingHistory.value = false }
}

function viewHistory(item: HistoryItem) {
  const isVid = item.result.toLowerCase().endsWith('.mp4')
  isVideo.value = isVid
  showResultImg.value = !isVid
  showResultVideo.value = isVid
  if (isVid) {
    originalVideoSrc.value = item.original + '?t=' + Date.now()
    resultVideoSrc.value = item.result + '?t=' + Date.now()
  } else {
    originalImgSrc.value = item.original
    resultImgSrc.value = item.result
  }
  downloadUrl.value = item.result
}

async function deleteHistory(id: number) {
  try {
    await ElMessageBox.confirm('确定要删除这条历史记录吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await inferenceApi.deleteHistoryItem(id)
    await fetchHistory()
    ElMessage.success('删除成功')
  } catch { /* cancelled */ }
}

async function clearAllHistory() {
  try {
    await ElMessageBox.confirm('确定要清空所有历史记录吗？此操作不可恢复。', '确认清空', {
      confirmButtonText: '确定清空',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await inferenceApi.clearHistory(modelStore.currentModelName)
    await fetchHistory()
    ElMessage.success('已清空')
  } catch { /* cancelled */ }
}

// 模型管理对话框
function openUploadDialog() {
  uploadFile.value = null
  uploadModelName.value = ''
  showUploadDialog.value = true
}

async function confirmUpload() {
  if (!uploadFile.value) {
    ElMessage.warning('请选择模型文件')
    return
  }
  if (!uploadModelName.value.trim()) {
    ElMessage.warning('请输入模型名称')
    return
  }
  try {
    await modelStore.uploadModel(uploadFile.value, uploadModelName.value.trim())
    showUploadDialog.value = false
    ElMessage.success('模型上传成功！')
  } catch (e: any) {
    ElMessage.error('上传失败: ' + (e.response?.data?.detail || e.message))
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
    ElMessage.success('模型重命名成功！')
  } catch (e: any) {
    ElMessage.error('重命名失败: ' + (e.response?.data?.detail || e.message))
  }
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
    ElMessage.success('模型删除成功！')
  } catch (e: any) {
    ElMessage.error('删除失败: ' + (e.response?.data?.detail || e.message))
  }
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
  } catch (e: any) {
    ElMessage.error('修改失败: ' + (e.response?.data?.detail || e.message))
  }
}

function togglePlayPause() {
  const video = document.getElementById('resultVideo') as HTMLVideoElement
  if (!video) return
  if (video.paused) video.play()
  else video.pause()
}

watch(() => modelStore.currentModelName, async (name) => {
  if (name) await fetchHistory()
})

onMounted(async () => {
  if (modelStore.currentModelName) {
    await fetchHistory()
  }
})
</script>

<template>
  <div class="app-container">
    <ModelSidebar
      mode="inference"
      @upload-model="openUploadDialog"
      @rename-model="openRenameDialog"
      @edit-desc="openEditDescDialog"
      @delete-model="openDeleteDialog"
    />

    <!-- 主内容区 -->
    <main class="main-content">
      <div class="top-bar">
        <button :class="['sidebar-trigger', { visible: appStore.sidebarCollapsed }]" @click="appStore.toggleSidebar()" title="展开侧边栏">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
        <h1>图像识别推理</h1>
      </div>

      <div class="workspace">
        <!-- 控制面板 -->
        <div class="control-panel">
          <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="onImageSelect">
          <input ref="videoInput" type="file" accept="video/*" hidden @change="onVideoSelect">

          <el-button type="primary" @click="imageInput?.click()">上传图片</el-button>
          <el-button @click="videoInput?.click()">上传视频</el-button>
          <el-button type="success" :disabled="selectedFiles.length === 0 || predicting" :loading="predicting" @click="handlePredict">
            {{ predicting ? '识别中...' : '开始识别' }}
          </el-button>
          <span class="status-text">{{ statusText }}</span>
        </div>

        <!-- 缩略图预览 -->
        <div v-if="thumbnails.length > 0" class="thumbnail-preview">
          <div v-for="(src, i) in thumbnails" :key="i" class="thumbnail-item">
            <img :src="src" alt="预览">
          </div>
          <span class="thumbnail-count">共 {{ thumbnailCount }} 张</span>
        </div>

        <!-- 进度条 -->
        <div v-if="showProgress" class="progress-section">
          <div class="progress-info">
            <span>{{ isVideo ? '视频推理中' : '推理中' }}</span>
            <span>{{ progressText }}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
          </div>
        </div>

        <!-- 展示区 -->
        <div class="display-area">
          <div class="display-card">
            <div class="card-header"><h4>原始{{ isVideo ? '视频' : '图片' }}</h4></div>
            <div class="card-body">
              <img v-if="!isVideo && originalImgSrc" :src="originalImgSrc" class="media-fit" alt="原始图片">
              <video v-if="isVideo && originalVideoSrc" :src="originalVideoSrc" class="media-fit" controls muted playsinline></video>
              <div v-if="!originalImgSrc && !originalVideoSrc" class="placeholder-text">等待上传...</div>
            </div>
          </div>

          <div class="display-card">
            <div class="card-header">
              <h4>识别结果</h4>
              <div class="card-actions">
                <el-button v-if="showResultVideo" size="small" @click="togglePlayPause">播放/暂停</el-button>
                <el-button v-if="downloadUrl" size="small" type="primary" tag="a" :href="downloadUrl" target="_blank">下载结果</el-button>
              </div>
            </div>
            <div class="card-body">
              <img v-if="showResultImg" :src="resultImgSrc" class="media-fit" alt="识别结果">
              <video v-if="showResultVideo" id="resultVideo" :src="resultVideoSrc" class="media-fit" controls muted playsinline></video>
              <div v-if="!showResultImg && !showResultVideo" class="placeholder-text">等待推理...</div>
            </div>
          </div>
        </div>

        <!-- 历史记录 -->
        <div class="history-panel">
          <div class="panel-header">
            <h3>历史记录（当前模型: <span class="model-label">{{ modelStore.currentModelName || '加载中...' }}</span>）</h3>
            <el-button size="small" type="danger" text @click="clearAllHistory">清空记录</el-button>
          </div>
          <div class="history-grid">
            <div v-if="history.length === 0" class="placeholder-text">暂无记录</div>
            <div
              v-for="item in history"
              :key="item.id"
              :class="['history-item', { 'video-type': item.result.toLowerCase().endsWith('.mp4') }]"
              @click="viewHistory(item)"
            >
              <div v-if="item.result.toLowerCase().endsWith('.mp4')" class="video-placeholder">
                <svg viewBox="0 0 24 24" width="36" height="36" fill="white"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <img v-else :src="item.result" alt="历史记录">
              <span>{{ item.time?.substring(5, 16)?.replace('T', ' ') }}</span>
              <div class="delete-btn" @click.stop="deleteHistory(item.id)" title="删除">×</div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 对话框 -->
    <el-dialog v-model="showUploadDialog" title="导入模型" width="420px" :close-on-click-modal="false">
      <el-upload
        :auto-upload="false"
        :limit="1"
        accept=".pt"
        :on-change="(f: any) => uploadFile = f.raw"
      >
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
      <p>确定要删除模型 <b>{{ deleteModelName }}</b> 吗？此操作不可恢复。</p>
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

.top-bar {
  padding: 14px 22px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.top-bar h1 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: #f4f4f8;
  letter-spacing: -0.02em;
}

.workspace {
  padding: 0 22px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}

/* ---- Control Panel ---- */
.control-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  background: #2c2c37;
  border-radius: 12px;
  border: 1px solid #3e3e4e;
  flex-wrap: wrap;
}

.status-text {
  color: #8a8a96;
  font-size: 13px;
  margin-left: 4px;
  font-weight: 500;
}

/* ---- Thumbnails ---- */
.thumbnail-preview {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  padding: 10px 14px;
  background: #2c2c37;
  border-radius: 10px;
  border: 1px solid #3e3e4e;
}

.thumbnail-item {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #3e3e4e;
  transition: border-color 0.15s;
}
.thumbnail-item:hover { border-color: #4b8ff7; }
.thumbnail-item img { width: 100%; height: 100%; object-fit: cover; }

.thumbnail-count { color: #8a8a96; font-size: 11px; }

/* ---- Progress ---- */
.progress-section {
  padding: 12px 16px;
  background: #2c2c37;
  border-radius: 10px;
  border: 1px solid #3e3e4e;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #c0c0c8;
  font-size: 12px;
  font-weight: 500;
}

.progress-bar {
  height: 5px;
  background: #22222c;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4b8ff7, #8b5cf6);
  border-radius: 3px;
  transition: width 0.3s ease;
}

/* ---- Display Area ---- */
.display-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 900px) { .display-area { grid-template-columns: 1fr; } }

.display-card {
  background: #2c2c37;
  border: 1px solid #3e3e4e;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255,255,255,0.02);
  border-bottom: 1px solid #3e3e4e;
}
.card-header h4 { font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; color: #c0c0c8; }

.card-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 450px;
  position: relative;
  background: #22222c;
}

.media-fit { max-width: 100%; max-height: 100%; object-fit: contain; }

.placeholder-text { color: #8a8a96; font-size: 14px; }

/* ---- History ---- */
.history-panel {
  padding: 14px 18px;
  background: #2c2c37;
  border: 1px solid #3e3e4e;
  border-radius: 12px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.panel-header h3 { font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 600; color: #eeeeee; }

.model-label { color: #6db0fa; font-family: 'DM Sans', sans-serif; font-weight: 600; }

.history-grid { display: flex; gap: 8px; flex-wrap: wrap; }

.history-item {
  width: 96px; height: 96px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  background: #22222c;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
.history-item:hover { border-color: #4b8ff7; transform: translateY(-1px); }

.history-item img { width: 100%; height: 100%; object-fit: cover; }

.history-item span {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  background: rgba(0,0,0,0.75);
  color: #c0c0c8;
  font-size: 9px;
  padding: 2px 4px;
  text-align: center;
}

.delete-btn {
  position: absolute;
  top: 3px; right: 3px;
  width: 18px; height: 18px;
  background: rgba(239,68,68,0.85);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.15s;
}
.history-item:hover .delete-btn { opacity: 1; }

.video-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #22222c, #22222c);
}

.card-actions { display: flex; gap: 6px; }
</style>
