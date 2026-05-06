import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/servers', name: 'servers', component: () => import('../views/ServersView.vue') },
  { path: '/workshop', name: 'workshop', component: () => import('../views/WorkshopView.vue') },
  { path: '/downloads', name: 'downloads', component: () => import('../views/DownloadsView.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
  { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
