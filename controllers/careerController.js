import UserProfile from '../models/UserProfile.js';
import Chat from '../models/Chat.js';
import OpenAI from 'openai';

const MOCK_JOBS = [
  { id: 1, role: 'Frontend Developer', company: 'TechNova', type: 'Full-time', matchScore: 0, requiredSkills: ['React', 'JavaScript', 'Tailwind'], category: 'Tech' },
  { id: 2, role: 'AI Researcher Intern', company: 'DeepCognition', type: 'Internship', matchScore: 0, requiredSkills: ['Python', 'Machine Learning', 'PyTorch'], category: 'AI' },
  { id: 3, role: 'Business Analyst', company: 'MarketMinds', type: 'Full-time', matchScore: 0, requiredSkills: ['Data Analysis', 'Communication', 'SQL'], category: 'Business' },
  { id: 4, role: 'Backend Engineer', company: 'CloudBase', type: 'Contract', matchScore: 0, requiredSkills: ['Node.js', 'Express', 'MongoDB'], category: 'Tech' },
  { id: 5, role: 'UX/UI Designer', company: 'CreativeStudio', type: 'Full-time', matchScore: 0, requiredSkills: ['Figma', 'Prototyping', 'User Research'], category: 'Design' }
];

const getAIClient = () => {
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || "mock-key",
      baseURL: process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined,
    });
};

export const updateProfile = async (req, res) => {
  try {
    const chats = await Chat.find({ user: req.user._id }).sort({ updatedAt: -1 }).limit(10);
    const recentMessages = chats.flatMap(chat => 
        chat.messages.filter(m => m.role === 'user').map(m => m.content)
    ).slice(0, 30); // Use up to 30 recent user messages to infer profile

    const extractionPrompt = `Based on these recent user messages: ${JSON.stringify(recentMessages.slice(0, 10))}.
Extract the user's professional profile. Reply ONLY with valid JSON exactly in this format: 
{"interests": ["interest 1"], "skills": ["skill 1"], "level": "Beginner|Intermediate|Advanced", "personalityTraits": ["trait 1"], "goals": ["goal 1"]}`;

    let parsedProfile = {
        interests: ['Technology', 'AI'],
        skills: ['Communication'],
        level: 'Beginner',
        personalityTraits: ['Curious'],
        goals: ['Find an internship']
    };

    if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) {
        try {
            const ai = getAIClient();
            const extraction = await ai.chat.completions.create({
                model: process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: 'You are a career profiling bot. Valid JSON only.' },
                    { role: 'user', content: extractionPrompt }
                ],
                response_format: { type: 'json_object' }
            });
            parsedProfile = JSON.parse(extraction.choices[0].message.content);
        } catch (e) {
            console.error("AI Profiling failed, using defaults:", e.message);
        }
    }

    let profile = await UserProfile.findOne({ user: req.user._id });
    if (!profile) {
        profile = new UserProfile({ user: req.user._id, ...parsedProfile });
    } else {
        profile.interests = Array.from(new Set([...profile.interests, ...(parsedProfile.interests || [])]));
        profile.skills = Array.from(new Set([...profile.skills, ...(parsedProfile.skills || [])]));
        profile.level = parsedProfile.level || profile.level;
        profile.personalityTraits = Array.from(new Set([...profile.personalityTraits, ...(parsedProfile.personalityTraits || [])]));
        profile.goals = Array.from(new Set([...profile.goals, ...(parsedProfile.goals || [])]));
    }
    
    await profile.save();
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const recommendCareer = async (req, res) => {
    try {
        let profile = await UserProfile.findOne({ user: req.user._id });
        if (!profile) {
            return res.json([{
                role: "Undeclared",
                matchScore: 0,
                reason: "Please update your profile first to get AI recommendations.",
                skillsRequired: [],
                skillsToImprove: [],
                roadmap: []
            }]);
        }

        const prompt = `User profile: ${JSON.stringify({
            interests: profile.interests,
            skills: profile.skills,
            level: profile.level,
            goals: profile.goals
        })}. Suggest exactly ONE best matching career role for this user. Output ONLY valid JSON:
        {"role": "Title", "matchScore": 90, "reason": "Short reason", "skillsRequired": ["Skill"], "skillsToImprove": ["Skill"], "roadmap": ["Step 1", "Step 2"]}`;

        let recommendation = {
            role: "Software Developer (Fallback)",
            matchScore: 75,
            reason: "Matches general tech interest.",
            skillsRequired: ["Programming"],
            skillsToImprove: ["Algorithms"],
            roadmap: ["Learn a language", "Build projects"]
        };

        if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) {
            try {
                const ai = getAIClient();
                const response = await ai.chat.completions.create({
                    model: process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo',
                    messages: [
                        { role: 'system', content: 'You are a career counselor. Valid JSON only representing the recommendation.' },
                        { role: 'user', content: prompt }
                    ],
                    response_format: { type: 'json_object' }
                });
                recommendation = JSON.parse(response.choices[0].message.content);
            } catch (e) {
                console.error("AI Career match failed:", e.message);
            }
        }

        res.json([recommendation]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const matchJobs = async (req, res) => {
    try {
        const profile = await UserProfile.findOne({ user: req.user._id });
        const userSkillsStr = profile ? profile.skills.join(" ").toLowerCase() : "";
        const userInterestsStr = profile ? profile.interests.join(" ").toLowerCase() : "";
        
        let searchTerm = "technology";
        if (profile && (profile.skills.length > 0 || profile.interests.length > 0)) {
            searchTerm = encodeURIComponent([...profile.skills, ...profile.interests].slice(0, 3).join(" "));
        }

        const app_id = process.env.ADZUNA_APP_ID;
        const app_key = process.env.ADZUNA_APP_KEY;
        const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${app_id}&app_key=${app_key}&results_per_page=10&what=${searchTerm}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data || !data.results) {
            return res.json([]);
        }

        let rankedJobs = data.results.map(job => {
            let score = 50; 
            const jobDesc = (job.description || "").toLowerCase();
            const jobTitle = (job.title || "").toLowerCase();
            
            if (profile) {
                for(let skill of profile.skills) {
                    if (jobDesc.includes(skill.toLowerCase()) || jobTitle.includes(skill.toLowerCase())) score += 15;
                }
                for(let interest of profile.interests) {
                    if (job.category.label.toLowerCase().includes(interest.toLowerCase())) score += 20;
                }
            }
            return { 
                id: job.id, 
                role: job.title.replace(/<\/?[^>]+(>|$)/g, ""), 
                company: job.company.display_name, 
                type: job.contract_time === 'contract' ? 'Contract' : (job.contract_time === 'part_time' ? 'Part-time' : 'Full-time'), 
                matchScore: Math.min(score, 99), 
                requiredSkills: [job.category.label], 
                category: job.category.label,
                url: job.redirect_url
            };
        }).sort((a, b) => b.matchScore - a.matchScore);

        res.json(rankedJobs);
    } catch (error) {
        console.error("Adzuna API Error:", error.message);
        res.status(500).json({ message: "Failed to fetch jobs" });
    }
};
