import mongoose from 'mongoose';

const userProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    interests: [{ type: String }],
    skills: [{ type: String }],
    level: { type: String, default: 'Beginner' },
    personalityTraits: [{ type: String }],
    goals: [{ type: String }],
  },
  { timestamps: true }
);

const UserProfile = mongoose.model('UserProfile', userProfileSchema);
export default UserProfile;
