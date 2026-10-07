import { router } from "expo-router";
import { useMutation } from "@tanstack/react-query";

import { useToast } from "../../components/ui";
import { chatService } from "../../services/api";
import { conversationIdOf } from "./chat";

/**
 * "Nhắn tin" with one person: find or create the direct conversation, then open it. The endpoint
 * is idempotent, so this is the same call whether the two have talked before or not.
 *
 * It exists because a conversation used to be creatable from exactly one screen (a 1-1 service
 * order): a client with an active contract had no way to write to their trainer, and the
 * trainer's own "Nhắn tin" only opened the list — empty when they had never talked (7/10).
 * Lands on the list with `conversationId`, which opens the thread on top of it, so Back returns
 * to the list like every other way into a thread.
 */
export function useOpenChat() {
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (userId: string) => chatService.createDirectConversation(userId),
    onSuccess: (reply) => {
      const conversationId = conversationIdOf(reply);
      router.push({ pathname: "/client/messages", params: conversationId ? { conversationId } : {} });
    },
    onError: (e: any) =>
      toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || "Không thể mở đoạn chat.", "danger"),
  });
  return { openChat: (userId: string) => mutation.mutate(userId), opening: mutation.isPending };
}
