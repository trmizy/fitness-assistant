import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const healthCheck = async () => {
  const response = await api.get('/health')
  return response.data
}

export const askQuestion = async (question: string) => {
  const response = await api.post('/ask', { question })
  return response.data
}

export const getConversations = async (limit = 10) => {
  const response = await api.get(`/conversations?limit=${limit}`)
  return response.data
}

export const sendFeedback = async (conversationId: string, feedback: 1 | -1) => {
  const response = await api.post('/feedback', {
    conversation_id: conversationId,
    feedback,
  })
  return response.data
}

export const getFeedbackStats = async () => {
  const response = await api.get('/feedback/stats')
  return response.data
}
