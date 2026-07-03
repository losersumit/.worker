import axios from 'axios';

/**
 * Publishes an image or video to Instagram using the Facebook Graph API.
 * @param {object} params
 * @param {string} params.mediaUrl - The public url of the image or video (e.g. Discord CDN URL).
 * @param {'image'|'video'} params.mediaType - The type of media.
 * @param {string} params.caption - The text caption for the post.
 * @param {string} [params.song] - Optional song details to append to caption or log.
 * @returns {Promise<string>} The published post ID or URL.
 */
export async function publishToInstagram({ mediaUrl, mediaType, caption }) {
    const userId = process.env.INSTAGRAM_USER_ID;
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!userId || !token) {
        throw new Error('Missing Instagram credentials (INSTAGRAM_USER_ID or INSTAGRAM_ACCESS_TOKEN) in configuration.');
    }

    console.log(`[Instagram Client] Creating media container for ${mediaType}...`);
    
    const isVideo = mediaType === 'video';
    const containerParams = {
        access_token: token,
        caption: caption,
    };

    if (isVideo) {
        containerParams.media_type = 'REELS'; // Using Reels for video posts on Instagram
        containerParams.video_url = mediaUrl;
    } else {
        containerParams.image_url = mediaUrl;
    }

    // 1. Create Media Container
    const containerRes = await axios.post(
        `https://graph.facebook.com/v19.0/${userId}/media`,
        null,
        { params: containerParams }
    );

    const containerId = containerRes.data.id;
    if (!containerId) {
        throw new Error('Failed to retrieve container ID from Meta API response.');
    }

    console.log(`[Instagram Client] Created container ID: ${containerId}.`);

    // 2. If video, poll status until FINISHED
    if (isVideo) {
        console.log(`[Instagram Client] Polling video processing status for container: ${containerId}...`);
        let statusCode = 'IN_PROGRESS';
        let attempts = 0;
        const maxAttempts = 30; // 30 attempts * 5s = 150 seconds max wait time

        while ((statusCode === 'IN_PROGRESS' || statusCode === 'UNDER_PROCESSING') && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempts++;

            try {
                const statusRes = await axios.get(`https://graph.facebook.com/v19.0/${containerId}`, {
                    params: {
                        fields: 'status_code',
                        access_token: token,
                    }
                });
                statusCode = statusRes.data.status_code;
                console.log(`[Instagram Client] Polling attempt ${attempts}/${maxAttempts}: status is ${statusCode}`);
            } catch (pollErr) {
                console.error('[Instagram Client] Polling error:', pollErr.message);
            }
        }

        if (statusCode !== 'FINISHED') {
            throw new Error(`Video processing timed out or failed. Final status: ${statusCode}`);
        }
    }

    // 3. Publish Media Container
    console.log(`[Instagram Client] Publishing container: ${containerId}...`);
    const publishRes = await axios.post(
        `https://graph.facebook.com/v19.0/${userId}/media_publish`,
        null,
        {
            params: {
                creation_id: containerId,
                access_token: token,
            }
        }
    );

    const postId = publishRes.data.id;
    console.log(`[Instagram Client] Successfully published! Post ID: ${postId}`);
    return postId;
}
