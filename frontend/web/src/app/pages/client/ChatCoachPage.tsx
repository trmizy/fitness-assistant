import { useLocation } from "react-router";
import { Bot, MessageSquare } from "lucide-react";
import { TabbedPage } from "../../components/TabbedPage";
import { ChatPage } from "./ChatPage";
import { AICoachPage } from "./AICoachPage";

export function ChatCoachPage() {
  // Background AI-task notifications link directly to /client/ai-coach
  // expecting the AI Coach tab active, not the default Chat tab.
  const location = useLocation();
  const defaultTab = location.pathname.endsWith("/ai-coach")
    ? "ai-coach"
    : "chat";

  return (
    <TabbedPage
      defaultTab={defaultTab}
      tabs={[
        {
          value: "chat",
          label: "Chat",
          icon: MessageSquare,
          content: <ChatPage />,
        },
        {
          value: "ai-coach",
          label: "AI Coach",
          icon: Bot,
          content: <AICoachPage />,
        },
      ]}
    />
  );
}
