import Memory from '../models/Memory.js';

// Get all memories
export const getMemories = async (req, res) => {
  try {
    const memories = await Memory.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(memories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Add memory manually (or used internally by Chat)
export const addMemory = async (req, res) => {
  try {
    const { content, keywords, importance } = req.body;
    const memory = await Memory.create({
      user: req.user._id,
      content,
      keywords: keywords || [],
      importance: importance || 1,
    });
    res.status(201).json(memory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete a memory
export const deleteMemory = async (req, res) => {
  try {
    const memory = await Memory.findById(req.params.id);
    if (!memory) return res.status(404).json({ message: 'Memory not found' });
    
    if (memory.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: 'User not authorized' });
    }

    await memory.deleteOne();
    res.json({ message: 'Memory removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Simulated Hindsight retrieval function (used internally by chat controller)
export const retrieveRelevantMemory = async (userId, query) => {
  const queryWords = query.toLowerCase().split(/\s+/);
  // Find memories for this user
  const memories = await Memory.find({ user: userId });
  
  // Calculate a basic tf-idf / keyword overlap score
  const scoredMemories = memories.map(m => {
    let score = 0;
    const memWords = m.content.toLowerCase().split(/\s+/);
    queryWords.forEach(word => {
      if (memWords.includes(word) || m.keywords.includes(word)) {
        score++;
      }
    });
    return { memory: m, score };
  });

  // Sort by score and filter out low relevance
  scoredMemories.sort((a, b) => b.score - a.score);
  return scoredMemories.filter(m => m.score > 0).slice(0, 3).map(m => m.memory.content);
};
