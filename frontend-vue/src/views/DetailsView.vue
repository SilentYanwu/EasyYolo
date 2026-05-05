<script setup lang="ts">
// 模型详情页 — 训练指标、评估图表、每类评估表格、模型管理操作
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ModelSidebar from '@/components/sidebar/ModelSidebar.vue'
import { useModelStore } from '@/stores/models'
import { useAppStore } from '@/stores/app'
import * as trainingApi from '@/api/trainingapi'
import { ElMessage } from 'element-plus'
import type { ModelDetail, EvalTableRow } from '@/types'
import { API_BASE } from '@/config'

const route = useRoute()
const router = useRouter()
const modelStore = useModelStore()
const appStore = useAppStore()

const detail = ref<ModelDetail | null>(null)
const loading = ref(false)
const charts = ref<string[]>([])
const evalRows = ref<EvalTableRow[]>([])
const bestMetrics = ref<Record<string, number>>({})
const totalEpochs = ref(0)

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

// 图表名映射
const chartDescriptions: Record<string, string> = {
  'results.png': '训练总览：展示训练/验证阶段各项损失值与评估指标随 Epoch 的变化趋势。',
  'confusion_matrix.png': '混淆矩阵：以绝对数量展示模型在各类别上的预测正确/错误分布。',
  'confusion_matrix_normalized.png': '归一化混淆矩阵：按百分比展示各类别的预测准确率。',
  'F1_curve.png': 'F1 曲线：展示不同置信度阈值下的 F1 分数变化。',
  'PR_curve.png': 'PR 曲线：展示精确度与召回率的权衡关系，曲线下面积越大越好。',
  'P_curve.png': 'Precision 曲线：展示不同置信度阈值下精确度的变化。',
  'R_curve.png': 'Recall 曲线：展示不同置信度阈值下召回率的变化。',
  'BoxF1_curve.png': '边界框 F1 曲线（YOLOv8/11格式）。',
  'BoxPR_curve.png': '边界框 PR 曲线（YOLOv8/11格式）。',
  'BoxP_curve.png': '边界框 Precision 曲线（YOLOv8/11格式）。',
  'BoxR_curve.png': '边界框 Recall 曲线（YOLOv8/11格式）。',
  'labels.jpg': '标签分布：展示数据集中各类别标注的数量和位置分布统计。',
  'labels_correlogram.jpg': '标签相关性：展示标注框的宽度、高度、位置之间的相关性分布。',
}

const metricDescriptions: Record<string, string> = {
  'mAP50': '平均精度(IoU=0.50)，衡量模型在 50% 重叠阈值下的整体检测准确度',
  'mAP50-95': '平均精度(IoU=0.50:0.95)，最严格的检测性能指标',
  'Precision': '精确率，预测为正样本中实际为正样本的比例',
  'Recall': '召回率，实际正样本中被正确检测到的比例',
  'Box Loss': '边界框回归损失，训练中应持续降低',
  'Cls Loss': '分类损失，训练中应持续降低',
  'Dfl Loss': '分布焦点损失，YOLO11 特有的边界框精细化损失',
}

const paramExplains: Record<string, string> = {
  'epochs': '训练轮数，模型完整遍历整个数据集的次数',
  'patience': '早停轮数，连续无提升则提前停止',
  'batch': '批次大小，每次迭代加载的样本数量',
  'imgsz': '输入图片的缩放尺寸',
  'optimizer': '优化算法',
  'lr0': '初始学习率',
  'lrf': '最终学习率倍数',
  'momentum': '动量因子',
  'weight_decay': '权重衰减，用于正则化',
  'warmup_epochs': '预热轮数',
  'warmup_momentum': '预热初始动量',
  'cos_lr': '是否开启余弦学习率调度',
  'hsv_h': 'HSV-Hue 增强',
  'hsv_s': 'HSV-Saturation 增强',
  'hsv_v': 'HSV-Value 增强',
  'degrees': '随机旋转角度范围',
  'translate': '随机平移比例',
  'scale': '随机缩放比例范围',
  'shear': '随机剪切角度范围',
  'perspective': '随机透视变换强度',
  'flipud': '上下随机翻转概率',
  'fliplr': '左右随机翻转概率',
  'mosaic': '拼贴增强概率（4张图合1）',
  'mixup': 'Mixup 增强概率',
  'copy_paste': '拷贝粘贴增强概率',
  'seed': '随机种子',
  'workers': '加载数据的 CPU 线程数',
  'device': '显卡编号',
  'amp': '自动混合精度训练',
}

const chartNames = [
  'results.png', 'confusion_matrix.png', 'confusion_matrix_normalized.png',
  'F1_curve.png', 'PR_curve.png', 'P_curve.png', 'R_curve.png',
  'BoxF1_curve.png', 'BoxPR_curve.png', 'BoxP_curve.png', 'BoxR_curve.png',
  'labels.jpg', 'labels_correlogram.jpg'
]

// 加载模型详情 — 查询训练记录 → 解析指标/评估表格/图表 URL
async function loadDetail(modelName: string) {
  if (!modelName) return
  loading.value = true
  detail.value = null
  bestMetrics.value = {}
  evalRows.value = []
  totalEpochs.value = 0
  try {
    const res = await trainingApi.getTrainingHistory(modelName)
    if (res.data.status === 'success' && res.data.data) {
      detail.value = res.data.data

      // 解析指标
      if (detail.value?.best_metrics) {
        try { bestMetrics.value = JSON.parse(detail.value.best_metrics) } catch {}
      }
      // 解析评估表格
      if (detail.value?.eval_table) {
        try { evalRows.value = JSON.parse(detail.value.eval_table) } catch {}
      }
      // 解析总轮数
      if (detail.value?.parameters) {
        try {
          const p = JSON.parse(detail.value.parameters)
          totalEpochs.value = p.epochs || 0
        } catch {}
      }

      // 生成图表 URL
      const chartModelName = modelName.replace('.pt', '')
      charts.value = chartNames.map(name =>
        `${API_BASE}/trainchart/${chartModelName}/${name}?t=${Date.now()}`
      )
    }
  } catch (e: any) {
    ElMessage.error('获取模型详情失败')
  } finally {
    loading.value = false
  }
}

// 监听路由参数变化
watch(() => route.params.modelName, (name) => {
  if (name && typeof name === 'string') {
    appStore.detailsModelName = name
    loadDetail(name)
  }
}, { immediate: true })

// 监听侧边栏点击
watch(() => appStore.detailsModelName, (name) => {
  if (name && name !== route.params.modelName) {
    router.replace({ name: 'details', params: { modelName: name } })
  }
})

// 导航到基础模型的详情页（仅当其为 trained 模型时有效）
function navigateToBaseModel(baseModel: string) {
  if (!baseModel) return
  if (modelStore.models.trained.includes(baseModel)) {
    appStore.detailsModelName = baseModel
    router.replace({ name: 'details', params: { modelName: baseModel } })
  }
}

// 模型管理对话框
// 打开模型上传对话框
async function openUploadDialog() {
  showUploadDialog.value = true
}
// 确认上传模型
async function confirmUpload() {
  if (!uploadFile.value || !uploadModelName.value.trim()) return
  try {
    await modelStore.uploadModel(uploadFile.value, uploadModelName.value.trim())
    showUploadDialog.value = false
    ElMessage.success('模型上传成功！')
  } catch (e: any) { ElMessage.error('上传失败') }
}
// 打开重命名对话框（预填旧名称去掉 .pt 后缀）
function openRenameDialog(name: string, category: string) {
  renameOldName.value = name
  renameCategory.value = category
  renameNewName.value = name.replace('.pt', '')
  showRenameDialog.value = true
}
// 确认重命名 → 同步详情页模型名
async function confirmRename() {
  if (!renameNewName.value.trim()) return
  // 检查同类别下是否已有同名模型
  const newFileName = renameNewName.value.trim().endsWith('.pt')
    ? renameNewName.value.trim()
    : renameNewName.value.trim() + '.pt'
  const categoryModels = modelStore.models[renameCategory.value] || []
  if (newFileName !== renameOldName.value && categoryModels.includes(newFileName)) {
    ElMessage.warning('同类型模型名字不可重复')
    return
  }
  try {
    await modelStore.renameModel(renameOldName.value, renameNewName.value.trim(), renameCategory.value)
    showRenameDialog.value = false
    ElMessage.success('重命名成功！')
    if (appStore.detailsModelName === renameOldName.value) {
      appStore.detailsModelName = renameNewName.value.endsWith('.pt') ? renameNewName.value.trim() : renameNewName.value.trim() + '.pt'
    }
  } catch (e: any) { ElMessage.error('重命名失败') }
}
// 打开删除确认对话框
function openDeleteDialog(name: string, category: string) {
  deleteModelName.value = name
  deleteCategory.value = category
  showDeleteDialog.value = true
}
// 确认删除 → 如果是当前查看的模型则清空详情
async function confirmDelete() {
  try {
    await modelStore.deleteModel(deleteModelName.value, deleteCategory.value)
    showDeleteDialog.value = false
    ElMessage.success('删除成功！')
    if (appStore.detailsModelName === deleteModelName.value) {
      appStore.detailsModelName = ''
      detail.value = null
    }
  } catch (e: any) { ElMessage.error('删除失败') }
}
// 打开模型介绍编辑对话框
function openEditDescDialog(name: string, _category: string) {
  editDescModelName.value = name
  editDescText.value = ''
  showEditDescDialog.value = true
}
// 确认修改介绍 → 刷新详情页
async function confirmEditDesc() {
  try {
    await modelStore.updateDescription(editDescModelName.value, editDescText.value)
    showEditDescDialog.value = false
    ElMessage.success('描述修改成功！')
    if (appStore.detailsModelName === editDescModelName.value) {
      loadDetail(editDescModelName.value)
    }
  } catch (e: any) { ElMessage.error('修改失败') }
}

// 格式化指标值
// 格式化指标数值 — 小数值保留更多小数位
function formatMetric(val: number): string {
  if (val < 0.01) return val.toFixed(6)
  if (val < 1) return val.toFixed(4)
  return val.toFixed(2)
}

const paramsObj = computed(() => {
  if (!detail.value?.parameters) return {}
  try { return JSON.parse(detail.value.parameters) } catch { return {} }
})

onMounted(() => {
  const modelName = route.params.modelName as string | undefined
  if (modelName) {
    appStore.detailsModelName = modelName
    loadDetail(modelName)
  } else if (appStore.detailsModelName) {
    router.replace({ name: 'details', params: { modelName: appStore.detailsModelName } })
  }
})
</script>

<template>
  <div class="app-container">
    <ModelSidebar
      mode="details"
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
        <h1>模型评估与详情</h1>
      </div>

      <div class="workspace" v-if="!detail && !loading">
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <h2>请从左侧选择一个经过训练的模型来查看详情</h2>
        </div>
      </div>

      <div class="workspace" v-if="loading">
        <div class="loading-state">
          <el-icon class="is-loading" :size="32"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4"/></svg></el-icon>
          <p>加载中...</p>
        </div>
      </div>

      <div class="workspace" v-if="detail">
        <!-- 模型信息卡片 -->
        <div class="info-card">
          <div class="info-header">
            <div>
              <div class="info-title-row">
                <h2>{{ detail.model_name }}</h2>
                <el-dropdown trigger="click">
                  <span class="menu-dots">⋮</span>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item @click="openRenameDialog(detail.model_name, 'trained')">重命名</el-dropdown-item>
                      <el-dropdown-item @click="openEditDescDialog(detail.model_name, 'trained')">修改介绍</el-dropdown-item>
                      <el-dropdown-item divided style="color: #ef4444;" @click="openDeleteDialog(detail.model_name, 'trained')">删除模型</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
              <div class="info-dataset">{{ detail.dataset || '--' }}</div>
            </div>
            <div class="info-desc">{{ detail.description ? `📝 ${detail.description}` : '暂无介绍' }}</div>
            <div class="info-meta">
              <span>基础模型: <a href="#" @click.prevent="navigateToBaseModel(detail.base_model)" class="link">{{ detail.base_model || '无' }}</a></span>
              <span>训练完成时间: {{ detail.time || '--' }}</span>
            </div>
          </div>

          <!-- 训练参数表 -->
          <h3>训练超参数</h3>
          <div class="params-table-wrap">
            <table class="params-table">
              <thead>
                <tr><th>参数名</th><th>设定值</th><th>参数含义</th></tr>
              </thead>
              <tbody>
                <tr v-for="(val, key) in paramsObj" :key="key">
                  <td class="param-key">{{ key }}</td>
                  <td class="param-val">{{ val }}</td>
                  <td class="param-desc">{{ paramExplains[key as string] || '自定义训练参数' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 最佳一轮训练指标 -->
        <div v-if="Object.keys(bestMetrics).length || detail.best_epoch || detail.early_stopped" class="section-card">
          <h3>最佳一轮训练指标</h3>
          <div class="metrics-grid">
            <div v-if="detail.best_epoch" class="metric-card highlight">
              <div class="metric-key">最佳轮次</div>
              <div class="metric-val">第 {{ detail.best_epoch }} 轮</div>
              <div class="metric-desc">共 {{ totalEpochs || '--' }} 轮，Fitness 最高的那一轮</div>
            </div>
            <div v-if="detail.early_stopped" class="metric-card warn">
              <div class="metric-key">训练状态</div>
              <div class="metric-val">早停完成</div>
              <div class="metric-desc">第 {{ detail.early_stop_epoch }}/{{ totalEpochs }} 轮触发早停</div>
            </div>
            <div v-for="(val, key) in bestMetrics" :key="key" class="metric-card">
              <div class="metric-key">{{ key }}</div>
              <div class="metric-val">{{ formatMetric(val as number) }}</div>
              <div class="metric-desc">{{ metricDescriptions[key as string] || '' }}</div>
            </div>
          </div>
        </div>

        <!-- 每类评估指标表格 -->
        <div v-if="evalRows.length > 0" class="section-card">
          <h3>最终评估结果</h3>
          <div class="eval-table-wrap">
            <table class="eval-table">
              <thead>
                <tr><th>Class</th><th>Images</th><th>Instances</th><th>Box(P)</th><th>R</th><th>mAP50</th><th>mAP50-95</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in evalRows" :key="row.class" :class="{ 'row-all': row.class === 'all' }">
                  <td class="col-class">{{ row.class }}</td>
                  <td class="col-num">{{ row.images }}</td>
                  <td class="col-num">{{ row.instances }}</td>
                  <td class="col-p">{{ row.p }}</td>
                  <td class="col-r">{{ row.r }}</td>
                  <td class="col-map">{{ row.map50 }}</td>
                  <td class="col-map95">{{ row.map50_95 }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 模型评估图表 -->
        <div class="section-card">
          <h3>模型评估图表</h3>
          <div class="charts-grid">
            <div v-for="(url, i) in charts" :key="chartNames[i] || i" class="chart-card">
              <div class="chart-title">{{ (chartNames[i] || '').split('.')[0].replace(/_/g, ' ').toUpperCase() }}</div>
              <div class="chart-desc">{{ chartNames[i] ? chartDescriptions[chartNames[i]] || '' : '' }}</div>
              <img :src="url" :alt="chartNames[i] || ''" class="chart-img" @click="(e: any) => { const w = e.target?.ownerDocument?.defaultView; if (w) w.open(url, '_blank') }" @error="(e: Event) => { const el = e.target as HTMLElement; if (el.parentElement) el.parentElement.style.display = 'none' }">
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 对话框 -->
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

.empty-state, .loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #505060;
}
.empty-icon { font-size: 72px; margin-bottom: 14px; opacity: 0.6; }
.empty-state h2 { font-family: 'Space Grotesk', sans-serif; font-size: 17px; font-weight: 500; color: #8a8a96; }

/* ---- Info Card ---- */
.info-card, .section-card {
  padding: 18px 22px;
  background: #2c2c37;
  border: 1px solid #3e3e4e;
  border-radius: 14px;
}
.info-header { margin-bottom: 16px; }

.info-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.info-title-row h2 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: #f4f4f8;
  letter-spacing: -0.01em;
}

.menu-dots {
  font-size: 20px;
  color: #8a8a96;
  cursor: pointer;
  padding: 0 6px;
  transition: color 0.15s;
}
.menu-dots:hover { color: #c0c0c8; }

.info-dataset {
  color: #6db0fa;
  font-size: 13px;
  margin-top: 2px;
  font-family: 'DM Sans', sans-serif;
  font-weight: 500;
}

.info-desc {
  color: #c0c0c8;
  font-size: 13px;
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
  line-height: 1.6;
}

.info-meta {
  display: flex;
  gap: 20px;
  margin-top: 8px;
  color: #8a8a96;
  font-size: 12px;
}

.link {
  color: #6db0fa;
  text-decoration: none;
  font-weight: 500;
}
.link:hover { text-decoration: underline; }

/* ---- Section Headings ---- */
h3 {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: #c0c0c8;
  margin: 14px 0 10px;
  padding-top: 14px;
  border-top: 1px solid #3e3e4e;
}

/* ---- Params Table ---- */
.params-table-wrap { overflow-x: auto; }

.params-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.params-table th {
  text-align: left;
  padding: 8px 10px;
  background: rgba(75,143,247,0.08);
  color: #6db0fa;
  font-weight: 600;
  border-radius: 4px;
  font-family: 'DM Sans', sans-serif;
}

.params-table td { padding: 8px 10px; border-bottom: 1px solid #3e3e4e; }

.param-key { color: #6db0fa; font-family: 'DM Sans', sans-serif; font-weight: 600; }
.param-val { color: #eeeeee; font-weight: 600; }
.param-desc { color: #8a8a96; }

/* ---- Metrics Grid ---- */
.metrics-grid {
  display: flex;
  gap: 8px;
}

.metric-card {
  flex: 1;
  min-width: 0;
  padding: 10px;
  background: #22222c;
  border: 1px solid #3e3e4e;
  border-radius: 8px;
  text-align: center;
}

.metric-card.highlight { background: rgba(75,143,247,0.1); border-color: rgba(75,143,247,0.3); }
.metric-card.warn { background: rgba(217,119,6,0.08); border-color: rgba(217,119,6,0.3); }

.metric-key { color: #c0c0c8; font-size: 11px; margin-bottom: 3px; font-family: 'Space Grotesk', sans-serif; }
.metric-val { color: #6db0fa; font-size: 16px; font-weight: 700; margin-bottom: 3px; font-family: 'DM Sans', sans-serif; }
.metric-desc { color: #8a8a96; font-size: 10px; line-height: 1.3; }
.metric-card.warn .metric-val { color: #f59e0b; }

/* ---- Eval Table ---- */
.eval-table-wrap { overflow-x: auto; }

.eval-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.eval-table th {
  padding: 7px 10px;
  background: rgba(75,143,247,0.08);
  color: #6db0fa;
  font-weight: 600;
  text-align: left;
  font-family: 'DM Sans', sans-serif;
}

.eval-table td { padding: 7px 10px; border-bottom: 1px solid #3e3e4e; }

.row-all { background: rgba(75,143,247,0.06); font-weight: 600; }
.row-all td { color: #6db0fa; }

.col-class { color: #f59e0b; font-family: 'DM Sans', sans-serif; font-weight: 600; }
.col-num { color: #8a8a96; }
.col-p { color: #4adea0; font-family: 'DM Sans', sans-serif; font-weight: 600; }
.col-r { color: #6db0fa; font-family: 'DM Sans', sans-serif; font-weight: 600; }
.col-map { color: #f472b6; font-family: 'DM Sans', sans-serif; font-weight: 600; }
.col-map95 { color: #a78bfa; font-family: 'DM Sans', sans-serif; font-weight: 600; }

/* ---- Charts ---- */
.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.chart-card {
  padding: 14px;
  background: #22222c;
  border: 1px solid #3e3e4e;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: border-color 0.15s;
}
.chart-card:hover { border-color: #505060; }

.chart-title { color: #6db0fa; font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; }
.chart-desc { color: #8a8a96; font-size: 11px; text-align: center; }

.chart-img {
  width: 100%;
  border-radius: 6px;
  cursor: pointer;
  object-fit: contain;
  min-height: 160px;
}
</style>
