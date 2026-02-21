import { processLevelScreenshot } from '../systems/levelSystem.js';

/**
 * Handles level scanning scans from job logs
 * @param {Message} message - The Discord message
 */
export async function handleLevelScanning(message) {
    const jobLogChannelId = process.env.JOB_LOG_CHANNEL_ID;
    if (jobLogChannelId && message.channel.id === jobLogChannelId) {
        if (message.attachments.size > 0) {
            // Process in background (don't await to avoid blocking other bot functions)
            processLevelScreenshot(message).catch(err => console.error(`Error processing level screenshot: ${err}`));
        }
    }
}
