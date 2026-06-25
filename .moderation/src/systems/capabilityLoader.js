/**
 * Capability Loader
 * Maps capability names to tool modules and provides the capability menu
 * text shown to the AI in the system prompt.
 */

// ─── Capability Menu (shown to AI in system prompt) ─────────────────

const CAPABILITY_MENU = `Available capabilities (call the tools directly — you have all of them loaded):
- FAQ: Search NMC knowledge base (rank requirements, skin guides, game mechanics, VTC rules, economy)
- Database: Query player stats, roles, jobs, VTCs, leaderboards, check rank eligibility
- Comms: Send announcements, embeds, webhooks to Discord channels, resolve channels/roles
- Memory: Recall past conversations and server events about users`;

/**
 * Returns the capability menu text for the system prompt.
 * @returns {string}
 */
export function getCapabilityMenu() {
    return CAPABILITY_MENU;
}

// ─── Lazy module cache ──────────────────────────────────────────────

const moduleCache = new Map();

async function loadModule(name) {
    if (moduleCache.has(name)) return moduleCache.get(name);

    let mod;
    switch (name) {
        case 'FAQ':
            mod = await import('./tools/faqTools.js');
            break;
        case 'Database':
            mod = await import('./tools/databaseTools.js');
            break;
        case 'Comms':
            mod = await import('./tools/commsTools.js');
            break;
        case 'Memory':
            mod = await import('./tools/memoryTools.js');
            break;
        default:
            console.warn(`[CapabilityLoader] Unknown capability: ${name}`);
            return null;
    }

    moduleCache.set(name, mod);
    return mod;
}

/**
 * Load tool definitions and executors for the given capability names.
 *
 * @param {string[]} capabilityNames - e.g. ["FAQ", "Database"]
 * @returns {Promise<{
 *   definitions: Array,
 *   executors: Record<string, (toolName: string, args: object, context: object) => Promise<any>>
 * }>}
 */
export async function loadToolsForCapabilities(capabilityNames) {
    const allDefs = [];
    const executors = {};

    for (const name of capabilityNames) {
        const mod = await loadModule(name);
        if (!mod) continue;

        // Merge definitions
        if (mod.definitions) {
            allDefs.push(...mod.definitions);
        }

        // Map each tool name to its module's execute function
        if (mod.definitions && mod.execute) {
            for (const def of mod.definitions) {
                const toolName = def.function?.name;
                if (toolName) {
                    executors[toolName] = mod.execute;
                }
            }
        }
    }

    return { definitions: allDefs, executors };
}

/**
 * Load ALL capabilities at once (convenience shorthand).
 * @returns {Promise<{ definitions: Array, executors: Record<string, Function> }>}
 */
export async function loadAllTools() {
    return loadToolsForCapabilities(['FAQ', 'Database', 'Comms', 'Memory']);
}
