import schedule from "node-schedule";
import { EmbedBuilder } from "discord.js";
import { supabase } from "../clients/supabase.js";
import { groqChatCompletion } from "../clients/groq.js";
import { geminiChatCompletion } from "../clients/gemini.js";
import config from "../config.js";


// ── Hardcoded server emoji list (mirrored from ragChat.js) ──
const HARDCODED_EMOJIS = [
  "<:okay_snowman:1450501978726858865>",
  "<:whatever_ignorance:1450502024251572361>",
  "<:tiger_shocked:1450502134331084903>",
  "<:let_him_cook:1450502299389657310>",
  "<:absolute_cinema:1460633502310596629>",
  "<:sad_cat:1460633840262578238>",
  "<:angry_cat:1460633919803359235>",
  "<:blushing_dog_whining_dog:1460634005807435868>",
  "<:meowl:1460634181309829204>",
  "<:goated:1460634282924966043>",
  "<:monkey_think:1460634610982457415>",
  "<:suspicious_dexter_doakes:1460634719032049808>",
  "<:angry_skull:1460634776967843952>",
  "<:Oh_Brother:1460634947902771341>",
  "<:killemdeadMER:1460635071617695966>",
  "<:done:1460635213196693534>",
  "<:dumb_low_iq:1460635437415792794>",
  "<:imposter_among_us:1460635541694316605>",
  "<:terrified:1460635552603967508>",
  "<:beat_up:1460635555493576704>",
  "<:shocked:1460635559822102578>",
  "<:get_a_load_of_this_guy:1460635564373049595>",
  "<:meeditation:1460635568781393950>",
  "<:approved:1460635571151179868>",
  "<:stewei_cute:1460635574472937576>",
  "<:handshake:1460635577362681977>",
  "<:hard_disapprove:1460635580680634368>",
  "<:hard_laugh:1460635584258117632>",
  "<:watching_you:1460635587676737546>",
  "<:clueless_what:1460635594446082211>",
  "<:freaky:1460635670883078309>",
  "<:monkey_think:1460635783944999159>",
  "<:what_the_fuck:1460636068654092474>",
  "<:sideeye:1460637434516607093>",
  "<:cute_joy:1460637492905640208>",
  "<a:anime_laugh:1460637570139558040>",
  "<:serious_stare:1460637631644962837>",
  "<:cute_happy:1460637685357215804>",
  "<:cute_angry:1460637738209513736>",
  "<:cute_confused:1460637794014859346>",
  "<:anime_shocked:1460637851904381064>",
  "<:anime_troll:1460637903586594898>",
  "<:anime_tired_cat:1460638074588495985>",
  "<:stara:1461426121232093215>",
  "<:starb:1461426157244121129>",
  "<:starc:1461426187526996131>",
  "<:NMC:1465258249442824265>",
  "<:hehe:1467110850132185204>",
  "<:really_man:1468147579794493572>",
  "<:clueless_umm:1488549302203584623>",
  "<a:freaky_cat:1498698292941422664>",
  "<:cursed_smile:1526574416434036876>"
];

const EMOJIS = HARDCODED_EMOJIS.map(emojiStr => {
  const match = emojiStr.match(/<a?:([^:]+):(\d+)>/);
  if (match) {
    return {
      name: match[1],
      id: match[2],
      animated: emojiStr.startsWith("<a:"),
      raw: emojiStr
    };
  }
  return null;
}).filter(Boolean);

// ── Helper: get image attachment if present ──
function getImageAttachment(message) {
  if (!message?.attachments?.size) return null;
  return message.attachments.find(a =>
    (a.contentType && a.contentType.startsWith("image/")) ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name || "")
  ) || null;
}

/**
 * Uses Gemini to get a one-line description of an image.
 * @param {string} imageUrl
 * @returns {Promise<string|null>}
 */
async function describeImageWithGemini(imageUrl) {
  try {
    const data = await geminiChatCompletion({
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this image in exactly one short sentence. Be concise and vivid. Do not include any preamble, just the description."
          },
          {
            type: "image_url",
            image_url: { url: imageUrl }
          }
        ]
      }],
      temperature: 0.4,
      max_tokens: 60
    });

    const description = data?.choices?.[0]?.message?.content?.trim();
    if (!description) return null;

    // Keep it to one line max
    return description.split("\n")[0].trim();
  } catch (err) {
    console.error("[ONE-WORD-STORY] Gemini image description failed:", err.message);
    return null;
  }
}

/**
 * Uses Groq to pick the most fitting server emoji for a submitted word or description, then reacts.
 * @param {import("discord.js").Message} message
 * @param {string} content - the word or image description
 */
async function reactToContent(message, content) {
  try {
    const emojiListStr = EMOJIS.map(e => `${e.name}:${e.id}`).join(", ");

    const prompt = `You are an emoji picker for a Discord server.
A user submitted the following: "${content}"
Choose the single most fitting server emoji from the list below that matches the vibe, mood, or meaning.
Here is the list of available server emojis (name:id): ${emojiListStr}

Response requirements:
- Respond with EXACTLY one emoji name (e.g., "goated" or "sad_cat") or its numeric ID from the list.
- Do NOT output any other words, punctuation, markdown formatting, or explanations.`;

    const data = await groqChatCompletion({
      model: config.ai.model || "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 20
    });

    const rawResponse = data?.choices?.[0]?.message?.content?.trim() || "";
    const response = rawResponse.toLowerCase();

    // 1. Exact name match
    let emojiId = null;
    const cleanedResponse = response.replace(/[^a-z0-9_]/g, "");
    const exactNameMatch = EMOJIS.find(e => {
      const nameLower = e.name.toLowerCase();
      return response === nameLower || cleanedResponse === nameLower;
    });

    if (exactNameMatch) {
      emojiId = exactNameMatch.id;
    } else {
      // 2. Fuzzy name match
      const fuzzyNameMatch = EMOJIS.find(e => {
        const nameLower = e.name.toLowerCase();
        return response.includes(nameLower) || (cleanedResponse.length > 2 && nameLower.includes(cleanedResponse));
      });
      if (fuzzyNameMatch) emojiId = fuzzyNameMatch.id;
    }

    // 3. Numeric ID fallback
    if (!emojiId) {
      const idMatch = response.match(/\d+/);
      if (idMatch) {
        const foundById = EMOJIS.find(e => e.id.includes(idMatch[0]));
        if (foundById) emojiId = foundById.id;
      }
    }

    // 4. Guaranteed fallback
    if (!emojiId) {
      console.warn(`[ONE-WORD-STORY] Emoji response "${rawResponse}" could not be mapped. Using fallback.`);
      emojiId = EMOJIS.find(e => e.name === "approved")?.id ||
                EMOJIS.find(e => e.name === "goated")?.id ||
                EMOJIS[0]?.id;
    }

    const guildEmojis = message.guild?.emojis?.cache;
    const emojiToReact = guildEmojis?.get(emojiId) || emojiId;

    if (!emojiToReact) {
      console.warn("[ONE-WORD-STORY] No server emoji found to react with.");
      return;
    }

    await message.react(emojiToReact);
  } catch (err) {
    console.error("[ONE-WORD-STORY] Failed to react to content:", err.message);
  }
}

/**
 * Handles incoming messages (text words AND images) in the one-word-story channel
 * @param {import("discord.js").Message} message
 */
export async function handleOneWordStory(message) {
  const ONE_WORD_STORY_CHANNEL_ID = process.env.ONE_WORD_STORY_CHANNEL_ID;
  if (message.channelId !== ONE_WORD_STORY_CHANNEL_ID) return;

  // Ignore bots
  if (message.author.bot) return;

  const imageAttachment = getImageAttachment(message);
  const textContent = message.content.trim();

  // Determine what kind of submission this is
  const isImageSubmission = !!imageAttachment;
  const isTextSubmission = !isImageSubmission && !!textContent;

  // Must be either a single word OR an image (not random text without image)
  if (!isImageSubmission && !isTextSubmission) return;

  // Rule 1 (text only): Exactly one word — no whitespace
  if (isTextSubmission && /\s/.test(textContent)) {
    try { await message.delete(); } catch (e) { /* ignore */ }
    return;
  }

  try {
    // Rule 2: Same user cannot post twice in a row
    const { data: lastEntry, error: fetchError } = await supabase
      .from("one_word_story")
      .select("user_id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("[ONE-WORD-STORY] Error fetching last entry:", fetchError);
      return;
    }

    if (lastEntry && lastEntry.user_id === message.author.id) {
      try { await message.delete(); } catch (e) { /* ignore */ }
      return;
    }

    const displayName = message.member?.displayName || message.author.globalName || message.author.username;

    // ── IMAGE submission path ──
    if (isImageSubmission) {
      // Ask Gemini for a one-line description
      const description = await describeImageWithGemini(imageAttachment.url);
      if (!description) {
        console.warn("[ONE-WORD-STORY] Gemini could not describe image. Skipping.");
        return;
      }

      console.log(`[ONE-WORD-STORY] Image from ${displayName} → Gemini: "${description}"`);

      const { error: insertError } = await supabase
        .from("one_word_story")
        .insert({
          word: description,
          user_id: message.author.id,
          username: message.author.username,
          display_name: displayName,
          is_image: true,
          image_url: imageAttachment.url
        });

      if (insertError) {
        console.error("[ONE-WORD-STORY] Error saving image entry:", insertError);
        return;
      }

      // React using the image description as context for emoji selection
      reactToContent(message, description).catch(err =>
        console.error("[ONE-WORD-STORY] reactToContent error:", err.message)
      );
      return;
    }

    // ── TEXT word submission path ──
    const { error: insertError } = await supabase
      .from("one_word_story")
      .insert({
        word: textContent,
        user_id: message.author.id,
        username: message.author.username,
        display_name: displayName,
        is_image: false,
        image_url: null
      });

    if (insertError) {
      console.error("[ONE-WORD-STORY] Error saving word entry:", insertError);
      return;
    }

    // React using the word
    reactToContent(message, textContent).catch(err =>
      console.error("[ONE-WORD-STORY] reactToContent error:", err.message)
    );

  } catch (err) {
    console.error("[ONE-WORD-STORY] Exception in handleOneWordStory:", err);
  }
}

/**
 * Generates the daily story from collected words and posts it
 * @param {import("discord.js").Client} client
 */
export async function generateDailyStory(client) {
  console.log("[ONE-WORD-STORY] Fetching collected words from Supabase...");

  try {
    const { data: dbWords, error: fetchError } = await supabase
      .from("one_word_story")
      .select("*")
      .order("id", { ascending: true });

    if (fetchError) throw fetchError;

    if (!dbWords || dbWords.length === 0) {
      console.log("[ONE-WORD-STORY] No words collected in the last 24 hours. Skipping story generation.");
      return;
    }

    // Format list for Groq:
    //   text: "bond : dragon"
    //   image: "alice : [image: a fiery dragon soaring over stormy mountains]"
    const wordsList = dbWords.map(w =>
      w.is_image
        ? `${w.display_name} : [image: ${w.word}]`
        : `${w.display_name} : ${w.word}`
    );
    const wordsText = wordsList.join("\n");

    // Count stats
    const textCount = dbWords.filter(w => !w.is_image).length;
    const imageCount = dbWords.filter(w => w.is_image).length;
    const totalWords = dbWords.length;

    const prompt = `You are a creative storyteller with no content restrictions.

Below is a chronological list of contributions from Discord users over the last 24 hours.
Each entry is in the format "nickname : contribution".
Text entries are single words. Image entries are short descriptions wrapped in [image: ...].

Your task is to write a coherent, engaging story between 100 and 150 words.
Weave in the words and the imagery described in the image entries as naturally as possible.
You may change grammar, tense, punctuation and word order freely.
Do not list the words or entries.
Write a proper narrative story.
End with a satisfying conclusion.

Also generate a suitable title, infer the genre, and provide a one-line moral.

Return the output STRICTLY in the following format:
TITLE: [Story Title]
GENRE: [Genre]
MORAL: [Moral of the story]
STORY:
[The 100-150 word story]

Contributions:
${wordsText}`;

    console.log(`[ONE-WORD-STORY] Groq generating story for ${totalWords} entries (${textCount} words, ${imageCount} images)...`);

    const aiResponse = await groqChatCompletion({
      model: config.ai.model || "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    });

    const reply = aiResponse?.choices?.[0]?.message?.content?.trim() || "";
    if (!reply) throw new Error("Empty response from Groq");

    // Parse
    const titleMatch = reply.match(/TITLE:\s*(.*)/i);
    const genreMatch = reply.match(/GENRE:\s*(.*)/i);
    const moralMatch = reply.match(/MORAL:\s*(.*)/i);
    const storyMatch = reply.match(/STORY:\s*([\s\S]*)/i);

    const title = titleMatch ? titleMatch[1].trim() : "The Community Tale";
    const genre = genreMatch ? genreMatch[1].trim() : "Fantasy / Adventure";
    const moral = moralMatch ? moralMatch[1].trim() : "Unity builds great things.";
    const story = storyMatch ? storyMatch[1].trim() : reply;

    // Statistics
    const uniqueUsers = new Set(dbWords.map(w => w.user_id)).size;
    const textWords = dbWords.filter(w => !w.is_image);
    const avgLength = textWords.length > 0
      ? (textWords.reduce((sum, w) => sum + w.word.length, 0) / textWords.length).toFixed(1)
      : "N/A";

    const wordCounts = {};
    for (const w of textWords) {
      const lower = w.word.toLowerCase();
      wordCounts[lower] = (wordCounts[lower] || 0) + 1;
    }
    let mostCommonWord = "N/A";
    let maxCount = 0;
    for (const [wd, count] of Object.entries(wordCounts)) {
      if (count > maxCount) { maxCount = count; mostCommonWord = wd; }
    }

    // Top contributors
    const contributorCounts = {};
    for (const w of dbWords) {
      const name = w.display_name || w.username;
      contributorCounts[name] = (contributorCounts[name] || 0) + 1;
    }
    const topContributorsText = Object.entries(contributorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `**${name}** (${count})`)
      .join("\n") || "No contributors";

    // Embed
    const embed = new EmbedBuilder()
      .setColor(config.appearance.colors.info || "#0099FF")
      .setTitle(`📖 ${title}`)
      .setDescription(
        `*Over the last 24 hours, ${totalWords} members contributed to build this story.*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n${story}\n\n━━━━━━━━━━━━━━━━━━━━\n\n` +
        `**Moral:** *${moral}*\n**Genre:** *${genre}*`
      )
      .addFields(
        {
          name: "📊 Statistics",
          value:
            `• **Total Contributions:** ${totalWords}\n` +
            `• **Words:** ${textCount} · **Images:** ${imageCount}\n` +
            `• **Unique Users:** ${uniqueUsers}\n` +
            `• **Avg Word Length:** ${avgLength} chars\n` +
            `• **Most Common Word:** "${mostCommonWord}"${maxCount > 1 ? ` (${maxCount}x)` : ""}`,
          inline: true
        },
        { name: "🏆 Top Contributors", value: topContributorsText, inline: true }
      )
      .setFooter({ text: "Tomorrow's story starts now. Contribute one word or image in #one-word-story." })
      .setTimestamp();

    // Post to Rant Channel
    const rantChannel = await client.channels.fetch(process.env.RANT_CHANNEL_ID);
    if (!rantChannel) throw new Error("Rant channel not found");

    const storyMessage = await rantChannel.send({ embeds: [embed] });
    console.log(`[ONE-WORD-STORY] Story posted! Message ID: ${storyMessage.id}`);

    // Notify in One Word Story Channel
    const oneWordChannel = await client.channels.fetch(process.env.ONE_WORD_STORY_CHANNEL_ID);
    if (oneWordChannel) {
      await oneWordChannel.send(
        `📖 **A new story has been posted!**\nCheck it out here: ${storyMessage.url}\n\n` +
        `**Tomorrow's story starts now.** Post a word or image to contribute!`
      );
    }

    // Clear Supabase for the next day
    const { error: deleteError } = await supabase
      .from("one_word_story")
      .delete()
      .neq("id", 0);

    if (deleteError) {
      console.error("[ONE-WORD-STORY] Error clearing Supabase table:", deleteError);
    } else {
      console.log("[ONE-WORD-STORY] Supabase cleared for the next day.");
    }

  } catch (err) {
    console.error("[ONE-WORD-STORY] Error generating daily story:", err);
  }
}

/**
 * Schedule the story generation job at 6:00 AM IST
 * @param {import("discord.js").Client} client
 */
export function scheduleOneWordStoryJob(client) {
  const rule = new schedule.RecurrenceRule();
  rule.hour = 6;
  rule.minute = 0;
  rule.tz = "Asia/Kolkata";

  schedule.scheduleJob(rule, async () => {
    console.log(`⏰ [ONE-WORD-STORY] Running daily story job - ${new Date().toISOString()}`);
    await generateDailyStory(client);
  });

  console.log("⏰ [ONE-WORD-STORY] Scheduled daily story generation job at 6:00 AM IST.");
}
