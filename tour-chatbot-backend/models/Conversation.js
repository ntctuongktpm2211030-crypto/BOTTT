// models/Conversation.js
import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
  },
  { _id: false, timestamps: true }
);

const ConversationSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true }, // FE lưu trong localStorage
    title: { type: String, default: "" },
    messages: [MessageSchema],
  },
  { timestamps: true }
);

export const Conversation = mongoose.model("Conversation", ConversationSchema);
