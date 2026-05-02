<script setup lang="ts">
// 根组件 — 启动时拉取模型列表、初始化训练状态和轮询
import { onMounted } from 'vue'
import TopNav from '@/components/layout/TopNav.vue'
import { useModelStore } from '@/stores/models'
import { useTrainingStore } from '@/stores/training'

const modelStore = useModelStore()
const trainingStore = useTrainingStore()

// 初始化
onMounted(async () => {
  await modelStore.fetchModels()
  trainingStore.initFromStorage()
  trainingStore.startPoller()
})
</script>

<template>
  <div class="app-shell">
    <TopNav />
    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<style>
/* === Google Fonts === */
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

/* === 轻奢灰调色盘 === */
:root {
  /* 层级背景 */
  --app-bg: #22222b;
  --app-sidebar-bg: #24242d;
  --app-card-bg: #2c2c37;
  --app-card-inner-bg: #22222c;
  --app-overlay-bg: #33333f;
  --app-input-bg: #262630;

  /* 边框 */
  --app-border: #3e3e4e;
  --app-border-light: #383848;
  --app-border-hover: #505060;

  /* 文字 */
  --app-text-primary: #eeeeee;
  --app-text-heading: #f4f4f8;
  --app-text-secondary: #c0c0c8;
  --app-text-muted: #8a8a96;

  /* 品牌色 */
  --app-accent: #4b8ff7;
  --app-accent-text: #6db0fa;
  --app-success: #10b981;
  --app-success-text: #4adea0;
  --app-danger: #dc2626;

  /* Element Plus 暗色主题变量 */
  --el-bg-color: #22222b;
  --el-bg-color-overlay: #33333f;
  --el-border-color: #3e3e4e;
  --el-border-color-light: #3e3e4e;
  --el-text-color-primary: #eeeeee;
  --el-text-color-regular: #c0c0c8;
  --el-color-primary: #4b8ff7;
  --el-color-primary-light-3: #3b82f6;
  --el-color-primary-light-5: #3b82f6;
  --el-color-primary-light-7: #2563eb;
  --el-color-primary-light-9: #1e3a5f;
  --el-fill-color: #33333f;
  --el-fill-color-blank: #262630;
  --el-fill-color-light: #383848;
  --el-input-bg-color: #262630;
  --el-input-border-color: #3e3e4e;
}

/* === 全局基础 === */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

body {
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #22222b;
  color: #eeeeee;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4, h5, h6 {
  font-family: 'Space Grotesk', 'DM Sans', sans-serif;
  letter-spacing: -0.02em;
}

/* === 滚动条 === */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #3e3e4e; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #505060; }

/* === Element Plus 暗色主题覆盖 === */

.el-dialog {
  --el-dialog-bg-color: #33333f;
  --el-dialog-border-color: #3e3e4e;
  background: #33333f !important;
  border: 1px solid #3e3e4e !important;
  border-radius: 14px !important;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5) !important;
}

.el-dialog__header { border-bottom: 1px solid #3e3e4e; padding: 18px 22px; }
.el-dialog__title { color: #f4f4f8; font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; }
.el-dialog__body { color: #c0c0c8; padding: 20px 22px; }
.el-dialog__footer { border-top: 1px solid #3e3e4e; padding: 14px 22px; }

.el-button {
  --el-button-bg-color: #383848;
  --el-button-border-color: #505060;
  --el-button-text-color: #c0c0c8;
  --el-button-hover-bg-color: #505060;
  --el-button-hover-border-color: #8a8a96;
  font-family: 'DM Sans', sans-serif;
  font-weight: 500;
  border-radius: 8px;
}

.el-button--primary {
  --el-button-bg-color: #4b8ff7;
  --el-button-border-color: #4b8ff7;
  --el-button-text-color: #fff;
  --el-button-hover-bg-color: #3b82f6;
  --el-button-hover-border-color: #3b82f6;
}

.el-button--success {
  --el-button-bg-color: #10b981;
  --el-button-border-color: #10b981;
  --el-button-hover-bg-color: #059669;
  --el-button-hover-border-color: #059669;
}

.el-button--danger {
  --el-button-hover-bg-color: #dc2626;
  --el-button-hover-border-color: #dc2626;
}

.el-input__wrapper {
  background: #262630 !important;
  border-color: #3e3e4e !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}

.el-input__inner { color: #eeeeee !important; }
.el-input__inner::placeholder { color: #8a8a96 !important; }

.el-select .el-input__wrapper { background: #262630 !important; }
.el-select-dropdown { background: #33333f !important; border: 1px solid #3e3e4e !important; }
.el-select-dropdown__item { color: #c0c0c8 !important; }
.el-select-dropdown__item.selected { color: #4b8ff7 !important; }
.el-select-dropdown__item:hover { background: #383848 !important; }

.el-switch__label { color: #c0c0c8 !important; }

.el-input-number .el-input__wrapper { background: #262630 !important; }

.el-upload { --el-upload-dragger-bg-color: #262630; }

.el-message {
  --el-message-bg-color: #383848 !important;
  --el-message-text-color: #eeeeee !important;
  --el-message-border-color: #505060 !important;
}

/* === 页面过渡 === */
.page-fade-enter-active,
.page-fade-leave-active { transition: opacity 0.25s ease; }
.page-fade-enter-from,
.page-fade-leave-to { opacity: 0; }
</style>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: #22222b;
}

.app-main {
  flex: 1;
  overflow: hidden;
  display: flex;
}
</style>
