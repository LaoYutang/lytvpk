import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'

// Global styles
import './styles/variables.css'
import './styles/dark-mode.css'
import './styles/base.css'
import './styles/scrollbar.css'
import './styles/animations.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
