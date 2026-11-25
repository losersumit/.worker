/**
 * Discord Server Roles — National Mobility Command
 *
 * All role IDs for the guild. Grouped by function so it's easy
 * to see what everything is at a glance.
 *
 * Keep IDs here, NOT in .env — they are static server configuration,
 * not secrets or deployment-specific values.
 */

const roles = {

  // ── Core Administration ──────────────────────────────────────────────────
  COMMANDER:  "1448029016844931143",
  PARTNER:    "1455251260763541731",

  // ── Officer Hierarchy ────────────────────────────────────────────────────
  SMO:        "1475314856184778835",   // Senior Management Officer
  FO:         "1475314865878077603",   // Field Officer
  O:          "1475314870802055421",   // Officer

  // ── Enlisted / Trainee ───────────────────────────────────────────────────
  TRAINEE:    "1475196328303792138",
  ENLISTED:   "1482386008376086598",

  // ── Entry / Visitor ──────────────────────────────────────────────────────
  AUTO:       "1448029031672053900",   // Auto-assigned on join
  VISITOR:    "1448029031672053900",   // Same as AUTO — member before enlisting

  // ── Status / Division Tags ───────────────────────────────────────────────
  AP:         "1463184412937289973",   // Active Participant
  RP:         "1482059608536387795",   // Reserve/Part-time Player
  RTD:        "1499413282279129139",   // Retired

  // ── Level Progression ────────────────────────────────────────────────────
  LEVEL: {
    ROOKIE:       "1469956018908823716",   //  1–4
    QUALIFIED:    "1448029030283477074",   //  5–11
    PROFESSIONAL: "1448029028970664088",   // 12–29
    TACTICAL:     "1448029024948326472",   // 30–49
    SPECIALIST:   "1469958222420119715",   // 50–74
    MASTER:       "1448029023530913946",   // 75–99
    ELITE:        "1469958213997821952",   //  100+
  },

  // ── Permission Groups ────────────────────────────────────────────────────
  // Roles that can run officer-only commands
  OFFICER_ROLES: [
    "1448029016844931143",   // COMMANDER
    "1455251260763541731",   // PARTNER
    "1475314856184778835",   // SMO
    "1475314865878077603",   // FO
    "1475314870802055421",   // O
  ],

  // Roles that the enlistment system will accept applications from
  ENLISTMENT_ALLOWED_ROLES: [
    "1448029016844931143",   // COMMANDER
  ],

  // Roles that bypass AI moderation entirely
  MODERATION_IGNORED_ROLES: [
    "1482386008376086598",   // ENLISTED
    "1499413282279129139",   // RTD
    "1527739647126667324",   // (special bypass role)
  ],

};

export default roles;
