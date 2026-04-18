import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    title: { type: String, default: 'New Conversation' },
    messages: [
      {
        role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
        content: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        attachment: {
          type: { type: String }, // e.g., 'image' or 'pdf'
          url: { type: String },
          name: { type: String }
        },
        emotion: {
          label: { type: String },
          score: { type: Number },
          confidence: { type: Number }
        }
      },
    ],
  },
  { timestamps: true }
);

const Chat = mongoose.model('Chat', chatSchema);
export default Chat;
