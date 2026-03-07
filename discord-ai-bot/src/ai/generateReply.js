import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' }); // Reaching up to main .env

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY_ONE });

export async function generateReply(prompt) {
  try {
    const response = await groq.chat.completions.create({
      model: 'mixtral-8x7b-32768', // Fast Groq model suitable for this
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You are helpful, concise, and accurate.' },
        { role: 'user', content: prompt }
      ]
    });

    return response.choices?.[0]?.message?.content?.trim() || 'No response generated.';
  } catch (err) {
    console.error('Groq Generation Error:', err);
    return 'Failed to generate response.';
  }
}
