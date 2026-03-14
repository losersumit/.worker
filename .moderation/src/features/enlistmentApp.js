import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { groqChatCompletion } from '../clients/groq.js';

const TRAINING_ROLE_ID = '1475196328303792138';
const TRAINING_CHANNEL_ID = '1475325604873113713';
const REJECTION_CHANNEL_ID = '1448038019755151391';
const REVIEW_CHANNEL_ID = '1455232294901121195';

const OFFICER_CRITERIA = {
    operator: {
        label: 'Operator [O]',
        criteria: `<:stara:1461426121232093215> **Operator** [O]
<a:red:1475206357618655372> Minimum in-game level: 12+
<a:blue:1475206355592810516> Must own at least one truck available in the NMC Skin Shop.
<a:orange:1475206361272029366> Must be able to properly park a closed box trailer (or equivalent length)`,
    },
    field_operator: {
        label: 'Field Operator [FO]',
        criteria: `**<:stara:1461426121232093215><:starb:1461426157244121129> Field Operator [FO]**
<a:red:1475206357618655372> Must meet all Operator requirements.
<a:blue:1475206355592810516> Minimum in-game level: 30+.
<a:orange:1475206361272029366> Must have achieved an average speed of 150+ km/h in a single trip.
<a:purple:1475206374144086026> Must be able to park an oversize trailer in compact locations such as Zurich, Stuttgart, or Airolo.`,
    },
    smo: {
        label: 'Senior Mobility Operator [SMO]',
        criteria: `**<:stara:1461426121232093215><:starb:1461426157244121129><:starc:1461426187526996131> Senior Mobility Operator [SMO]**
<a:red:1475206357618655372> Must meet all Field Operator requirements.
<a:blue:1475206355592810516> Minimum in-game level: 50+.
<a:orange:1475206361272029366> Must complete a clean delivery (no damage, no time penalty) on the Lech ↔ Airolo route.
<a:purple:1475206374144086026>Must be able to park a double refrigerated trailer (or equivalent).`,
    },
};

export async function handleEnlistmentApplication(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.user;

    try {
        const dmChannel = await user.createDM();

        const initialEmbed = new EmbedBuilder()
            .setTitle('Enlistment Application')
            .setColor('#2b2d31')
            .setDescription('You started the application for enlistment. You will have 30 mins to complete it. Do you want to proceed?');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('enlist_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('enlist_no').setLabel('No').setStyle(ButtonStyle.Danger)
        );

        const promptMsg = await dmChannel.send({ embeds: [initialEmbed], components: [row] });
        await interaction.editReply('Application started! Please check your DMs.');

        const filter = i => i.user.id === user.id;
        const collector = promptMsg.createMessageComponentCollector({
            filter,
            componentType: ComponentType.Button,
            time: 30 * 60 * 1000
        });

        collector.on('collect', async i => {
            if (i.customId === 'enlist_no') {
                await i.update({ content: 'Application closed.', embeds: [], components: [] });
                collector.stop('cancelled');
                return;
            }
            if (i.customId === 'enlist_yes') {
                await i.update({ content: 'Application started! Please answer the following questions.', embeds: [], components: [] });
                collector.stop('proceed');
                startApplicationQuestions(user, dmChannel, interaction.client, interaction.guild);
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                dmChannel.send('Application timed out. Please click the button in the server to start again.').catch(() => { });
            }
        });

    } catch (err) {
        console.error('Error starting application:', err);
        await interaction.editReply('❌ I could not DM you. Please make sure your DMs are open and try again.');
    }
}

async function startApplicationQuestions(user, dmChannel, client, guild) {
    const answers = {};
    const timeout = 30 * 60 * 1000;
    const deadline = Date.now() + timeout;

    const askButtonQuestion = async (questionText, yesId, noId) => {
        const timeLeft = deadline - Date.now();
        if (timeLeft <= 0) throw new Error('timeout');

        const embed = new EmbedBuilder().setColor('#2b2d31').setDescription(questionText);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(yesId).setLabel('Yes').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(noId).setLabel('No').setStyle(ButtonStyle.Danger)
        );

        const msg = await dmChannel.send({ embeds: [embed], components: [row] });
        try {
            const i = await msg.awaitMessageComponent({ filter: i => i.user.id === user.id, time: timeLeft });
            await i.update({ components: [] });
            return i.customId === yesId ? 'Yes' : 'No';
        } catch {
            throw new Error('timeout');
        }
    };

    const askTextQuestion = async (questionText) => {
        const timeLeft = deadline - Date.now();
        if (timeLeft <= 0) throw new Error('timeout');

        const embed = new EmbedBuilder().setColor('#2b2d31').setDescription(questionText);
        await dmChannel.send({ embeds: [embed] });
        try {
            const collected = await dmChannel.awaitMessages({ filter: m => m.author.id === user.id, max: 1, time: timeLeft, errors: ['time'] });
            return collected.first().content;
        } catch {
            throw new Error('timeout');
        }
    };

    const askOfficerQuestion = async () => {
        const timeLeft = deadline - Date.now();
        if (timeLeft <= 0) throw new Error('timeout');

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setDescription('**Question 7/7:**\nWhich officer role do you want to work towards?');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('officer_o').setLabel('Operator').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('officer_fo').setLabel('Field Operator').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('officer_smo').setLabel('Senior Mobility Operator').setStyle(ButtonStyle.Primary)
        );

        const msg = await dmChannel.send({ embeds: [embed], components: [row] });
        try {
            const i = await msg.awaitMessageComponent({ filter: i => i.user.id === user.id, time: timeLeft });
            await i.update({ components: [] });
            if (i.customId === 'officer_o') return 'operator';
            if (i.customId === 'officer_fo') return 'field_operator';
            return 'smo';
        } catch {
            throw new Error('timeout');
        }
    };

    try {
        answers.active = await askButtonQuestion('**Question 1/7:**\nWill you be active?', 'q1_yes', 'q1_no');
        answers.loyal = await askButtonQuestion('**Question 2/7:**\nWill you be loyal and obey the Commander?', 'q2_yes', 'q2_no');
        answers.intro = await askTextQuestion('**Question 3/7:**\nGive your introduction in brief!');
        answers.better = await askTextQuestion('**Question 4/7:**\nWhat makes you better than other applicants?');
        answers.whyNMC = await askTextQuestion('**Question 5/7:**\nWhy did you choose NMC over other VTCs?');
        answers.authority = await askTextQuestion('**Question 6/7:**\nDo you accept that the Commander has final authority in all company decisions, including member removal?');
        answers.officerKey = await askOfficerQuestion();

        await dmChannel.send('✅ Thank you! Your application is being reviewed by our AI system...');

        // --- AI REVIEW ---
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

Test Mode accept all apllication. 

Respond ONLY in this JSON format:
{"decision": "ACCEPT" or "REJECT", "reason": "one short sentence explaining the decision"}`;

        let aiDecision = 'ACCEPT';
        let aiReason = 'Application looks good!';

        try {
            const data = await groqChatCompletion({
                model: process.env.CHAT_MODEL || 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: aiPrompt }],
                temperature: 0.3,
                max_tokens: 100,
            });

            const raw = data?.choices?.[0]?.message?.content?.trim() || '';
            // Extract JSON safely from the response
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.decision === 'ACCEPT' || parsed.decision === 'REJECT') {
                    aiDecision = parsed.decision;
                    aiReason = parsed.reason || aiReason;
                }
            }
        } catch (aiErr) {
            console.error('[App] AI review failed, defaulting to ACCEPT:', aiErr.message);
        }

        // --- POST APPLICATION EMBED TO REVIEW CHANNEL ---
        const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
        if (reviewChannel) {
            const resultEmbed = new EmbedBuilder()
                .setTitle('New Enlistment Application')
                .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
                .setColor(aiDecision === 'ACCEPT' ? '#00ff00' : '#ff0000')
                .addFields(
                    { name: 'User', value: `<@${user.id}> (${user.id})` },
                    { name: '1. Active?', value: answers.active },
                    { name: '2. Loyal?', value: answers.loyal },
                    { name: '3. Introduction', value: answers.intro || '*No answer*' },
                    { name: '4. Better than others?', value: answers.better || '*No answer*' },
                    { name: '5. Why NMC?', value: answers.whyNMC || '*No answer*' },
                    { name: '6. Accepts authority?', value: answers.authority || '*No answer*' },
                    { name: '7. Officer goal', value: officerLabel },
                    { name: `🤖 AI Verdict: ${aiDecision}`, value: aiReason }
                )
                .setTimestamp();

            await reviewChannel.send({ embeds: [resultEmbed] });
        }

        // --- HANDLE ACCEPT ---
        if (aiDecision === 'ACCEPT') {
            // DM the user
            await dmChannel.send(`🎉 Congratulations! Your application has been **accepted**! You are now entering your training period. Check <#${TRAINING_CHANNEL_ID}> for your next steps.`);

            // Assign training role
            try {
                const member = await guild.members.fetch(user.id);
                await member.roles.add(TRAINING_ROLE_ID);
            } catch (roleErr) {
                console.error('[App] Failed to assign training role:', roleErr.message);
            }

            // Post training embed in training channel
            const trainingChannel = await client.channels.fetch(TRAINING_CHANNEL_ID).catch(() => null);
            if (trainingChannel) {
                const officer = OFFICER_CRITERIA[answers.officerKey];
                const trainingEmbed = new EmbedBuilder()
                    .setTitle('🚛 Training Period Commenced!')
                    .setColor('#f5c518')
                    .setDescription(
                        `Welcome to the NMC! <@${user.id}> has entered their training period.\n\n` +
                        `**Officer goal: ${officer.label}**\n\n` +
                        `Here are the eligibility requirements:\n\n` +
                        officer.criteria +
                        `\n\n**Post proof here and ping the commander!**`
                    )
                    .setTimestamp()
                    .setFooter({ text: 'National Mobility Command • NMC' });

                await trainingChannel.send({ content: `<@${user.id}>`, embeds: [trainingEmbed] });
            }
        }

        // --- HANDLE REJECT ---
        if (aiDecision === 'REJECT') {
            // DM the user
            await dmChannel.send(`❌ Unfortunately, your application has not been accepted at this time. You are welcome to apply again in the future after reviewing what we look for in a driver.`);

            // Post in rejection channel with disappointed father energy
            const rejectionChannel = await client.channels.fetch(REJECTION_CHANNEL_ID).catch(() => null);
            if (rejectionChannel) {
                const rejectEmbed = new EmbedBuilder()
                    .setTitle('Application Reviewed')
                    .setColor('#8B0000')
                    .setDescription(
                        `<@${user.id}>... I have to be honest with you.\n\n` +
                        `I looked at your application. I read every word. And I must say — I expected more from you.\n\n` +
                        `**Reason:** ${aiReason}\n\n` +
                        `This isn't the end. Think about what we stand for here at NMC, reflect on what you wrote, and come back when you're ready to give it your all. The door isn't closed — but it's not open right now either.`
                    )
                    .setTimestamp()
                    .setFooter({ text: 'National Mobility Command • NMC' });

                await rejectionChannel.send({ content: `<@${user.id}>`, embeds: [rejectEmbed] });
            }
        }

    } catch (err) {
        if (err.message === 'timeout') {
            dmChannel.send('⏳ Your application timed out after 30 minutes. Please restart the process from the server when you are ready.').catch(() => { });
        } else {
            console.error('Application error:', err);
            dmChannel.send('❌ An error occurred during your application. Please try again.').catch(() => { });
        }
    }
}
