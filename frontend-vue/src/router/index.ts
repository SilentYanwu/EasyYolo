// Vue Router 配置 — 三个主页面：推理 / 训练 / 模型详情
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/inference'
    },
    {
      path: '/inference',
      name: 'inference',
      component: () => import('@/views/InferenceView.vue')
    },
    {
      path: '/training',
      name: 'training',
      component: () => import('@/views/TrainingView.vue')
    },
    {
      path: '/details/:modelName?',
      name: 'details',
      component: () => import('@/views/DetailsView.vue')
    }
  ],
})

export default router
