/**
 * NMC Worker Bot — Central Configuration
 *
 * Structure (inspired by TmP bot's config/index.js pattern):
 *   config.roles    → all Discord role IDs (from roles.js)
 *   config.channels → all Discord channel IDs (from channels.js)
 *   config.*        → everything else (secrets stay in .env)
 *
 * Rule of thumb:
 *   • IDs & static constants → this file (roles.js / channels.js)
 *   • Tokens, API keys, passwords → .env only
 */

import '../utils/loadEnv.js';
import roles from './roles.js';
import channels from './channels.js';

const config = {

  // ── Discord IDs (no longer in .env) ───────────────────────────────────────
  roles,
  channels,

  // ── Server Identity ────────────────────────────────────────────────────────
  guild: {
    id:        "1448027116074434593",
    companyId: "1453737415318573280",
    name:      "National Mobility Command",
    short:     "NMC",
  },

  // ── Secrets (read from .env) ───────────────────────────────────────────────
  discord: {
    token:    process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
  },

  supabase: {
    url:     process.env.SUPABASE_URL,
    key:     process.env.SUPABASE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },

  // ── AI Provider Keys (secrets — stay in .env) ─────────────────────────────
  aiProviders: {
    gemini: {
      keys: [
        process.env.GEMINI_API_KEY_ONE,
        process.env.GEMINI_API_KEY_TWO,
        process.env.GEMINI_API_KEY_THREE,
        process.env.GEMINI_API_KEY_FOUR,
        process.env.GEMINI_API_KEY_FIVE,
        process.env.GEMINI_API_KEY_SIX,
        process.env.GEMINI_API_KEY_SEVEN,
        process.env.GEMINI_API_KEY_EIGHT,
      ].filter(Boolean),
      endpoint: process.env.GEMINI_ENDPOINT || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    },
    groq: {
      keys: [
        process.env.GROQ_API_KEY_ONE,
        process.env.GROQ_API_KEY_TWO,
        process.env.GROQ_API_KEY_THREE,
        process.env.GROQ_API_KEY_FOUR,
        process.env.GROQ_API_KEY_FIVE,
        process.env.GROQ_API_KEY_SIX,
        process.env.GROQ_API_KEY_SEVEN,
        process.env.GROQ_API_KEY_EIGHT,
      ].filter(Boolean),
      endpoint: process.env.GROQ_ENDPOINT || "https://api.groq.com/openai/v1/chat/completions",
    },
  },

  nomic: {
    apiKey:   process.env.NOMIC_API_KEY,
    endpoint: "https://api-atlas.nomic.ai/v1/embedding/text",
    model:    "nomic-embed-text-v1.5",
    dimension: 768,
  },

  // ── Instagram Integration Secrets ─────────────────────────────────────────
  instagram: {
    appId:              process.env.INSTAGRAM_APP_ID,
    appSecret:          process.env.INSTAGRAM_APP_SECRET,
    userId:             process.env.INSTAGRAM_USER_ID,
    accessToken:        process.env.INSTAGRAM_ACCESS_TOKEN,
    pageAccessToken:    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN,
  },

  // ── Webhooks (secrets — contain token in URL) ──────────────────────────────
  webhooks: {
    application:    process.env.APPLICATION_WEBHOOK_URL,
    enlistedChannel: process.env.ENLISTED_CHANNEL_WEBHOOK_URL,
    officers:       process.env.OFFICERS_CHANNEL_WEBHOOK,
    skinShop:       process.env.SKIN_SHOP_WEBHOOK_URL,
  },

  // ── AI Model Routing ───────────────────────────────────────────────────────
  ai: {
    // Model IDs used throughout the moderation system
    geminiModel:         "gemini-3.1-flash-lite",
    visionModel:         "gemini-3.1-flash-lite",
    fallbackVisionModel: "gemini-3.1-flash-lite",
    model:               "openai/gpt-oss-120b",   // default Groq model
    temperature:         0.1,
    maxTokens:           500,
    topP:                0.9,
  },

  // ── Per-feature AI config ──────────────────────────────────────────────────
  features: {
    chat: {
      provider:    "groq",
      model:       "openai/gpt-oss-120b",
      temperature: 0.7,
      maxTokens:   512,
      maxHistory:  12,
    },
    chatVision: {
      provider:    "gemini",
      model:       "gemini-3.1-flash-lite",
      temperature: 0.6,
      maxTokens:   512,
    },
    ragSummary: {
      provider:    "groq",
      model:       "openai/gpt-oss-120b",
      temperature: 0.2,
      maxTokens:   300,
    },
    moderationText: {
      provider:    "groq",
      model:       "openai/gpt-oss-20b",
      temperature: 0.1,
      maxTokens:   500,
    },
    moderationImage: {
      provider:    "gemini",
      model:       "gemini-3.1-flash-lite",
      temperature: 0.1,
      maxTokens:   500,
    },
    moderationMedia: {
      provider:    "gemini",
      model:       "gemini-3.1-flash-lite",
      temperature: 0.1,
      maxTokens:   500,
      timeout:     90000,
    },
  },

  // ── Moderation Settings ────────────────────────────────────────────────────
  moderation: {
    strictMode:        false,
    minMessageLength:  2,
    sensitivity:       0.1,
    translateForeignLanguage: true,

    // Channel/role ignores are now driven from channels.js and roles.js
    ignoredChannels:   channels.MODERATION_IGNORED,
    ignoredRoles:      roles.MODERATION_IGNORED_ROLES,

    warnings: {
      expiresAfterDays: 60,
      actionThresholds: { timeout1h: 3, timeout24h: 5, kick: 7, ban: 10 },
    },

    logging: {
      logChannelId:    channels.LOG,
      modLogChannels:  ['mod-logs', 'modlogs', 'mod-log', 'modlog', 'bot-logs', 'admin-logs'],
      logAllDecisions: false,
      consoleLog:      true,
      createLogChannel: true,
      includeMessageContent: true,
      censorMessageContent:  false,
      maxContentLength: 1024,
    },
  },

  // ── FAQ / RAG Chat ─────────────────────────────────────────────────────────
  faq: {
    similarityThreshold: 0.30,
  },

  // ── Appearance ─────────────────────────────────────────────────────────────
  appearance: {
    colors: {
      error:          "#FF0000",
      warning:        "#FF9900",
      info:           "#0099FF",
      success:        "#00CC66",
      lowSeverity:    "#FFCC00",
      mediumSeverity: "#FF6600",
      highSeverity:   "#FF0000",
    },
    sendChannelNotificationsWhenDMFails: true,
    channelNotificationTimeout:          5000,
    showUserAvatarsInLogs:               true,
    statusRotationInterval:              60000,
    customStatuses:                      [],
  },

  // ── Storage ────────────────────────────────────────────────────────────────
  storage: {
    autoSaveInterval: 5,
    createBackups:    true,
    maxBackups:       5,
    saveOnShutdown:   true,
  },

};

export default config;
