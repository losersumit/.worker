import { ActivityType } from 'discord.js';
import config from '../config.js';
import { recentActivity } from './activityState.js';

/**
 * Sets up rotating status messages for the bot
 * @param {Client} client - The Discord.js client
 */
export function setupStatusRotation(client) {
    // Default status objects with type and text
    const defaultStatuses = [
        { type: ActivityType.Watching, text: 'for violations' },
        { type: ActivityType.Listening, text: 'to conversations' },
        { type: ActivityType.Playing, text: `with {serverCount} servers` },
        { type: ActivityType.Watching, text: `sensitivity: {sensitivity}` },
        { type: ActivityType.Custom, text: `AI Moderation Active` },
        { type: ActivityType.Watching, text: `strict mode: {strictMode}` },
        { type: ActivityType.Watching, text: `{recentActivity}` },
    ];

    // Use custom statuses from config if available, otherwise use defaults
    let statuses = defaultStatuses;

    if (config.appearance.customStatuses && config.appearance.customStatuses.length > 0) {
        // Convert string types to ActivityType enum values
        statuses = config.appearance.customStatuses.map(status => {
            const activityTypeKey = status.type.toUpperCase();
            return {
                type: ActivityType[activityTypeKey] || ActivityType.Custom,
                text: status.text
            };
        });
    }

    // Set initial status
    updateStatus(client, statuses[0]);

    // Set up the rotation interval
    let currentIndex = 0;
    setInterval(() => {
        currentIndex = (currentIndex + 1) % statuses.length;

        // Update dynamic status elements
        const currentStatus = { ...statuses[currentIndex] };

        // Update server count for the Playing status
        if (currentStatus.text.includes('{serverCount}')) {
            currentStatus.text = currentStatus.text.replace('{serverCount}', client.guilds.cache.size);
        }

        // Update sensitivity for status that shows sensitivity
        if (currentStatus.text.includes('{sensitivity}')) {
            currentStatus.text = currentStatus.text.replace('{sensitivity}', `${config.moderation.sensitivity * 10}/10`);
        }

        // Update strict mode status
        if (currentStatus.text.includes('{strictMode}')) {
            currentStatus.text = currentStatus.text.replace('{strictMode}', config.moderation.strictMode ? "ON" : "OFF");
        }

        // Update recent activity status
        if (currentStatus.text.includes('{recentActivity}')) {
            // Reset counter if it's been more than an hour
            if (Date.now() - recentActivity.resetTime > 3600000) {
                recentActivity.moderationCount = 0;
                recentActivity.resetTime = Date.now();
            }

            const minutesSinceLastAction = recentActivity.lastModeration ?
                Math.floor((Date.now() - recentActivity.lastModeration) / 60000) : null;

            let activityText;
            if (recentActivity.moderationCount === 0) {
                activityText = "all clear";
            } else if (minutesSinceLastAction !== null && minutesSinceLastAction < 10) {
                activityText = `${recentActivity.moderationCount} flags (active)`;
            } else {
                activityText = `${recentActivity.moderationCount} flags this hour`;
            }

            currentStatus.text = currentStatus.text.replace('{recentActivity}', activityText);
        }

        updateStatus(client, currentStatus);
    }, config.appearance.statusRotationInterval || 60000); // Default to 1 minute if not configured
}

/**
 * Updates the bot's status
 * @param {Client} client - The Discord.js client 
 * @param {Object} status - Status object with type and text
 */
function updateStatus(client, status) {
    client.user.setActivity(status.text, { type: status.type });
    if (config.logging.consoleLog) {
        console.log(`Status updated: ${status.text} (${ActivityType[status.type]})`);
    }
}
