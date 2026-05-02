<script setup lang="ts">
// 模型侧边栏 — 模型列表、训练指南、右键菜单（Teleport 到 body 避免 overflow 裁剪）
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useModelStore } from '@/stores/models'
import { useAppStore } from '@/stores/app'
import type { ModelCategory } from '@/types'

const props = withDefaults(defineProps<{
  mode?: 'inference' | 'training' | 'details'
  showGuide?: boolean
}>(), {
  mode: 'inference',
  showGuide: false
})

const emit = defineEmits<{
  uploadModel: []
  renameModel: [name: string, category: string]
  editDesc: [name: string, category: string]
  deleteModel: [name: string, category: string]
}>()

// 模型列表
const modelStore = useModelStore()
const appStore = useAppStore()
// 根据模式决定显示哪些模型分类
const sections = computed(() => {
  if (props.mode === 'training') return []
  if (props.mode === 'details') {
    return [{ title: '已训练模型库', key: 'trained' as ModelCategory, items: modelStore.models.trained }]
  }
  return [
    { title: '内置模型 (Raw)', key: 'raw' as ModelCategory, items: modelStore.models.raw },
    { title: '导入的模型 (Yolo)', key: 'yolo' as ModelCategory, items: modelStore.models.yolo },
    { title: '已训练模型 (Trained)', key: 'trained' as ModelCategory, items: modelStore.models.trained },
  ]
})

// 单一 fixed 定位的右键菜单
const ctxMenu = ref<{
  visible: boolean
  x: number
  y: number
  name: string
  category: string
}>({ visible: false, x: 0, y: 0, name: '', category: '' })

// 在模型项右侧位置打开右键菜单
function openCtxMenu(e: MouseEvent, name: string, category: string) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  ctxMenu.value = {
    visible: true,
    x: rect.right - 4,
    y: rect.bottom + 2,
    name,
    category
  }
}

// 关闭右键菜单
function closeCtxMenu() {
  ctxMenu.value.visible = false
}

// 全局点击（含 capture 阶段）关闭右键菜单
function onDocClick() {
  closeCtxMenu()
}

onMounted(() => document.addEventListener('click', onDocClick, true))
onUnmounted(() => document.removeEventListener('click', onDocClick, true))

// 点击模型名 → 推理模式切换模型 / 详情模式设置查看目标
async function handleModelClick(name: string, category: string) {
  closeCtxMenu()
  if (props.mode === 'details') {
    appStore.detailsModelName = name
    return
  }
  if (name === modelStore.currentModelName) return
  await modelStore.switchModel(name, category)
}
</script>

<template>
  <aside :class="['sidebar', { collapsed: appStore.sidebarCollapsed }]">
    <div class="sidebar-header">
      <button class="sidebar-toggle" @click="appStore.toggleSidebar()" :title="appStore.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </button>
    </div>

    <!-- 训练快速指南 -->
    <div v-if="showGuide" class="training-guide">
      <h3>训练快速指南</h3>
      <div class="guide-steps">
        <div class="guide-step" style="--accent: #3b82f6;">
          <span class="step-num">1</span>
          <div>
            <b>选择基础模型</b>
            <p>从下拉框选择预训练权重。yolo11n 最轻量，yolo11s 平衡，yolo11m 精确。</p>
          </div>
        </div>
        <div class="guide-step" style="--accent: #8b5cf6;">
          <span class="step-num">2</span>
          <div>
            <b>命名新模型</b>
            <p>给训练产物起一个有辨识度的名字，如 <code>steel_v1</code>。</p>
          </div>
        </div>
        <div class="guide-step" style="--accent: #059669;">
          <span class="step-num">3</span>
          <div>
            <b>上传数据集</b>
            <p>上传标准 YOLO 格式 ZIP 压缩包，需含 <code>data.yaml</code>。</p>
          </div>
        </div>
        <div class="guide-step" style="--accent: #d97706;">
          <span class="step-num">4</span>
          <div>
            <b>调整参数（可选）</b>
            <p>点击「调整训练参数」配置 30+ 项超参数。</p>
          </div>
        </div>
        <div class="guide-step" style="--accent: #dc2626;">
          <span class="step-num">5</span>
          <div>
            <b>开始训练</b>
            <p>点击「开始训练」在 GPU 上运行 YOLO11 训练。</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 模型列表 -->
    <div v-for="section in sections" :key="section.key" class="model-section">
      <h3>{{ section.title }}</h3>
      <div class="model-list">
        <div
          v-for="name in section.items"
          :key="name"
          :class="['model-item', {
            active: mode === 'details' ? name === appStore.detailsModelName : name === modelStore.currentModelName
          }]"
        >
          <span class="model-name" @click="handleModelClick(name, section.key)">{{ name }}</span>
          <template v-if="section.key !== 'raw'">
            <div class="model-dots" @click.stop="openCtxMenu($event, name, section.key)">⋮</div>
          </template>
        </div>
      </div>
    </div>

    <button v-if="mode !== 'details' && mode !== 'training'" class="upload-btn" @click="emit('uploadModel')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      导入新模型
    </button>
  </aside>

  <!-- 固定定位的右键菜单，不受侧边栏 overflow 裁剪 -->
  <Teleport to="body">
    <div
      v-if="ctxMenu.visible"
      class="ctx-menu-backdrop"
      @click="closeCtxMenu"
    >
      <div
        class="ctx-menu"
        :style="{ position: 'fixed', top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }"
        @click.stop
      >
        <div class="menu-item" @click.stop="emit('renameModel', ctxMenu.name, ctxMenu.category); closeCtxMenu()">重命名</div>
        <div class="menu-item" @click.stop="emit('editDesc', ctxMenu.name, ctxMenu.category); closeCtxMenu()">修改介绍</div>
        <div class="menu-item danger" @click.stop="emit('deleteModel', ctxMenu.name, ctxMenu.category); closeCtxMenu()">删除模型</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sidebar {
  width: 250px;
  background: #24242d;
  border-right: 1px solid #3e3e4e;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex-shrink: 0;
  transition: width 0.25s ease, opacity 0.25s ease, border 0.25s;
}

.sidebar.collapsed {
  width: 0;
  opacity: 0;
  overflow: hidden;
  border-right: none;
}

.sidebar-header {
  display: flex;
  justify-content: flex-end;
  padding: 6px 10px;
}

.sidebar-toggle {
  background: none;
  border: none;
  color: #8a8a96;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar-toggle:hover { color: #c0c0c8; background: rgba(255,255,255,0.05); }

.training-guide {
  padding: 0 14px 14px;
}

.training-guide h3 {
  font-family: 'Space Grotesk', sans-serif;
  color: #f4f4f8;
  font-size: 14px;
  margin-bottom: 10px;
  letter-spacing: -0.01em;
}

.guide-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.guide-step {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
  border: 1px solid #383848;
}

.step-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  font-family: 'Space Grotesk', sans-serif;
}

.guide-step b {
  font-size: 12px;
  color: var(--accent);
  display: block;
  margin-bottom: 1px;
}

.guide-step p {
  color: #8a8a96;
  font-size: 11px;
  line-height: 1.5;
  margin: 0;
}

.guide-step code {
  background: #383848;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
  color: #fbbf24;
}

.model-section {
  padding: 6px 14px;
}

.model-section h3 {
  color: #eeeeee;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  font-weight: 700;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.model-item:hover { background: rgba(255,255,255,0.04); }

.model-item.active {
  background: rgba(75,143,247,0.12);
  border: 1px solid rgba(75,143,247,0.25);
}

.model-item.active .model-name { color: #6db0fa; }

.model-name {
  color: #eeeeee;
  font-size: 13px;
  font-family: 'DM Sans', sans-serif;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-dots {
  color: #8a8a96;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 15px;
  line-height: 1;
  transition: all 0.15s;
}

.model-dots:hover { color: #c0c0c8; background: rgba(255,255,255,0.08); }

.upload-btn {
  margin: 12px 14px;
  padding: 9px;
  background: transparent;
  border: 1px dashed #505060;
  border-radius: 8px;
  color: #8a8a96;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-btn:hover {
  color: #c0c0c8;
  border-color: #8a8a96;
  background: rgba(255,255,255,0.03);
}
</style>

<!-- 全局样式（非 scoped，用于 Teleport 到 body 的菜单） -->
<style>
.ctx-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.ctx-menu {
  background: #33333f;
  border: 1px solid #3e3e4e;
  border-radius: 8px;
  padding: 3px;
  min-width: 95px;
  box-shadow: 0 12px 30px rgba(0,0,0,0.5);
  z-index: 10000;
}

.ctx-menu .menu-item {
  padding: 7px 12px;
  color: #c0c0c8;
  font-size: 12px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s;
}

.ctx-menu .menu-item:hover { background: rgba(255,255,255,0.08); }

.ctx-menu .menu-item.danger { color: #fca5a5; }
.ctx-menu .menu-item.danger:hover { background: rgba(248,113,113,0.12); }
</style>
