-- Chat drafts are now kept client-side until the first non-empty user message.
-- Remove legacy rows that never acquired a message; their absence has no
-- impact on audit history because no chat content was persisted in them.
DELETE FROM "Conversation" AS conversation
WHERE NOT EXISTS (
  SELECT 1
  FROM "ConversationMessage" AS message
  WHERE message."conversationId" = conversation."id"
);
