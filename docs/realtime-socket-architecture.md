# Realtime Socket.IO Architecture

The app now has a gateway-owned Socket.IO entry point for authenticated realtime events.
REST APIs remain the source of truth for persistence.

## Entry Point

- Gateway Socket.IO URL: `VITE_SOCKET_URL`, default `http://localhost:3000`
- Legacy voice/video call signaling URL: `VITE_CHAT_WS_URL`, default `http://localhost:3005`
- Auth: frontend sends the existing JWT in `socket.handshake.auth.token`
- Gateway verifies the token through `auth-service` before accepting the socket

The legacy chat-service socket remains for call signaling only. Chat messages,
notifications, AI job updates, dashboard updates, and presence use the gateway socket.

## Server Events

- `notification:new`
- `chat:message:new`
- `chat:new_message` legacy compatibility
- `chat:conversation_updated` legacy compatibility
- `chat:typing`
- `chat:error`
- `ai:coach:chunk`
- `ai:coach:done`
- `ai:coach:error`
- `ai:plan:job:created`
- `ai:plan:job:progress`
- `ai:plan:job:completed`
- `ai:plan:job:failed`
- `dashboard:metrics:update`
- `user:presence:update`

## Client Events

- `chat:join_conversation`
- `chat:leave_conversation`
- `chat:message:send`
- `chat:send_message` legacy compatibility
- `chat:typing`
- `ai:plan:subscribe`
- `ai:plan:unsubscribe`
- `dashboard:subscribe`
- `dashboard:unsubscribe`

## Rooms

- `user:{userId}` for direct notifications
- `role:{role}` for role scoped events
- `chat:{conversationId}` for chat messages
- `ai-job:{jobId}` for plan job progress
- `dashboard:{scope}` for dashboard metrics

Chat room joins are verified against chat-service with the user's JWT before the
socket is allowed into the room.

## Manual QA

1. Start the stack and open the web app.
2. Log in as two users that share a chat conversation.
3. Open the same conversation in two browser sessions.
4. Send a message from user A.
5. Verify user B sees the message without refreshing.
6. Refresh both browsers and verify the message persists through the REST API.
7. Create or update a notification from backend code and emit it with
   `emitToUser(userId, "notification:new", payload)`.
8. Verify the notification bell updates without a page reload.
9. Subscribe to an AI job with `useAiJobProgress({ jobId })`.
10. Emit progress to `ai-job:{jobId}` and verify the UI cache updates.

