import { useState, useEffect } from 'react'
import { Loader2, ThumbsUp, ThumbsDown, MessageSquare, DollarSign } from 'lucide-react'
import { getFeedbackStats, getConversations } from '../services/api'

interface Stats {
  thumbs_up: number
  thumbs_down: number
  totalConversations: number
  totalCost: number
  totalTokens: number
}

const Analytics = () => {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      const [feedbackData, conversationsData] = await Promise.all([
        getFeedbackStats(),
        getConversations(1000),
      ])

      const totalCost = conversationsData.conversations.reduce(
        (sum: number, conv: any) => sum + conv.openai_cost,
        0
      )
      const totalTokens = conversationsData.conversations.reduce(
        (sum: number, conv: any) => sum + conv.total_tokens,
        0
      )

      setStats({
        thumbs_up: feedbackData.thumbs_up,
        thumbs_down: feedbackData.thumbs_down,
        totalConversations: conversationsData.conversations.length,
        totalCost,
        totalTokens,
      })
    } catch (error) {
      console.error('Failed to load stats:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gym-accent" />
      </div>
    )
  }

  if (!stats) {
    return <div className="text-center text-gray-500">Failed to load analytics</div>
  }

  const totalFeedback = stats.thumbs_up + stats.thumbs_down
  const satisfactionRate = totalFeedback > 0 
    ? ((stats.thumbs_up / totalFeedback) * 100).toFixed(1) 
    : '0'

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Analytics Dashboard</h1>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={<MessageSquare className="w-8 h-8" />}
          title="Total Conversations"
          value={stats.totalConversations.toString()}
          color="blue"
        />
        <StatCard
          icon={<ThumbsUp className="w-8 h-8" />}
          title="Positive Feedback"
          value={stats.thumbs_up.toString()}
          color="green"
        />
        <StatCard
          icon={<ThumbsDown className="w-8 h-8" />}
          title="Negative Feedback"
          value={stats.thumbs_down.toString()}
          color="red"
        />
        <StatCard
          icon={<DollarSign className="w-8 h-8" />}
          title="Total Cost"
          value={`$${stats.totalCost.toFixed(2)}`}
          color="yellow"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-gym-card border border-gym-border rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Satisfaction Rate</h3>
          <div className="flex items-center justify-center">
            <div className="text-6xl font-bold text-gym-accent">
              {satisfactionRate}%
            </div>
          </div>
          <p className="text-center text-gray-400 mt-2">
            Based on {totalFeedback} feedback responses
          </p>
        </div>

        <div className="bg-gym-card border border-gym-border rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Token Usage</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">Total Tokens:</span>
              <span className="font-semibold">{stats.totalTokens.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Avg per Conversation:</span>
              <span className="font-semibold">
                {stats.totalConversations > 0
                  ? Math.round(stats.totalTokens / stats.totalConversations)
                  : 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Avg Cost per Chat:</span>
              <span className="font-semibold">
                $
                {stats.totalConversations > 0
                  ? (stats.totalCost / stats.totalConversations).toFixed(4)
                  : '0.0000'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface StatCardProps {
  icon: React.ReactNode
  title: string
  value: string
  color: 'blue' | 'green' | 'red' | 'yellow'
}

const StatCard = ({ icon, title, value, color }: StatCardProps) => {
  const colorClasses = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
  }

  return (
    <div className="bg-gym-card border border-gym-border rounded-lg p-6">
      <div className={`${colorClasses[color]} mb-4`}>{icon}</div>
      <h3 className="text-gray-400 text-sm mb-2">{title}</h3>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  )
}

export default Analytics
