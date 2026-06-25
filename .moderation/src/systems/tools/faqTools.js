/**
 * FAQ Tools — Capability Module
 * Provides search access to the NMC knowledge base via vector similarity.
 */

import { findFaqAnswer } from '../faq.js';

// ─── Tool Definitions (Groq/OpenAI function-calling schema) ─────────

export const definitions = [
    {
        type: 'function',
        function: {
            name: 'search_faq',
            description:
                'Search the NMC knowledge base. Contains: rank requirements and promotion criteria ' +
                '(Operator, Field Operator, SMO), skin installation guides for iOS/Android/PC, ' +
                'truck and trailer recommendations, game mechanics and controls, VTC rules and policies, ' +
                'economy system guides, toll booth prices, server information, enlistment trial structure, ' +
                'convoy procedures, Reserved Personnel rules.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query to find relevant FAQ entries.',
                    },
                },
                required: ['query'],
            },
        },
    },
];

// ─── Executor ───────────────────────────────────────────────────────

/**
 * Execute a FAQ tool call.
 * @param {string} toolName
 * @param {object} args
 * @param {object} context
 * @returns {Promise<object>}
 */
export async function execute(toolName, args, context) {
    if (toolName === 'search_faq') {
        try {
            const result = await findFaqAnswer(args.query);
            if (result) {
                return { found: true, content: result };
            }
            return { found: false, content: 'No relevant FAQ entry found for that query.' };
        } catch (err) {
            console.error('[faqTools] search_faq error:', err.message);
            return { found: false, error: 'FAQ search failed.' };
        }
    }

    return { error: `Unknown FAQ tool: ${toolName}` };
}
