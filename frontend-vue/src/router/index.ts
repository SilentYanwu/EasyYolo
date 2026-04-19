import { createRouter, createWebHistory } from 'vue-router'
import RecognitionView from '../views/RecognitionView.vue'
import TrainView from '../views/TrainView.vue'
import DetailsView from '../views/DetailsView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'recognition',
      component: RecognitionView
    },
    {
      path: '/train',
      name: 'train',
      component: TrainView
    },
    {
      path: '/details',
      name: 'details',
      component: DetailsView
    }
  ],
})

export default router
