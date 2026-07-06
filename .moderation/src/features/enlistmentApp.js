import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import { groqChatCompletion } from "../clients/groq.js";
import { supabase } from "../clients/supabase.js";
import config from "../config.js";

const TRAINING_ROLE_ID = process.env.TRAINEE_ROLE_ID || "1475196328303792138";
const TRAINING_CHANNEL_ID =
  process.env.TRAINING_CHANNEL_ID || "1475325604873113713";
const REJECTION_CHANNEL_ID =
  process.env.REJECTION_CHANNEL_ID || "1448038019755151391";
const REVIEW_CHANNEL_ID =
  process.env.REVIEW_CHANNEL_ID || "1462797901305745509";
const O_ROLE_ID = process.env.O_ROLE_ID || "1475314870802055421";
const FO_ROLE_ID = process.env.FO_ROLE_ID || "1475314865878077603";

const OFFICER_CRITERIA = {
  operator: {
    label: "Operator [O]",
    criteria: `<:stara:1461426121232093215> **Operator** [O]
        <a:red:1475206357618655372> Minimum in-game level: 12+
        <a:blue:1475206355592810516> Add [NMC] to your server nickname in Wanda Software & Main VTC server. (Optional)
        <a:orange:1475206361272029366> Park a closed box or trailer of equivalent length **properly**.
        <a:purple:1475206374144086026> Achieve a milestone of 2000 KMs in UVS by logging jobs in <#1460901549378375700> .`,
  },
  field_operator: {
    label: "Field Operator [FO]",
    criteria: `**<:stara:1461426121232093215><:starb:1461426157244121129> Field Operator [FO]**
        <a:red:1475206357618655372> Minimum in-game level: 30+.
        <a:blue:1475206355592810516> Achieve milestone of logging 25 jobs in  <#1460901549378375700> .
        <a:orange:1475206361272029366>  Achieve an average speed of 120+ km/h in a single trip with cargo weight over 50 tons.
        <a:purple:1475206374144086026> Park an oversize 5x3 trailer in Zurich, Stuttgart and Airolo **properly**.`,
  },
  smo: {
    label: "Senior Mobility Operator [SMO]",
    criteria: `**<:stara:1461426121232093215><:starb:1461426157244121129><:starc:1461426187526996131> Senior Mobility Operator [SMO]**
        <a:red:1475206357618655372> Minimum in-game level: 50+.
        <a:blue:1475206355592810516> Achieve Milestone of 10 clean runs (no penalties) in UVS.
        <a:orange:1475206361272029366> Submit a clean run (no penalties) on the Lech <-> Airolo route.
        <a:purple:1475206374144086026> Park any double trailer.`,
  },
};

export {
  OFFICER_CRITERIA,
  TRAINING_ROLE_ID,
  TRAINING_CHANNEL_ID,
  REJECTION_CHANNEL_ID,
};

export async function handleEnlistmentApplication(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.user;

  // 1. Database registration and Guild check
  const { data: playerData, error: playerError } = await supabase
    .from("players")
    .select("id, guild_id")
    .eq("discord_id", user.id)
    .maybeSingle();

  if (!playerData) {
    return interaction.editReply(
      "❌ You are not registered in the database. Please register first.",
    );
  }

  if (playerData.guild_id !== "1448027116074434593") {
    let guildName = "Unknown Guild";
    if (playerData.guild_id) {
      const { data: guildData } = await supabase
        .from("approved_guilds")
        .select("guild_name")
        .eq("guild_id", playerData.guild_id)
        .maybeSingle();
      if (guildData && guildData.guild_name) {
        guildName = guildData.guild_name;
      }
    }

    const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
    if (LOG_CHANNEL_ID) {
      try {
        const logChannel = await interaction.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (logChannel) {
          await logChannel.send({
            content: `<@${user.id}> from **${guildName}** tried to Apply.`
          });
        }
      } catch (logErr) {
        console.error("Failed to send log message:", logErr);
      }
    }

    return interaction.editReply(
      `❌ You are a registered driver in **${guildName}**. Please ask @losersumit to change your guild.`
    );
  }

  const BLOCKED_ROLES = [
    process.env.TRAINEE_ROLE_ID || "1475196328303792138",
    process.env.ENLISTED_ROLE_ID || "1482386008376086598",
  ];
  const member = interaction.member;

  if (BLOCKED_ROLES.some((roleId) => member.roles.cache.has(roleId))) {
    return interaction.editReply(
      "❌ You are already a Trainee or Enlisted member — you cannot apply again.",
    );
  }

  // 2. 2,000 km check
  const { data: statsData, error: statsError } = await supabase
    .from("player_stats")
    .select("total_distance_km")
    .eq("player_id", playerData.id)
    .maybeSingle();

  const totalKm = statsData ? (statsData.total_distance_km || 0) : 0;
  if (totalKm < 2000) {
    return interaction.editReply(
      `❌ You do not meet the enlistment requirements. You currently have **${totalKm.toLocaleString()} km** (minimum 2,000 km required in player_stats to apply).`,
    );
  }

  try {
    const dmChannel = await user.createDM();

    const initialEmbed = new EmbedBuilder()
      .setTitle("Enlistment Application")
      .setColor("#2b2d31")
      .setDescription(
        "You started the application for enlistment. You will have 30 mins to complete it. Do you want to proceed?",
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("enlist_yes")
        .setLabel("Yes")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("enlist_no")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger),
    );

    const promptMsg = await dmChannel.send({
      embeds: [initialEmbed],
      components: [row],
    });
    await interaction.editReply("Application started! Please check your DMs.");

    const filter = (i) => i.user.id === user.id;
    const collector = promptMsg.createMessageComponentCollector({
      filter,
      componentType: ComponentType.Button,
      time: 30 * 60 * 1000,
    });

    collector.on("collect", async (i) => {
      if (i.customId === "enlist_no") {
        await i.update({
          content: "Application closed.",
          embeds: [],
          components: [],
        });
        collector.stop("cancelled");
        return;
      }
      if (i.customId === "enlist_yes") {
        await i.update({
          content:
            "Application started! Please answer the following questions.",
          embeds: [],
          components: [],
        });
        collector.stop("proceed");
        startApplicationQuestions(
          user,
          dmChannel,
          interaction.client,
          interaction.guild,
        );
      }
    });

    collector.on("end", (collected, reason) => {
      if (reason === "time") {
        dmChannel
          .send(
            "Application timed out. Please click the button in the server to start again.",
          )
          .catch(() => {});
      }
    });
  } catch (err) {
    console.error("Error starting application:", err);
    await interaction.editReply(
      "❌ I could not DM you. Please make sure your DMs are open and try again.",
    );
  }
}

async function startApplicationQuestions(user, dmChannel, client, guild) {
  const answers = {};
  const timeout = 30 * 60 * 1000;
  const deadline = Date.now() + timeout;

  const askButtonQuestion = async (questionText, yesId, noId) => {
    const timeLeft = deadline - Date.now();
    if (timeLeft <= 0) throw new Error("timeout");
    const embed = new EmbedBuilder()
      .setColor("#2b2d31")
      .setDescription(questionText);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(yesId)
        .setLabel("Yes")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(noId)
        .setLabel("No")
        .setStyle(ButtonStyle.Danger),
    );
    const msg = await dmChannel.send({ embeds: [embed], components: [row] });
    try {
      const i = await msg.awaitMessageComponent({
        filter: (i) => i.user.id === user.id,
        time: timeLeft,
      });
      await i.update({ components: [] });
      return i.customId === yesId ? "Yes" : "No";
    } catch {
      throw new Error("timeout");
    }
  };

  const askTextQuestion = async (questionText) => {
    const timeLeft = deadline - Date.now();
    if (timeLeft <= 0) throw new Error("timeout");
    const embed = new EmbedBuilder()
      .setColor("#2b2d31")
      .setDescription(questionText);
    await dmChannel.send({ embeds: [embed] });
    try {
      const collected = await dmChannel.awaitMessages({
        filter: (m) => m.author.id === user.id,
        max: 1,
        time: timeLeft,
        errors: ["time"],
      });
      return collected.first().content;
    } catch {
      throw new Error("timeout");
    }
  };

  try {
    answers.active = await askButtonQuestion(
      "**Question 1/6:**\nWill you be active?",
      "q1_yes",
      "q1_no",
    );
    answers.loyal = await askButtonQuestion(
      "**Question 2/6:**\nWill you be loyal and obey the Commander?",
      "q2_yes",
      "q2_no",
    );
    answers.intro = await askTextQuestion(
      "**Question 3/6:**\nGive your introduction in brief!",
    );
    answers.better = await askTextQuestion(
      "**Question 4/6:**\nWhat makes you better than other applicants?",
    );
    answers.whyNMC = await askTextQuestion(
      "**Question 5/6:**\nWhy did you choose NMC over other VTCs?",
    );
    answers.authority = await askTextQuestion(
      "**Question 6/6:**\nDo you accept that the Commander has final authority in all company decisions, including member removal?",
    );
    answers.officerKey = "operator";

    await dmChannel.send(
      "✅ Application submitted! Waiting for someone to review it.",
    );

    // --- AI REVIEW (advisory only — humans make final call via buttons) ---
    const officerLabel = OFFICER_CRITERIA[answers.officerKey].label;
    const aiPrompt = `You are reviewing a driver enlistment application for a Virtual Trucking Company called National Mobility Command (NMC) in the game Truckers of Europe 3.

Applicant answers:
1. Will you be active? → ${answers.active}
2. Will you be loyal and obey the Commander? → ${answers.loyal}
3. Introduction: ${answers.intro}
4. What makes you better than others? → ${answers.better}
5. Why NMC over other VTCs? → ${answers.whyNMC}
6. Accepts Commander authority? → ${answers.authority}
7. Officer they want to become: ${officerLabel}

Based on these answers, decide if this applicant should be ACCEPTED or REJECTED.
A good applicant: is active, loyal, gives a genuine introduction, has a clear reason for joining, and accepts the Commander's authority.
A bad applicant: answered No to activity or loyalty, gave dismissive/joke answers, or shows no commitment.

Respond ONLY in this JSON format:
{"decision": "ACCEPT" or "REJECT", "reason": "one short sentence explaining the decision"}`;

    let aiDecision = "ACCEPT";
    let aiReason = "Application looks solid.";

    try {
      const data = await groqChatCompletion({
        model: config.ai.model,
        messages: [{ role: "user", content: aiPrompt }],
        temperature: 0.3,
        max_tokens: 100,
      });
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.decision === "ACCEPT" || parsed.decision === "REJECT") {
          aiDecision = parsed.decision;
          aiReason = parsed.reason || aiReason;
        }
      }
    } catch (aiErr) {
      console.error("[App] AI review failed:", aiErr.message);
    }

    // --- POST APPLICATION EMBED WITH ACCEPT/REJECT BUTTONS ---
    const reviewChannel = await client.channels
      .fetch(REVIEW_CHANNEL_ID)
      .catch(() => null);
    if (reviewChannel) {
      const resultEmbed = new EmbedBuilder()
        .setTitle("New Enlistment Application")
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setColor(aiDecision === "ACCEPT" ? "#00ff00" : "#ff4444")
        .addFields(
          { name: "User", value: `<@${user.id}> (${user.id})` },
          { name: "1. Active?", value: answers.active },
          { name: "2. Loyal?", value: answers.loyal },
          { name: "3. Introduction", value: answers.intro || "*No answer*" },
          {
            name: "4. Better than others?",
            value: answers.better || "*No answer*",
          },
          { name: "5. Why NMC?", value: answers.whyNMC || "*No answer*" },
          {
            name: "6. Accepts authority?",
            value: answers.authority || "*No answer*",
          },
          { name: "7. Officer goal", value: officerLabel },
          { name: `🤖 AI Suggestion: ${aiDecision}`, value: aiReason },
        )
        .setTimestamp();

      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`app_accept:${user.id}:${answers.officerKey}`)
          .setLabel("✅ Accept")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`app_reject:${user.id}`)
          .setLabel("❌ Reject")
          .setStyle(ButtonStyle.Danger),
      );

      await reviewChannel.send({
        embeds: [resultEmbed],
        components: [buttonRow],
      });
    }
  } catch (err) {
    if (err.message === "timeout") {
      dmChannel
        .send(
          "⏳ Your application timed out after 30 minutes. Please restart the process from the server when you are ready.",
        )
        .catch(() => {});
    } else {
      console.error("Application error:", err);
      dmChannel
        .send("❌ An error occurred during your application. Please try again.")
        .catch(() => {});
    }
  }
}

/**
 * Called from interactionCreate when ✅ Accept button is clicked.
 */
export async function executeApplicationAccept(
  interaction,
  userId,
  officerKey,
) {
  await interaction.deferUpdate();

  const guild = interaction.guild;
  const client = interaction.client;

  const officer = OFFICER_CRITERIA.operator;

  // Assign training role
  try {
    const member = await guild.members.fetch(userId);
    await member.roles.add(TRAINING_ROLE_ID);
  } catch (err) {
    console.error("[App Accept] Failed to assign training role:", err.message);
  }

  // DM the user
  try {
    const user = await client.users.fetch(userId);
    await user.send(
      `🎉 Congratulations! Your NMC application has been **accepted**! You are now entering your training period. Check <#${TRAINING_CHANNEL_ID}> for your next steps.`,
    );
  } catch {
    /* DMs may be closed */
  }

  // Post training embed
  const trainingChannel = await client.channels
    .fetch(TRAINING_CHANNEL_ID)
    .catch(() => null);
  if (trainingChannel) {
    const trainingEmbed = new EmbedBuilder()
      .setTitle("🚛 Training Period Commenced!")
      .setColor("#f5c518")
      .setDescription(
        `Welcome to the NMC! <@${userId}> has entered their training period.\n\n` +
          `**Officer goal: ${officer.label}**\n\n` +
          `Here are the eligibility requirements:\n\n` +
          officer.criteria +
          `\n\n**Post proof here and ping the commander!**`,
      )
      .setTimestamp()
      .setFooter({ text: "National Mobility Command • NMC" });

    await trainingChannel.send({
      content: `<@${userId}>`,
      embeds: [trainingEmbed],
    });
  }

  // Disable buttons on the review embed
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("accepted")
      .setLabel("✅ Accepted")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("na")
      .setLabel("❌ Reject")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );
  await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
}

/**
 * Called from interactionCreate when ❌ Reject button is clicked.
 */
export async function executeApplicationReject(interaction, userId) {
  await interaction.deferUpdate();

  const client = interaction.client;

  // DM the user
  try {
    const user = await client.users.fetch(userId);
    await user.send(
      `❌ Unfortunately, your NMC application has not been accepted at this time. Feel free to apply again once you've reflected on what we look for in a driver.`,
    );
  } catch {
    /* DMs may be closed */
  }

  // Post rejection embed with disappointed-father tone
  const rejectionChannel = await client.channels
    .fetch(REJECTION_CHANNEL_ID)
    .catch(() => null);
  if (rejectionChannel) {
    const rejectEmbed = new EmbedBuilder()
      .setTitle("Application Reviewed")
      .setColor("#8B0000")
      .setDescription(
        `<@${userId}>... I have to be honest with you.\n\n` +
          `I looked at your application. I read every word. And I must say — I expected more from you.\n\n` +
          `This isn't the end. Think about what we stand for here at NMC, reflect on what you wrote, and come back when you're ready to give it your all. The door isn't closed — but it's not open right now either.`,
      )
      .setTimestamp()
      .setFooter({ text: "National Mobility Command • NMC" });

    await rejectionChannel.send({
      content: `<@${userId}>`,
      embeds: [rejectEmbed],
    });
  }

  // Disable buttons on the review embed
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("na")
      .setLabel("✅ Accept")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("rejected")
      .setLabel("❌ Rejected")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );
  await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
}

/**
 * Called when the promote_me button is clicked.
 */
export async function handlePromotionRequest(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const member = interaction.member;
  const user = interaction.user;

  if (member.roles.cache.has(TRAINING_ROLE_ID)) {
    return interaction.editReply(
      "❌ You are already in a training/trial period.",
    );
  }

  let targetOfficerKey = null;
  if (member.roles.cache.has(FO_ROLE_ID)) {
    targetOfficerKey = "smo";

    // Check 10 clean deliveries constraint
    const { data: playerData } = await supabase
        .from('players')
        .select('id')
        .eq('discord_id', user.id)
        .maybeSingle();

    let cleanDeliveries = 0;
    if (playerData) {
        const { data: stats } = await supabase
            .from('player_stats')
            .select('clean_deliveries')
            .eq('player_id', playerData.id)
            .maybeSingle();
        if (stats) {
            cleanDeliveries = stats.clean_deliveries || 0;
        }
    }

    if (cleanDeliveries < 10) {
        return interaction.editReply(
            `❌ You cannot start a promotion trial to Senior Mobility Operator because you only have **${cleanDeliveries} clean deliveries** (minimum 10 required).`
        );
    }

  } else if (member.roles.cache.has(O_ROLE_ID)) {
    targetOfficerKey = "field_operator";

    // Check 25 logged runs constraint
    const { data: playerData } = await supabase
        .from('players')
        .select('id')
        .eq('discord_id', user.id)
        .maybeSingle();

    let runs = 0;
    if (playerData) {
        const { data: stats } = await supabase
            .from('player_stats')
            .select('runs')
            .eq('player_id', playerData.id)
            .maybeSingle();
        if (stats) {
            runs = stats.runs || 0;
        }
    }

    if (runs < 25) {
        return interaction.editReply(
            `❌ You cannot start a promotion trial to Field Operator because you only have **${runs} logged runs** (minimum 25 required).`
        );
    }

  } else {
    return interaction.editReply(
      "❌ You must be an Operator [O] or Field Operator [FO] to request a promotion.",
    );
  }

  const officer = OFFICER_CRITERIA[targetOfficerKey];

  // Give trainee role
  try {
    await member.roles.add(TRAINING_ROLE_ID);
  } catch (err) {
    console.error(
      "[Promotion Request] Failed to assign training role:",
      err.message,
    );
    return interaction.editReply(
      "❌ Failed to assign Trainee role. Please contact an Administrator.",
    );
  }

  // Post training embed in training channel and ping
  try {
    const client = interaction.client;
    const trainingChannel = await client.channels
      .fetch(TRAINING_CHANNEL_ID)
      .catch(() => null);
    if (trainingChannel) {
      const trainingEmbed = new EmbedBuilder()
        .setTitle("🚛 Promotion Trial Started!")
        .setColor("#f5c518")
        .setDescription(
          `Welcome to your promotion trial! <@${user.id}> has entered their training period for promotion.\n\n` +
            `**Target rank: ${officer.label}**\n\n` +
            `Here are the eligibility requirements:\n\n` +
            officer.criteria +
            `\n\n**Post proof here and ping the commander!**`,
        )
        .setTimestamp()
        .setFooter({ text: "National Mobility Command • NMC" });

      await trainingChannel.send({
        content: `<@${user.id}>`,
        embeds: [trainingEmbed],
      });
    }
  } catch (err) {
    console.error(
      "[Promotion Request] Failed to send training message:",
      err.message,
    );
  }

  return interaction.editReply(
    "✅ Promotion trial started! Trainee role assigned and training requirements posted in the training channel.",
  );
}
