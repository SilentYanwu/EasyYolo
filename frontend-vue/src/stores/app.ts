// 应用 UI Store — 当前页面、侧边栏折叠状态、详情页模型名
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useAppStore = defineStore('app', () => {
  const activePage = ref(localStorage.getItem('activePage') || 'inference')
  const sidebarCollapsed = ref(localStorage.getItem('sidebarCollapsed') === 'true')
  const detailsModelName = ref('')

  // 页面切换时自动持久化到 localStorage
  watch(activePage, (val) => localStorage.setItem('activePage', val))
  watch(sidebarCollapsed, (val) => localStorage.setItem('sidebarCollapsed', String(val)))

  // 切换到指定页面（更新 activePage，触发 TopNav 高亮和 router-view 渲染）
  function switchPage(page: string) {
    activePage.value = page
  }

  // 展开/折叠侧边栏（状态持久化到 localStorage）
  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return { activePage, sidebarCollapsed, detailsModelName, switchPage, toggleSidebar }
})
