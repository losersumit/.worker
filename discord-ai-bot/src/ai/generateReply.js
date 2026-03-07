import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateReply(prompt) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: 'You are helpful, concise, and accurate.' },
      { role: 'user', content: prompt }
    ]
  });

  return response.choices?.[0]?.message?.content?.trim() || 'No response generated.';
}
