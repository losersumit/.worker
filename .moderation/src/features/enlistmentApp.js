import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';

export async function handleEnlistmentApplication(interaction) {
    // Acknowledge the button click quickly so Discord doesn't timeout
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.user;

    try {
        const dmChannel = await user.createDM();

        const initialEmbed = new EmbedBuilder()
            .setTitle('Enlistment Application')
            .setColor('#2b2d31')
            .setDescription('You started the application for enlistment. You will have 30 mins to complete it. Do you want to proceed?');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('enlist_yes')
                .setLabel('Yes')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('enlist_no')
                .setLabel('No')
                .setStyle(ButtonStyle.Danger)
        );

        const promptMsg = await dmChannel.send({ embeds: [initialEmbed], components: [row] });

        // Let the user know to check DMs
        await interaction.editReply('Application started! Please check your DMs.');

        const filter = i => i.user.id === user.id;
        const collector = promptMsg.createMessageComponentCollector({
            filter,
            componentType: ComponentType.Button,
            time: 30 * 60 * 1000 // 30 minutes total timeout
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
                startApplicationQuestions(user, dmChannel, interaction.client);
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

async function startApplicationQuestions(user, dmChannel, client) {
    const answers = {};
    const timeout = 30 * 60 * 1000; // 30 mins from start
    const deadline = Date.now() + timeout;

    const askButtonQuestion = async (questionText, yesId, noId, stepName) => {
        const timeLeft = deadline - Date.now();
        if (timeLeft <= 0) throw new Error('timeout');

        const embed = new EmbedBuilder().setColor('#2b2d31').setDescription(questionText);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(yesId).setLabel('Yes').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(noId).setLabel('No').setStyle(ButtonStyle.Danger)
        );

        const msg = await dmChannel.send({ embeds: [embed], components: [row] });

        try {
            const i = await msg.awaitMessageComponent({
                filter: i => i.user.id === user.id,
                time: timeLeft
            });
            await i.update({ components: [] });
            return i.customId === yesId ? 'Yes' : 'No';
        } catch (err) {
            throw new Error('timeout');
        }
    };

    const askTextQuestion = async (questionText) => {
        const timeLeft = deadline - Date.now();
        if (timeLeft <= 0) throw new Error('timeout');

        const embed = new EmbedBuilder().setColor('#2b2d31').setDescription(questionText);
        await dmChannel.send({ embeds: [embed] });

        try {
            const collected = await dmChannel.awaitMessages({
                filter: m => m.author.id === user.id,
                max: 1,
                time: timeLeft,
                errors: ['time']
            });
            return collected.first().content;
        } catch (err) {
            throw new Error('timeout');
        }
    };

    try {
        // a) Will you be active?
        answers.active = await askButtonQuestion(
            '**Question 1/6:**\nWill you be active?',
            'q1_yes', 'q1_no'
        );

        // b) Will you be loyal and obey the Commander?
        answers.loyal = await askButtonQuestion(
            '**Question 2/6:**\nWill you be loyal and obey the Commander?',
            'q2_yes', 'q2_no'
        );

        // c) Give your introduction in brief!
        answers.intro = await askTextQuestion(
            '**Question 3/6:**\nGive your introduction in brief!'
        );

        // d) What makes you a better than other applicants?
        answers.better = await askTextQuestion(
            '**Question 4/6:**\nWhat makes you better than other applicants?'
        );

        // e) Why did you chose NMC over other VTCs?
        answers.whyNMC = await askTextQuestion(
            '**Question 5/6:**\nWhy did you choose NMC over other VTCs?'
        );

        // f) Do you accept that the Commander has final authority...
        answers.authority = await askTextQuestion(
            '**Question 6/6:**\nDo you accept that the Commander has final authority in all company decisions, including member removal?'
        );

        // All answered!
        await dmChannel.send('✅ Thank you! Your application has been submitted successfully.');

        // Send to channel 1455232294901121195
        const targetChannelId = '1455232294901121195';
        const targetChannel = await client.channels.fetch(targetChannelId);

        if (targetChannel) {
            const resultEmbed = new EmbedBuilder()
                .setTitle(`New Enlistment Application`)
                .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
                .setColor('#00ff00')
                .addFields(
                    { name: 'User Info', value: `<@${user.id}> (${user.id})` },
                    { name: '1. Will you be active?', value: answers.active },
                    { name: '2. Will you be loyal and obey the Commander?', value: answers.loyal },
                    { name: '3. Introduction', value: answers.intro || '*No answer provided*' },
                    { name: '4. What makes you better?', value: answers.better || '*No answer provided*' },
                    { name: '5. Why NMC?', value: answers.whyNMC || '*No answer provided*' },
                    { name: '6. Accepts Commander Authority?', value: answers.authority || '*No answer provided*' }
                )
                .setTimestamp();

            await targetChannel.send({ embeds: [resultEmbed] });
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
