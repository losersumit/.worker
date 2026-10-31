/**
 * Discord AI Moderation Bot - Configuration
 *
 * Keep provider model IDs separate: Gemini model IDs are not valid Groq model IDs.
 */
const config = {
    moderation: {
        strictMode: false,
        ignoredChannels: process.env.IGNORED_CHANNELS ? process.env.IGNORED_CHANNELS.split(',').map(v => v.trim()).filter(Boolean) : ["1455232294901121195", "1470594234754138133"],
        ignoredRoles: process.env.IGNORED_ROLES ? process.env.IGNORED_ROLES.split(',').map(v => v.trim()).filter(Boolean) : ["1448029016844931143", "1463184412937289973"],
        translateForeignLanguage: true,
        minMessageLength: 2,
        sensitivity: 0.1
    },
    warnings: {
        expiresAfterDays: 60,
        actionThresholds: { timeout1h: 3, timeout24h: 5, kick: 7, ban: 10 }
    },
    logging: {
        modLogChannels: ['mod-logs', 'modlogs', 'mod-log', 'modlog', 'bot-logs', 'admin-logs'],
        logAllDecisions: false,
        consoleLog: true,
        createLogChannel: true,
        includeMessageContent: true,
        censorMessageContent: false,
        maxContentLength: 1024
    },
    storage: {
        autoSaveInterval: 5,
        createBackups: true,
        maxBackups: 5,
        saveOnShutdown: true
    },
    ai: {
        // All Google Gemini calls use Gemini's API endpoint and GEMINI_API_KEY_* keys.
        geminiModel: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
        visionModel: process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
        fallbackVisionModel: process.env.GEMINI_FALLBACK_VISION_MODEL || "gemini-3.5-flash-lite",

        // Groq has a separate model namespace; this is used only by groqChatCompletion.
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0.1,
        maxTokens: 500,
        topP: 0.9
    },
    appearance: {
        colors: {
            error: '#FF0000',
            warning: '#FF9900',
            info: '#0099FF',
            success: '#00CC66',
            lowSeverity: '#FFCC00',
            mediumSeverity: '#FF6600',
            highSeverity: '#FF0000'
        },
        sendChannelNotificationsWhenDMFails: true,
        channelNotificationTimeout: 5000,
        showUserAvatarsInLogs: true,
        statusRotationInterval: 60000,
        customStatuses: []
    }
};

export default config;
