/**
 * Discord Server Channels — National Mobility Command
 *
 * All channel IDs for the guild, grouped by feature area.
 * Keep IDs here, NOT in .env — they are static server configuration,
 * not secrets or deployment-specific values.
 */

const channels = {

  // ── Core / Community ─────────────────────────────────────────────────────
  GENERAL:          "1483730512257224715",
  WELCOME:          "1483730512257224715",   // Same as GENERAL
  ANNOUNCEMENTS:    "1448029071958085743",

  // ── Logging ──────────────────────────────────────────────────────────────
  LOG:              "1453743486489858150",
  JOB_LOG:          "1460901549378375700",
  ECONOMY_LOGS:     "1487761784155934740",
  GUILD_INCOME:     "1465057883166212117",
  MILESTONES:       "1499854684922577147",
  RTD_ANNOUNCE:     "1499854684922577147",   // Same as MILESTONES

  // ── Enlistment & Training ─────────────────────────────────────────────────
  ENLISTED:         "1462371590393041069",
  TRAINING:         "1475325604873113713",
  REVIEW:           "1462797901305745509",
  REJECTION:        "1448038019755151391",   // Bonds cabin / rejection landing

  // ── Finance ───────────────────────────────────────────────────────────────
  FINANCE:          "1464745553559687393",
  BONDS_CABIN:      "1448038019755151391",

  // ── Styling & Media ───────────────────────────────────────────────────────
  STYLING:          "1457066114176520254",

  // ── Minigames ─────────────────────────────────────────────────────────────
  COUNTING:         "1470099709485125779",
  ONE_WORD_STORY:   "1528502248718602251",
  RANT:             "1524337796465168454",
  ROULETTE:         "1483322715048906852",
  SLOTS:            "1483322805142421634",

  // ── Persistent Embed Message IDs ──────────────────────────────────────────
  // These are message IDs, not channel IDs, but they are static config too
  EMBEDS: {
    AP:  "1526516918809264250",
    RP:  "1526516999629574164",
    RTD: "1526517062715838594",
  },

  // ── Channels to skip for AI moderation ────────────────────────────────────
  MODERATION_IGNORED: [
    "1455232294901121195",
    "1470594234754138133",
  ],

  // ── Channels where the RAG chatbot does NOT auto-reply ────────────────────
  CHAT_IGNORED: [
    "1464745553559687393",   // FINANCE
    "1459853149631283241",
    "1470099709485125779",   // COUNTING
    "1480973522686705887",
    "1528502248718602251",   // ONE_WORD_STORY
  ],

};

export default channels;
