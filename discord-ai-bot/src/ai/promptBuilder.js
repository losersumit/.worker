import { sanitizeText } from '../rag/embed.js';

export function buildPrompt({ question, context }) {
  const safeQuestion = sanitizeText(question);
  const contextBlock = context.length
    ? context.map((c, i) => `[${i + 1}] (${c.source}) #${c.channel_id} @ ${new Date(c.ts).toISOString()}\n${sanitizeText(c.text)}`).join('\n\n')
    : 'No relevant context found.';

  return [
    'You are a Discord server assistant.',
    'Use ONLY retrieved context when possible. If uncertain, explicitly say what is missing.',
    'Below are relevant past messages from the server:',
    contextBlock,
    'Answer the user clearly and reference the context snippets by index when useful.',
    `User question: ${safeQuestion}`
  ].join('\n\n');
}
