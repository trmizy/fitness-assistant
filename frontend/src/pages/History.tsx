import { useState, useEffect } from 'react'
import { Loader2, ThumbsUp, ThumbsDown, AlertCircle } from 'lucide-react'
import { getConversations } from '../services/api'

interface Conversation {
  id: number
  conversation_id: string
  question: string
  answer: string
  model_used: string
  response_time: number
  relevance: string
  total_tokens: number
  openai_cost: number
  timestamp: string
  feedback: number | null
}

const History = () => {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    loadConversations()
  }, [])

  const loadConversations = async () => {
    try {
      const data = await getConversations(50)
      setConversations(data.conversations)
    } catch (error) {
      console.error('Failed to load conversations:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredConversations = conversations.filter(conv => {
    if (filter === 'all') return true
    if (filter === 'relevant') return conv.relevance === 'RELEVANT'
    if (filter === 'non-relevant') return conv.relevance === 'NON_RELEVANT'
    return true
  })

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gym-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Conversation History</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-gym-card border border-gym-border rounded-lg px-4 py-2 focus:outline-none focus:border-gym-accent"
        >
          <option value="all">All Conversations</option>
          <option value="relevant">Relevant Only</option>
          <option value="non-relevant">Non-Relevant Only</option>
        </select>
      </div>

      <div className="space-y-4">
        {filteredConversations.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No conversations found</p>
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <div key={conv.id} className="bg-gym-card border border-gym-border rounded-lg p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-2">{conv.question}</h3>
                  <p className="text-gray-400 text-sm line-clamp-3">{conv.answer}</p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {conv.feedback === 1 && <ThumbsUp className="w-5 h-5 text-green-500" />}
                  {conv.feedback === -1 && <ThumbsDown className="w-5 h-5 text-red-500" />}
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                <span className={`px-2 py-1 rounded ${
                  conv.relevance === 'RELEVANT' 
                    ? 'bg-green-500/20 text-green-400' 
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {conv.relevance}
                </span>
                <span>Model: {conv.model_used}</span>
                <span>Time: {conv.response_time}s</span>
                <span>Tokens: {conv.total_tokens}</span>
                <span>Cost: ${conv.openai_cost.toFixed(4)}</span>
                <span>{new Date(conv.timestamp).toLocaleString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default History
