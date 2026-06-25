/**
 * Task Session Manager
 * Manages pending task state per user+channel for the agent loop.
 * Sessions auto-expire after 5 minutes (TTL).
 */

// Task states
export const STATES = {
    RUNNING: 'RUNNING',
    AWAITING_CLARIFICATION: 'AWAITING_CLARIFICATION',
    AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
    CONFIRMED: 'CONFIRMED',
    CANCELLED: 'CANCELLED',
    COMPLETED: 'COMPLETED'
};

const SESSION_TTL_MS = 300000; // 5 minutes

/** @type {Map<string, SessionData>} keyed by `${userId}:${channelId}` */
const sessions = new Map();

/**
 * Build the session map key.
 * @param {string} userId
 * @param {string} channelId
 * @returns {string}
 */
function makeKey(userId, channelId) {
    return `${userId}:${channelId}`;
}

/**
 * Check if a session has expired and clean it up if so.
 * @param {string} key
 * @returns {boolean} true if the session was expired (and removed)
 */
function isExpired(key) {
    const session = sessions.get(key);
    if (!session) return true;
    if (Date.now() > session.expiresAt) {
        sessions.delete(key);
        console.log(`[TaskSession] Session expired and cleared: ${key}`);
        return true;
    }
    return false;
}

/**
 * Create a new task session for a user in a channel.
 * @param {string} userId
 * @param {string} channelId
 * @param {object} initialData - Arbitrary data to attach to the session
 * @returns {object} The created session
 */
export function createSession(userId, channelId, initialData = {}) {
    const key = makeKey(userId, channelId);
    const now = Date.now();

    const session = {
        state: STATES.RUNNING,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
        data: { ...initialData },
        agentMessages: [],   // The conversation messages array for resuming the loop
        pendingAction: null  // Stored action for confirmation flows (embed data, webhook, etc.)
    };

    sessions.set(key, session);
    console.log(`[TaskSession] Created session: ${key}`);
    return session;
}

/**
 * Get an existing session, or null if none / expired.
 * @param {string} userId
 * @param {string} channelId
 * @returns {object|null}
 */
export function getSession(userId, channelId) {
    const key = makeKey(userId, channelId);
    if (isExpired(key)) return null;
    return sessions.get(key) || null;
}

/**
 * Merge updates into an existing session.
 * Also refreshes the TTL.
 * @param {string} userId
 * @param {string} channelId
 * @param {object} updates - Fields to merge into the session
 * @returns {object|null} The updated session, or null if not found
 */
export function updateSession(userId, channelId, updates) {
    const key = makeKey(userId, channelId);
    if (isExpired(key)) return null;

    const session = sessions.get(key);
    if (!session) return null;

    // Merge updates
    Object.assign(session, updates);

    // Refresh TTL on update
    session.expiresAt = Date.now() + SESSION_TTL_MS;

    sessions.set(key, session);
    return session;
}

/**
 * Delete a session entirely.
 * @param {string} userId
 * @param {string} channelId
 */
export function clearSession(userId, channelId) {
    const key = makeKey(userId, channelId);
    sessions.delete(key);
    console.log(`[TaskSession] Cleared session: ${key}`);
}

/**
 * Check if a user has a pending session (AWAITING_CLARIFICATION or AWAITING_CONFIRMATION).
 * @param {string} userId
 * @param {string} channelId
 * @returns {boolean}
 */
export function hasPendingSession(userId, channelId) {
    const session = getSession(userId, channelId);
    if (!session) return false;
    return (
        session.state === STATES.AWAITING_CLARIFICATION ||
        session.state === STATES.AWAITING_CONFIRMATION
    );
}
