import { Link } from 'react-router-dom'
import { ArrowRight, Dumbbell, Brain, TrendingUp } from 'lucide-react'

const Home = () => {
  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <div className="text-center space-y-8 py-12">
        <h1 className="text-6xl font-bold bg-gradient-to-r from-gym-accent via-purple-400 to-gym-accent-red bg-clip-text text-transparent">
          Your AI Fitness Coach
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto">
          Get personalized workout advice, nutrition tips, and fitness guidance powered by advanced AI technology.
        </p>
        <Link
          to="/assistant"
          className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-gym-accent to-gym-accent-red text-white font-semibold rounded-lg hover:opacity-90 transition-opacity"
        >
          Start Your Journey
          <ArrowRight className="ml-2 w-5 h-5" />
        </Link>
      </div>

      {/* Features */}
      <div className="grid md:grid-cols-3 gap-8">
        <FeatureCard
          icon={<Dumbbell className="w-8 h-8" />}
          title="Personalized Workouts"
          description="Get custom workout plans tailored to your goals and fitness level."
        />
        <FeatureCard
          icon={<Brain className="w-8 h-8" />}
          title="Smart AI Assistant"
          description="Ask anything about fitness, nutrition, and health - get instant expert answers."
        />
        <FeatureCard
          icon={<TrendingUp className="w-8 h-8" />}
          title="Track Progress"
          description="Monitor your conversations and see how your fitness knowledge grows."
        />
      </div>
    </div>
  )
}

interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
}

const FeatureCard = ({ icon, title, description }: FeatureCardProps) => (
  <div className="bg-gym-card border border-gym-border rounded-lg p-6 hover:border-gym-accent transition-colors">
    <div className="text-gym-accent mb-4">{icon}</div>
    <h3 className="text-xl font-semibold mb-2">{title}</h3>
    <p className="text-gray-400">{description}</p>
  </div>
)

export default Home
