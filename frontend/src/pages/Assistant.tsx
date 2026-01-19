import { useState } from 'react'
import { Send, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { askQuestion, sendFeedback } from '../services/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  conversationId?: string
  metadata?: any
}

const Assistant = () => {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await askQuestion(input)
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.answer,
        conversationId: response.conversation_id,
        metadata: {
          modelUsed: response.model_used,
          responseTime: response.response_time,
          relevance: response.relevance,
          tokens: response.total_tokens,
          cost: response.openai_cost,
        },
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      toast.error('Failed to get response. Please try again.')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleFeedback = async (conversationId: string, feedback: 1 | -1) => {
    try {
      await sendFeedback(conversationId, feedback)
      toast.success('Feedback submitted!')
    } catch (error) {
      toast.error('Failed to submit feedback')
      console.error(error)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-gym-card border border-gym-border rounded-lg shadow-xl">
        {/* Header */}
        <div className="p-4 border-b border-gym-border">
          <h2 className="text-2xl font-bold">Fitness Assistant</h2>
          <p className="text-gray-400 text-sm">Ask me anything about fitness, nutrition, or health!</p>
        </div>

        {/* Messages */}
        <div className="h-[500px] overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-500 mt-20">
              <p>Start a conversation by asking a question!</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-4 ${
                  message.role === 'user'
                    ? 'bg-gym-accent text-gym-dark'
                    : 'bg-gym-border text-white'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.metadata && (
                  <div className="mt-2 pt-2 border-t border-gym-dark/20 text-xs opacity-70">
                    <p>Model: {message.metadata.modelUsed} | Time: {message.metadata.responseTime}s</p>
                  </div>
                )}
                {message.conversationId && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleFeedback(message.conversationId!, 1)}
                      className="p-1 hover:bg-gym-dark/20 rounded"
                    >
                      <ThumbsUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleFeedback(message.conversationId!, -1)}
                      className="p-1 hover:bg-gym-dark/20 rounded"
                    >
                      <ThumbsDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gym-border text-white rounded-lg p-4">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-gym-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about workouts, nutrition, exercises..."
              className="flex-1 bg-gym-dark border border-gym-border rounded-lg px-4 py-2 focus:outline-none focus:border-gym-accent"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-gym-accent text-gym-dark px-6 py-2 rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Assistant
