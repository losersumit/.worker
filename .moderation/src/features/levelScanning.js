import { processLevelScreenshot } from '../systems/levelSystem.js';

/**
 * Handles level scanning scans from job logs
 * @param {Message} message - The Discord message
 */
export async function handleLevelScanning(message) {
    const jobLogChannelId = process.env.JOB_LOG_CHANNEL_ID;
    if (jobLogChannelId && message.channel.id === jobLogChannelId) {
        // Process in background so RP->AP reactivation happens on every job log,
        // while screenshot-based level scanning still runs when an image is attached.
        processLevelScreenshot(message).catch(err => console.error(`Error processing level screenshot: ${err}`));
    }
}
