import { WebhookClient } from 'discord.js';

/**
 * Utility to manage modifying Discord Message Components (V2) used for registries.
 * These messages use nested component arrays instead of standard embeds.
 */

/**
 * Helper to edit a webhook message specifically modifying a user's entry in a text component block.
 * 
 * @param {string} webhookUrl - URL of the webhook
 * @param {string} messageId - ID of the message to edit
 * @param {string} userId - Discord ID of the specific user
 * @param {object} options - Action options
 * @param {string} [options.action='add'] - 'add' or 'remove'
 * @param {string} [options.registrationNumber] - Required if action is 'add'
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function modifyRegistryComponents(webhookUrl, messageId, userId, options = {}) {
    const { action = 'add', registrationNumber } = options;
    
    if (!webhookUrl || !messageId) {
        console.error("Missing webhookUrl or messageId for modifyRegistryComponents");
        return false;
    }

    try {
        const webhook = new WebhookClient({ url: webhookUrl });
        const message = await webhook.fetchMessage(messageId);
        
        if (!message || !message.components || !message.components.length) {
            console.error(`Message ${messageId} not found or has no components.`);
            return false;
        }

        const components = message.components.map(component =>
            typeof component.toJSON === 'function' ? component.toJSON() : component
        );

        const userMention = `<@${userId}>`;
        const newEntry = registrationNumber ? `${userMention} - \`${registrationNumber}\`` : null;

        let entryUpdated = false;
        let appendTargetSet = false;

        const checkExistingEntry = (component) => {
            return component?.type === 17 &&
                Array.isArray(component.components) &&
                component.components.some(inner =>
                    inner?.type === 10 &&
                    typeof inner.content === 'string' &&
                    inner.content.includes(userMention)
                );
        };

        const hasExistingEntry = components.some(checkExistingEntry);

        const updatedComponents = components.map(component => {
            if (component?.type !== 17 || !Array.isArray(component.components)) {
                return component;
            }

            // 1. If modifying an existing entry (either remove or replace)
            if (hasExistingEntry) {
                const updatedInner = component.components.map(inner => {
                    if (inner?.type !== 10 || typeof inner.content !== 'string') return inner;
                    if (!inner.content.includes(userMention)) return inner;
                    
                    entryUpdated = true;
                    
                    let lines = inner.content.split('\n');
                    
                    if (action === 'remove') {
                        // Filter out the line with the user
                        lines = lines.filter(line => !line.includes(userMention));
                    } else if (action === 'add') {
                        // Replace the specific line
                        lines = lines.map(line => line.includes(userMention) ? newEntry : line);
                    }
                    
                    return { ...inner, content: lines.join('\n').trim() };
                });
                return { ...component, components: updatedInner };
            }

            // 2. If adding a new entry and no existing entry was found
            if (action === 'add' && !appendTargetSet && component.accent_color != null) {
                appendTargetSet = true;
                const updatedInner = component.components.map((inner, idx) => {
                    // Usually the first text block in the container
                    if (idx !== 0 || inner?.type !== 10 || typeof inner.content !== 'string') return inner;
                    
                    const newContent = inner.content ? `${inner.content}\n${newEntry}` : newEntry;
                    return { ...inner, content: newContent };
                });
                return { ...component, components: updatedInner };
            }

            return component;
        });

        // 3. Fallback: If adding and no accent_color container was found, push a new one
        if (action === 'add' && !entryUpdated && !appendTargetSet) {
            updatedComponents.push({
                type: 17, // Action Row type for these custom V2 messages
                components: [{ type: 10, content: newEntry }],
                accent_color: 196713 // Default color often used in the server's embeds
            });
        }

        // Apply changes
        await webhook.editMessage(messageId, {
            components: updatedComponents,
            flags: 32768 // IS_COMPONENTS_V2 flag required for these types of layouts
        });

        return true;
    } catch (err) {
        console.error(`Failed to modify registry components for msg ${messageId}:`, err);
        return false;
    }
}
