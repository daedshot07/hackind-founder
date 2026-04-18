import mongoose from 'mongoose';

const memorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    content: { type: String, required: true },
    tags: [{ type: String }],
    importance: { type: Number, default: 0 },
    // A simplified vector-like storage using keywords since we're simulating Hindsight
    keywords: [{ type: String }],
  },
  { timestamps: true }
);

const Memory = mongoose.model('Memory', memorySchema);
export default Memory;
