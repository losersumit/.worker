import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import schedule from 'node-schedule';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1530922985349713921/WfSZPDCo5Fn55isM8j5rFZyJMg7YKo92OFqvdDWUbjluaH6EUaKcv-PilIfWP8yNvrRx';
const CHANNEL_ID = '1459853149631283241';

const levelsConfig = [
  {
    level: 2,
    time: '2026-07-27T04:00:00+05:30', // 4:00 AM IST
    jsonFile: 'event level two.json',
    imageFile: 'event_level_two.jpg'
  },
  {
    level: 3,
    time: '2026-07-27T10:00:00+05:30', // 10:00 AM IST
    jsonFile: 'event level three.json',
    imageFile: 'event_level_three.jpg'
  },
  {
    level: 4,
    time: '2026-07-27T16:00:00+05:30', // 4:00 PM IST
    jsonFile: 'event level four.json',
    imageFile: 'event_level_four.jpg'
  }
];

function fixMediaUrls(obj, targetFilename) {
  if (typeof obj === 'object' && obj !== null) {
    if (obj.media && typeof obj.media.url === 'string' && obj.media.url.startsWith('attachment://')) {
      obj.media.url = `attachment://${targetFilename}`;
    }
    for (const key of Object.keys(obj)) {
      fixMediaUrls(obj[key], targetFilename);
    }
  }
}

async function postLevel(levelConfig) {
  const scavengerDir = __dirname;
  const jsonPath = path.join(scavengerDir, levelConfig.jsonFile);
  const imagePath = path.join(scavengerDir, levelConfig.imageFile);

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON file not found: ${jsonPath}`);
  }
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  const rawJson = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(rawJson);

  const payload = {
    flags: data.flags || 32768,
    components: data.components || []
  };

  fixMediaUrls(payload.components, levelConfig.imageFile);

  payload.attachments = [
    {
      id: 0,
      filename: levelConfig.imageFile
    }
  ];

  const fileBuffer = fs.readFileSync(imagePath);
  const fileBlob = new Blob([fileBuffer], { type: 'image/jpeg' });

  const formData = new FormData();
  formData.append('payload_json', JSON.stringify(payload));
  formData.append('files[0]', fileBlob, levelConfig.imageFile);

  console.log(`[SCAVENGER] Level ${levelConfig.level}: Sending request to Discord webhook...`);
  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord Webhook returned status ${response.status}: ${errorText}`);
  }

  console.log(`[SCAVENGER] Level ${levelConfig.level} posted successfully!`);
}

async function hasBeenPosted(client, level) {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) {
      console.warn(`[SCAVENGER] Could not find channel with ID ${CHANNEL_ID}`);
      return false;
    }
    const messages = await channel.messages.fetch({ limit: 50 });
    const searchString = `Level ${level}`;
    for (const [_, msg] of messages) {
      if (msg.content && msg.content.includes(searchString)) return true;
      if (msg.components && JSON.stringify(msg.components).includes(searchString)) return true;
      if (msg.embeds && msg.embeds.some(e => 
        (e.title && e.title.includes(searchString)) || 
        (e.description && e.description.includes(searchString))
      )) return true;
    }
    return false;
  } catch (err) {
    console.error(`[SCAVENGER] Error checking history for Level ${level}:`, err.message);
    return false;
  }
}

export function startScavengerScheduler(client) {
  console.log('[SCAVENGER] Initializing Scavenger Hunt Scheduler...');

  levelsConfig.forEach(config => {
    const targetDate = new Date(config.time);
    
    // Check state and schedule
    const checkAndAct = async () => {
      const alreadyPosted = await hasBeenPosted(client, config.level);
      if (alreadyPosted) {
        console.log(`[SCAVENGER] Level ${config.level} has already been posted. Skipping.`);
        return;
      }

      const now = Date.now();
      if (now >= targetDate.getTime()) {
        console.log(`[SCAVENGER] Past scheduled time for Level ${config.level}. Posting now...`);
        try {
          await postLevel(config);
        } catch (err) {
          console.error(`[SCAVENGER] Failed to post Level ${config.level}:`, err.message);
        }
      } else {
        console.log(`[SCAVENGER] Level ${config.level} is scheduled for ${targetDate.toLocaleString()}`);
        schedule.scheduleJob(targetDate, async () => {
          console.log(`[SCAVENGER] Scheduled trigger fired for Level ${config.level}!`);
          try {
            const doubleCheck = await hasBeenPosted(client, config.level);
            if (doubleCheck) {
              console.log(`[SCAVENGER] Level ${config.level} was already posted. Aborting duplicate.`);
              return;
            }
            await postLevel(config);
          } catch (err) {
            console.error(`[SCAVENGER] Failed to post Level ${config.level} during scheduled task:`, err.message);
          }
        });
      }
    };

    checkAndAct().catch(err => console.error(`[SCAVENGER] Error in checkAndAct for Level ${config.level}:`, err));
  });
}
