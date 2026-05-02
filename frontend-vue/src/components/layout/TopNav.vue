<script setup lang="ts">
// 顶部导航栏 — Logo + 页面切换标签 + 刷新按钮
import { useRouter, useRoute } from 'vue-router'
import { computed, ref } from 'vue'
import { useModelStore } from '@/stores/models'
import { useTrainingStore } from '@/stores/training'

const router = useRouter()
const route = useRoute()
const modelStore = useModelStore()
const trainingStore = useTrainingStore()

const spinning = ref(false)

const navItems = [
  { path: '/inference', label: 'YOLO 识别' },
  { path: '/training', label: 'YOLO 训练' },
  { path: '/details', label: '模型详情' },
]

const activeIdx = computed(() => {
  const idx = navItems.findIndex(item => route.path.startsWith(item.path))
  return idx >= 0 ? idx : 0
})

function navigate(path: string) {
  router.push(path)
}

async function refreshApp() {
  if (spinning.value) return
  spinning.value = true
  try {
    await modelStore.fetchModels()
  } finally {
    setTimeout(() => { spinning.value = false }, 600)
  }
}
</script>

<template>
  <header class="global-header">
    <div class="logo">EASY YOLO</div>
    <nav class="top-nav">
      <button
        v-for="(item, idx) in navItems"
        :key="item.path"
        :class="['top-nav-btn', { active: idx === activeIdx }]"
        @click="navigate(item.path)"
      >
        {{ item.label }}
      </button>
    </nav>
    <div class="header-spacer"></div>
    <button :class="['refresh-btn', { spinning }]" @click="refreshApp" title="刷新应用">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>
  </header>
</template>

<style scoped>
.global-header {
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 22px;
  background: #1e1e26;
  border-bottom: 1px solid #353545;
  flex-shrink: 0;
  z-index: 100;
}

.logo {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1.5px;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-right: 40px;
  white-space: nowrap;
  user-select: none;
}

.top-nav {
  display: flex;
  gap: 2px;
  background: #252530;
  border-radius: 10px;
  padding: 3px;
}

.top-nav-btn {
  padding: 6px 18px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #7c7c8a;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.top-nav-btn:hover {
  color: #b8b8c0;
  background: rgba(255, 255, 255, 0.04);
}

.top-nav-btn.active {
  color: #f0f0f5;
  background: #303040;
  box-shadow: 0 1px 2px rgba(0,0,0,0.3);
}

.header-spacer {
  flex: 1;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #7c7c8a;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.refresh-btn:hover {
  color: #b8b8c0;
  background: rgba(255, 255, 255, 0.05);
}

.refresh-btn.spinning svg {
  animation: spin 0.6s ease-in-out;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
