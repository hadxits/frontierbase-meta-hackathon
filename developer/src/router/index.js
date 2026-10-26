import { createRouter, createWebHistory } from 'vue-router'
import DocsLayout from '@/components/DocsLayout.vue'

const routes = [
  {
    path: '/',
    component: DocsLayout,
    children: [
      { path: '', name: 'home', component: () => import('@/views/Home.vue'), meta: { title: 'Welcome' } },
      { path: 'session', name: 'session', component: () => import('@/views/Session.vue'), meta: { title: 'Session API' } },
      { path: 'chat', name: 'chat', component: () => import('@/views/Chat.vue'), meta: { title: 'Chat API' } },
      { path: 'messages', name: 'messages', component: () => import('@/views/Messages.vue'), meta: { title: 'Messages API' } },
      { path: 'frontend-example', name: 'frontend-example', component: () => import('@/views/FrontendExample.vue'), meta: { title: 'Frontend Examples' } },
      { path: 'frontend-example/session', name: 'frontend-example-session', component: () => import('@/views/FrontendExampleSession.vue'), meta: { title: 'Example: Session' } },
      { path: 'frontend-example/chat', name: 'frontend-example-chat', component: () => import('@/views/FrontendExampleChat.vue'), meta: { title: 'Example: Chat (SSE)' } },
      { path: 'frontend-example/messages', name: 'frontend-example-messages', component: () => import('@/views/FrontendExampleMessages.vue'), meta: { title: 'Example: Messages' } },
      { path: 'frontend-example/integrated', name: 'frontend-example-integrated', component: () => import('@/views/FrontendExampleIntegrated.vue'), meta: { title: 'Example: Integrated' } },
      { path: 'chatbot', name: 'chatbot', component: () => import('@/views/ChatbotGuide.vue'), meta: { title: 'Chatbot' } },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue'), meta: { title: 'Page Not Found' } },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { left: 0, top: 0 }
  },
})

export default router
