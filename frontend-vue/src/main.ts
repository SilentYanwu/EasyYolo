import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'

import App from './App.vue'
import './styles/style.css'

/**
 * 应用入口：
 * 1. 挂载 Element Plus（中文语言包）
 * 2. 注入全局样式（保持和原 GUI 观感一致）
 */
const app = createApp(App)

app.use(ElementPlus, {
  locale: zhCn,
})

app.mount('#app')
