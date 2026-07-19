/**
 * Discord AI Moderation Bot - Configuration
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

// Bot configuration settings
const config = {
    // Moderation settings
    moderation: {
        // Flag messages for review even when AI confidence is low
        strictMode: false,

        // Ignore messages in these channels (channel IDs)
        ignoredChannels: process.env.IGNORED_CHANNELS ? process.env.IGNORED_CHANNELS.split(',').map(r => r.trim()).filter(Boolean) : ["1455232294901121195", "1470594234754138133"],

        // Ignore messages from these roles (role IDs)
        ignoredRoles: process.env.IGNORED_ROLES ? process.env.IGNORED_ROLES.split(',').map(r => r.trim()).filter(Boolean) : ["1448029016844931143", "1463184412937289973"],

        // Automatically detect and translate non-English messages
        translateForeignLanguage: true,

        // Minimum message length to analyze (very short messages are skipped)
        minMessageLength: 2,

        // Moderation sensitivty (0-1) - higher values are more strict
        sensitivity: 0.1
    },

    // Warning system settings
    warnings: {
        // How many days before a warning expires
        expiresAfterDays: 60,

        // Warning counts for different actions
        actionThresholds: {
            timeout1h: 3,   // 3 warnings -> 1hr timeout
            timeout24h: 5,  // 5 warnings -> 24hr timeout
            kick: 7,        // 7 warnings -> kick
            ban: 10         // 10 warnings -> ban
        }
    },

    // Logging settings
    logging: {
        // Channel names to look for when logging moderation actions
        modLogChannels: ['mod-logs', 'modlogs', 'mod-log', 'modlog', 'bot-logs', 'admin-logs'],

        // Whether to log all moderation decisions (even non-flagged messages)
        logAllDecisions: false,

        // Log mod actions to console
        consoleLog: true,

        // Automatically create a private mod-logs channel if one doesn't exist
        createLogChannel: true,

        // Include message content in mod-logs
        includeMessageContent: true,

        // Whether to include filtered/censored message content in logs
        censorMessageContent: false,

        // Maximum length of message content in logs
        maxContentLength: 1024
    },

    // Storage settings
    storage: {
        // How often to save data to disk automatically (in minutes, 0 to disable)
        autoSaveInterval: 5,

        // Whether to back up data files before overwriting
        createBackups: true,

        // Maximum number of backup files to keep
        maxBackups: 5,

        // Save data on bot shutdown (when possible)
        saveOnShutdown: true
    },

    // Advanced AI settings
    ai: {
        // Groq model to use
        model: "llama-3.3-70b-versatile",

        // Vision model for image moderation
        visionModel: "gemini-3.1-flash-lite",
        fallbackVisionModel: "gemini-3.5-flash",

        // Temperature for AI response (lower = more deterministic)
        temperature: 0.1,

        // Maximum tokens in AI response
        maxTokens: 500,

        // Top-p sampling
        topP: 0.9
    },

    // Visual and UI settings
    appearance: {
        // Color schemes (hex colors)
        colors: {
            error: '#FF0000',  // Red
            warning: '#FF9900',  // Orange
            info: '#0099FF',    // Blue
            success: '#00CC66',  // Green

            // Severity colors
            lowSeverity: '#FFCC00',   // Yellow
            mediumSeverity: '#FF6600', // Orange
            highSeverity: '#FF0000'    // Red
        },

        // Whether to send temporary channel notifications when DMs fail
        sendChannelNotificationsWhenDMFails: true,

        // How long to show channel notifications before deleting (in ms)
        channelNotificationTimeout: 5000,

        // Include user avatars in mod logs
        showUserAvatarsInLogs: true,

        // Status rotation settings
        statusRotationInterval: 60000, // How often to rotate statuses (in ms)

        // Custom statuses to show in rotation (if empty, defaults will be used)
        customStatuses: [
            // Format: { type: "WATCHING", text: "for violations" }
            // Valid types: PLAYING, STREAMING, LISTENING, WATCHING, CUSTOM, COMPETING
            // You can use these placeholders in the text: 
            //   {serverCount} - number of servers the bot is in
            //   {sensitivity} - current moderation sensitivity level
            //   {strictMode} - whether strict mode is enabled
            //   {recentActivity} - recent moderation activity summary
            // Examples:
            // { type: "PLAYING", text: "with {serverCount} servers" },
            // { type: "WATCHING", text: "sensitivity: {sensitivity}" },
            // { type: "WATCHING", text: "strict mode: {strictMode}" },
            // { type: "WATCHING", text: "{recentActivity}" }
        ]
    }
};

export default config; 
