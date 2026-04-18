import Chat from '../models/Chat.js';
import Memory from '../models/Memory.js';
import { retrieveRelevantMemory } from './memoryController.js';
import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');



// Get chat history for user
export const getChats = async (req, res) => {
  try {
    const chats = await Chat.find({ user: req.user._id }).sort({ updatedAt: -1 });
    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Start a new chat or continue existing and send message
export const sendMessage = async (req, res) => {
  let { chatId, message } = req.body;
  try {
    let chat;
    if (chatId) {
      chat = await Chat.findById(chatId);
      if (chat.user.toString() !== req.user._id.toString()) return res.status(401).json({ message: 'Not authorized' });
    } else {
      chat = await Chat.create({ user: req.user._id, messages: [] });
    }

    let attachmentData = null;
    let isVision = false;
    let base64Image = null;
    let pdfText = '';

    if (req.file) {
       attachmentData = {
          type: req.file.mimetype.startsWith('image/') ? 'image' : 'pdf',
          url: `http://localhost:5001/uploads/${req.file.filename}`,
          name: req.file.originalname
       };

       if (req.file.mimetype === 'application/pdf') {
         const pdfBuffer = fs.readFileSync(req.file.path);
         const data = await pdfParse(pdfBuffer);
         pdfText = data.text;
         message = `${message || 'Read this document.'}\n\n[EXTRACTED PDF DOCUMENT]:\n${pdfText}\n[/END PDF]`;
       } else if (req.file.mimetype.startsWith('image/')) {
         isVision = true;
         const imgBuffer = fs.readFileSync(req.file.path);
         base64Image = `data:${req.file.mimetype};base64,${imgBuffer.toString('base64')}`;
       }
    }

    const relevantMemories = await retrieveRelevantMemory(req.user._id, message || 'Look at this file.');
    let systemPrompt = "You are a helpful AI Memory Agent that remembers past conversations using a simulated Hindsight system. If past context is provided, use it organically without sounding robotic.";

    if (relevantMemories.length > 0) {
      systemPrompt += `\n\n[HINDSIGHT MEMORY CONTEXT]\n${relevantMemories.join('\n')}\n[/HINDSIGHT MEMORY]`;
    }

    let userMessagePayload = message || 'Look at this file.';
    if (isVision) {
      userMessagePayload = [
         { type: "text", text: message || "Analyze this image." },
         { type: "image_url", image_url: { url: base64Image } }
      ];
    }

    const messagesForAI = [
      { role: 'system', content: systemPrompt },
      ...chat.messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessagePayload }
    ];

    let aiResponseText = "";
    let emotionData = { label: 'neutral', confidence: 1.0, score: 0 };

    if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) {
      const dynamicOpenai = new OpenAI({
        apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY,
        baseURL: process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined,
      });

      const sentimentPromise = process.env.GROQ_API_KEY && !isVision ? (async () => {
        try {
          const sentimentPrompt = `Analyze the emotional tone of this message: "${message}". Return JSON exactly: {"emotion": one of [happy, sad, angry, neutral, excited, anxious], "confidence": number between 0 and 1, "score": number where happy=+2, excited=+3, neutral=0, anxious=-1, sad=-2, angry=-3}`;
          const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
          const res = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'system', content: 'You are an emotion analyzer. Return ONLY JSON.' }, { role: 'user', content: sentimentPrompt }],
            response_format: { type: 'json_object' }
          });
          return JSON.parse(res.choices[0].message.content);
        } catch(e) {
          return { emotion: 'neutral', confidence: 0, score: 0 };
        }
      })() : Promise.resolve({ emotion: 'neutral', confidence: 1.0, score: 0 });

      const targetModel = isVision 
        ? (process.env.GROQ_API_KEY ? 'llama-3.2-11b-vision-preview' : 'gpt-4o-mini') 
        : (process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo');

      const completionPromise = dynamicOpenai.chat.completions.create({
        model: targetModel,
        messages: messagesForAI,
      });

      const [completion, sentimentResult] = await Promise.all([completionPromise, sentimentPromise]);
      aiResponseText = completion.choices[0].message.content;
      if (sentimentResult && sentimentResult.emotion && typeof sentimentResult.emotion === 'string') {
         emotionData = { label: sentimentResult.emotion.toLowerCase(), confidence: sentimentResult.confidence || 1.0, score: sentimentResult.score || 0 };
      }
    } else {
      aiResponseText = `[Simulated] I see you sent a message.`;
    }

    // Save attachment subschema into mongo
    const chatUserPayload = { role: 'user', content: message || (isVision ? 'Attached Image' : 'Attached File'), emotion: emotionData };
    if (attachmentData) chatUserPayload.attachment = attachmentData;
    
    chat.messages.push(chatUserPayload);
    chat.messages.push({ role: 'assistant', content: aiResponseText });
    await chat.save();

    // Step 3: LEARNING SYSTEM (Auto-Save potential memory)
    // Asynchronously evaluate the message using AI to extract high-value memories
    if (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY) {
      Promise.resolve().then(async () => {
        try {
          const dynamicOpenai = new OpenAI({
            apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY,
            baseURL: process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined,
          });

          const extractionPrompt = `Analyze this user message: "${message}". Does it contain personal facts, preferences, or useful context worth remembering about them? If YES, respond with exactly this JSON format: {"is_memory": true, "content": "Concise stated fact to remember", "keywords": ["keyword1", "keyword2"]}. If NO, respond with exactly: {"is_memory": false}. Do not include any other text except the JSON.`;

          const extraction = await dynamicOpenai.chat.completions.create({
            model: process.env.GROQ_API_KEY ? 'llama-3.1-8b-instant' : 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are a data extraction bot. Always reply in valid JSON.' },
              { role: 'user', content: extractionPrompt }
            ],
            response_format: { type: 'json_object' }
          });
          
          const resultText = extraction.choices[0].message.content;
          const result = JSON.parse(resultText);
          
          if (result && result.is_memory) {
            await Memory.create({
              user: req.user._id,
              content: result.content,
              keywords: result.keywords || [],
              importance: 1
            });
            console.log("AI Memory Auto-Saved:", result.content);
          }
        } catch (e) {
          console.error("AI Memory extraction failed in background:", e.message);
        }
      });
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const sendVoiceMessage = async (req, res) => {
  const { chatId } = req.body;
  if (!req.file) return res.status(400).json({ message: "No audio file provided" });

  try {
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!groqKey || !openaiKey) return res.status(500).json({message: "Missing API keys for voice processing"});

    const groqClient = new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' });
    const file = await toFile(req.file.buffer, "audio.webm");
    
    // Step 1: STT (Whisper)
    const transcription = await groqClient.audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
    });
    const message = transcription.text;
    
    let chat;
    if (chatId) {
      chat = await Chat.findById(chatId);
      if (chat.user.toString() !== req.user._id.toString()) return res.status(401).json({ message: 'Not authorized' });
    } else {
      chat = await Chat.create({ user: req.user._id, messages: [] });
    }

    // chat.messages.push({ role: 'user', content: message }); // Remove early push

    const relevantMemories = await retrieveRelevantMemory(req.user._id, message);
    let systemPrompt = "You are a helpful AI Memory Agent that remembers past conversations using a simulated Hindsight system. If past context is provided, use it organically without sounding robotic. Your responses will be read out loud via text-to-speech, so avoid using markdown symbols like asterisks, bullet points, or complex formatting. Speak conversationally and cleanly.";
    if (relevantMemories.length > 0) systemPrompt += `\n\n[HINDSIGHT MEMORY CONTEXT]\n${relevantMemories.join('\n')}\n[/HINDSIGHT MEMORY]`;

    const messagesForAI = [
      { role: 'system', content: systemPrompt },
      ...chat.messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    // Step 2: LLM Text Generation & Emotion Extraction concurrently
    const sentimentPromise = (async () => {
      try {
        const sentimentPrompt = `Analyze the emotional tone of this message: "${message}". Return JSON exactly: {"emotion": one of [happy, sad, angry, neutral, excited, anxious], "confidence": number between 0 and 1, "score": number where happy=+2, excited=+3, neutral=0, anxious=-1, sad=-2, angry=-3}`;
        const res = await groqClient.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'system', content: 'You are an emotion analyzer. Return ONLY JSON.' }, { role: 'user', content: sentimentPrompt }],
          response_format: { type: 'json_object' }
        });
        return JSON.parse(res.choices[0].message.content);
      } catch(e) {
        return { emotion: 'neutral', confidence: 0, score: 0 };
      }
    })();

    const completionPromise = groqClient.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: messagesForAI,
    });

    const [completion, sentimentResult] = await Promise.all([completionPromise, sentimentPromise]);
    const aiResponseText = completion.choices[0].message.content;

    let emotionData = { label: 'neutral', confidence: 1.0, score: 0 };
    if (sentimentResult && sentimentResult.emotion && typeof sentimentResult.emotion === 'string') {
       emotionData = { label: sentimentResult.emotion.toLowerCase(), confidence: sentimentResult.confidence || 1.0, score: sentimentResult.score || 0 };
    }

    // Push text, emotion, and AI response in sequence
    chat.messages.push({ role: 'user', content: message, emotion: emotionData }); 
    chat.messages.push({ role: 'assistant', content: aiResponseText });
    await chat.save();

    // Background Memory Extraction
    Promise.resolve().then(async () => {
      const extractionPrompt = `Analyze this user message: "${message}". Does it contain personal facts, preferences, or useful context worth remembering about them? If YES, respond with exactly this JSON format: {"is_memory": true, "content": "Concise stated fact to remember", "keywords": ["keyword", "preference"]}. If NO, respond with exactly: {"is_memory": false}. Do not include any other text except the JSON.`;
      const extraction = await groqClient.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: 'You are a data bot. Valid JSON only.' }, { role: 'user', content: extractionPrompt }],
        response_format: { type: 'json_object' }
      });
      const result = JSON.parse(extraction.choices[0].message.content);
      if (result?.is_memory) await Memory.create({ user: req.user._id, content: result.content, keywords: result.keywords || [], importance: 1 });
    }).catch(e => console.error(e));

    // Step 3: TTS (OpenAI)
    const openaiClient = new OpenAI({ apiKey: openaiKey });
    const audioResponse = await openaiClient.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: aiResponseText,
    });
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const audioBase64 = audioBuffer.toString('base64');
    
    res.json({
      _id: chat._id,
      messages: chat.messages.filter(m => m.role !== 'system'),
      aiResponseText,
      audioBase64
    });

  } catch (err) {
    console.error("Voice processing error:", err);
    res.status(500).json({ message: "Voice processing failed", error: err.message });
  }
};
