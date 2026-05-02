// 应用 UI Store — 当前页面、侧边栏折叠状态、详情页模型名
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useAppStore = defineStore('app', () => {
  const activePage = ref(localStorage.getItem('activePage') || 'inference')
  const sidebarCollapsed = ref(localStorage.getItem('sidebarCollapsed') === 'true')
  const detailsModelName = ref('')

  watch(activePage, (val) => localStorage.setItem('activePage', val))
  watch(sidebarCollapsed, (val) => localStorage.setItem('sidebarCollapsed', String(val)))

  function switchPage(page: string) {
    activePage.value = page
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return { activePage, sidebarCollapsed, detailsModelName, switchPage, toggleSidebar }
})
