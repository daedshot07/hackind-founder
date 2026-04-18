import UserProfile from '../models/UserProfile.js';
import OpenAI from 'openai';

const MOCK_NEWS = [
    { id: 1, title: 'AI Startups Secure Record Funding in Q3', category: 'AI', content: 'Venture capitalists are doubling down on generative AI...', date: new Date() },
    { id: 2, title: 'React 19 RC Released: What to Expect', category: 'Technology', content: 'The new release brings a compiler and improved hooks...', date: new Date() },
    { id: 3, title: 'Global Tech Stocks Rally Ahead of Earnings', category: 'Business', content: 'Markets showed resilience as major tech companies prepare to report...', date: new Date() },
    { id: 4, title: 'New Cybersecurity Regulations for Tech Vendors', category: 'World', content: 'Governments are rolling out strict compliance requirements...', date: new Date() },
    { id: 5, title: 'How Y-Combinator is Shaping the Next Generation', category: 'Startups', content: 'Trends from the latest YC batch show a shift toward applied AI...', date: new Date() }
];

const getAIClient = () => {
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "mock-key",
      baseURL: process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined,
    });
};

export const getNews = async (req, res) => {
    try {
        const profile = await UserProfile.findOne({ user: req.user._id });
        const userInterestsStr = profile ? profile.interests.join(" ").toLowerCase() : "general";

        // Sort news putting matched categories first
        let rankedNews = [...MOCK_NEWS].sort((a, b) => {
             let aMatch = userInterestsStr.includes(a.category.toLowerCase()) ? 1 : 0;
             let bMatch = userInterestsStr.includes(b.category.toLowerCase()) ? 1 : 0;
             return bMatch - aMatch;
        });

        // AI Summarization
        if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) {
            try {
                const ai = getAIClient();
                const newsContext = rankedNews.map(n => n.title).join("; ");
                const prompt = `User interests: ${userInterestsStr}. News items: ${newsContext}. For each news title, provide a 1-sentence personalized 'why this matters to you' summary based on their interests. Output valid JSON: {"insights": [{"id": news_id_from_context, "summary": "Personalized insight"}]}`;
                
                // We'll just ask for a generic prompt because IDs are tricky. Let's do it simpler.
                const simplerPrompt = `User interests: ${userInterestsStr}. Provide a 1-sentence 'why this matters' insight for this article: "${rankedNews[0].title}". Return JSON: {"summary": "text"}`;
                
                // For speed, let's just do it for the top 1 or 2 news items
                for(let i = 0; i < Math.min(2, rankedNews.length); i++) {
                    const response = await ai.chat.completions.create({
                        model: process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo',
                        messages: [
                            { role: 'system', content: 'You are a news summarizer.' },
                            { role: 'user', content: `User interests: ${userInterestsStr}. Provide a short 'why this matters' for article: "${rankedNews[i].title}". Return JSON: {"summary": "text"}` }
                        ],
                        response_format: { type: 'json_object' }
                    });
                    const parsed = JSON.parse(response.choices[0].message.content);
                    rankedNews[i].aiInsight = parsed.summary || '';
                }
            } catch (e) {
                console.error("News AI summarization failed:", e.message);
            }
        }

        res.json(rankedNews);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
