import OpenAI from 'openai';

export const simulateOutcome = async (req, res) => {
  const { scenario } = req.body;
  if (!scenario) return res.status(400).json({ message: "Scenario is required." });

  try {
    const aiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
    if (!aiKey) return res.status(500).json({ message: "Missing AI Engine Keys." });

    const client = new OpenAI({
      apiKey: aiKey,
      baseURL: process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined,
    });

    const systemPrompt = `You are a sophisticated Decision AI and Outcome Simulator. 
The user provides a scenario, action, or decision. 
You must accurately project the 3 most realistic alternate timelines/outcomes: 
1. Best Case Scenario
2. Most Likely Scenario
3. Worst Case Scenario

You MUST return EXACTLY this JSON structure and absolutely strictly NOTHING ELSE:
{
  "best_case": {
    "title": "Short title",
    "description": "2-3 sentences explaining what happens.",
    "probability": 25,
    "icon": "TrendingUp"
  },
  "most_likely": {
    "title": "Short title",
    "description": "2-3 sentences explaining what happens.",
    "probability": 65,
    "icon": "Activity"
  },
  "worst_case": {
    "title": "Short title",
    "description": "2-3 sentences explaining what happens.",
    "probability": 10,
    "icon": "TrendingDown"
  }
}

The probabilities MUST add up to 100. Be brutally honest and realistic.`;

    const completion = await client.chat.completions.create({
      model: process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Simulate outcome for: "${scenario}"` }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json(result);

  } catch (error) {
    console.error("Simulation failed:", error);
    res.status(500).json({ message: "Simulation computation failed via Brain Circuit." });
  }
};
