const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder } = require('discord.js');
const { trackTransaction } = require('../utils/economyTracker');

module.exports = {
    name: 'rl',
    description: 'Play Roulette against the Company (NMC)',
    async execute(message, args, client) {
        if (args[0] === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('Roulette Help')
                .setDescription('Bet on the roulette wheel! Standard European (Single Zero) rules apply.')
                .addFields(
                    { name: '🎲 Usage', value: '`?rl <amount|all> [number]`\n`?rl <amount|all>` (Opens selection menu)', inline: false },
                    { name: '💰 Payouts', value: '**Red/Black/Even/Odd/1-18/19-36**: 1:1 (x2)\n**Dozens (1st/2nd/3rd 12)**: 2:1 (x3)\n**Specific Number**: 36:1 (x37)', inline: false },
                )
                .setFooter({ text: 'Good luck!' });
            return message.reply({ embeds: [helpEmbed] });
        }

        if (!args[0]) return message.reply('Usage: `?rl <amount|all> [number]`');

        // --- 1. ARGUMENT PARSING & VALIDATION ---
        const rawAmount = args[0].toLowerCase();
        const specificNumberArg = args[1]; // Optional

        // Constants
        const COMPANY_ID = '1453737415318573280'; // Keeping same company ID reference as CF
        const ROULETTE_IMG = 'https://cdn.discordapp.com/attachments/1464745553559687393/1471034895295053896/vector-realistic-casino-roulette-table-wheel-chips-top-view-isolated-green-background.png?ex=698d7781&is=698c2601&hm=ce262a71c66a2a11c1f85a380943780f979c93e0d1312eb317a9fd2dbdb10f57';
        const SPINNING_GIF = 'https://cdn.discordapp.com/attachments/1455232294901121195/1471076088586174637/Untitled_design_2.gif?ex=698d9dde&is=698c4c5e&hm=7b0ee2462e6d17427a6b4314d8265ee2f5f591ccbb284e7734b7d9dfd741b47a';

        try {
            // Fetch Player Data
            const { data: player } = await client.supabase.from('players').select('id').eq('discord_id', message.author.id).single();
            if (!player) return message.reply('You are not registered in the economy system.');

            const { data: pStats } = await client.supabase.from('player_stats').select('total_income').eq('player_id', player.id).single();

            let amount = 0;
            if (rawAmount === 'all') {
                amount = pStats.total_income;
            } else {
                amount = parseFloat(rawAmount);
            }

            if (isNaN(amount) || amount <= 0) return message.reply('Enter a valid amount.');
            if (pStats.total_income < amount) return message.reply('You have insufficient balance.');

            // Fetch Company Data (to check if they exist, balance check happens AFTER game as per implementation details)
            const { data: guild } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
            if (!guild) return message.reply('This server is not initialized for the economy system.');


            // --- 2. GAME SETUP ---
            let betType = null; // 'number', 'color', 'parity', 'range', 'dozen'
            let betValue = null; // The specific choice (e.g., 7, 'red', 'even', '1-18')
            let multiplier = 0; // Payout multiplier (total return multiplier)

            // If specific number provided immediately
            if (specificNumberArg) {
                const num = parseInt(specificNumberArg);
                if (isNaN(num) || num < 0 || num > 36) {
                    return message.reply('Invalid number! Choose between 0-36.');
                }
                betType = 'number';
                betValue = num;
                multiplier = 37; // Pays 36:1 (Profit 36x, Total 37x)

                // Direct to spinning
                await runGame(client, message, amount, betType, betValue, multiplier, SPINNING_GIF, player, pStats);
            } else {
                // Show Betting Options UI
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle(`Roulette | Bet: $${amount.toLocaleString()}`)
                    .setImage(ROULETTE_IMG)
                    .setFooter({ text: 'Choose your bet' });

                // Button Rows
                // Row 1: Colors & Parity
                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('red').setLabel('Red 🔴').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('black').setLabel('Black ⚫').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('even').setLabel('Even').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('odd').setLabel('Odd').setStyle(ButtonStyle.Primary)
                );

                // Row 2: Ranges
                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('1-18').setLabel('1-18').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('19-36').setLabel('19-36').setStyle(ButtonStyle.Success)
                );

                // Row 3: Dozens
                const row3 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('1st 12').setLabel('1st 12').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('2nd 12').setLabel('2nd 12').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('3rd 12').setLabel('3rd 12').setStyle(ButtonStyle.Secondary)
                );

                const reply = await message.reply({ embeds: [embed], components: [row1, row2, row3] });

                const collector = reply.createMessageComponentCollector({ time: 30000 });

                collector.on('collect', async (interaction) => {
                    if (interaction.user.id !== message.author.id) {
                        return interaction.reply({ content: 'Not your game!', flags: MessageFlags.Ephemeral });
                    }

                    // Determine bet details from button
                    const id = interaction.customId;
                    if (['red', 'black', 'even', 'odd', '1-18', '19-36'].includes(id)) {
                        betType = 'simple'; // 1:1 payout
                        betValue = id;
                        multiplier = 2; // Pays 1:1 (Profit 1x, Total 2x)
                    } else if (['1st 12', '2nd 12', '3rd 12'].includes(id)) {
                        betType = 'dozen';
                        betValue = id;
                        multiplier = 3; // Pays 2:1 (Profit 2x, Total 3x)
                    }

                    // Clean up buttons and start game
                    await interaction.deferUpdate();
                    collector.stop(); // Stop listening

                    // Delete the buttons from original message before starting animation loop in runGame?
                    // actually runGame will likely edit a message or send a new one. 
                    // The request says "edit the same embed to remove the buttons and say 'Spinning the wheel'"

                    await runGame(client, message, amount, betType, betValue, multiplier, SPINNING_GIF, player, pStats, reply);
                });

                collector.on('end', (collected, reason) => {
                    if (reason === 'time') {
                        reply.edit({ content: 'Time expired!', components: [] });
                    }
                });
            }

        } catch (err) {
            console.error(err);
            message.reply('An error occurred while starting Roulette.');
        }
    },
};

/**
 * Core Game Logic & Animation
 */
async function runGame(client, message, amount, betType, betValue, multiplier, gifUrl, player, initialStats, existingMessage = null) {
    // 1. Prepare UI for Spinning
    const spinEmbed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle(`Roulette | Bet: $${amount.toLocaleString()}`)
        .setDescription(`**Spinning the wheel...**\nBet: ${formatBet(betType, betValue)}`)
        .setImage(gifUrl);

    let msg;
    if (existingMessage) {
        msg = await existingMessage.edit({ embeds: [spinEmbed], components: [] });
    } else {
        msg = await message.reply({ embeds: [spinEmbed] });
    }

    // 2. Wait 5.5 Seconds
    setTimeout(async () => {
        try {
            // 3. GENERATE RESULT
            const resultNum = Math.floor(Math.random() * 37); // 0 - 36
            const resultColor = getRouletteColor(resultNum);

            // 4. DETERMINE WIN/LOSS
            let won = false;

            if (betType === 'number') {
                won = (resultNum === betValue);
            } else if (betType === 'simple') {
                if (betValue === 'red') won = (resultColor === 'red');
                if (betValue === 'black') won = (resultColor === 'black');
                if (betValue === 'even') won = (resultNum !== 0 && resultNum % 2 === 0);
                if (betValue === 'odd') won = (resultNum !== 0 && resultNum % 2 !== 0);
                if (betValue === '1-18') won = (resultNum >= 1 && resultNum <= 18);
                if (betValue === '19-36') won = (resultNum >= 19 && resultNum <= 36);
            } else if (betType === 'dozen') {
                if (betValue === '1st 12') won = (resultNum >= 1 && resultNum <= 12);
                if (betValue === '2nd 12') won = (resultNum >= 13 && resultNum <= 24);
                if (betValue === '3rd 12') won = (resultNum >= 25 && resultNum <= 36);
            }

            // Re-fetch latest balances to ensure validity
            const { data: finalP } = await client.supabase.from('player_stats').select('total_income').eq('player_id', player.id).single();
            const { data: finalG } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();

            // Sanity check: does player still have the money? (Important for long waits)
            if ((finalP?.total_income || 0) < amount) {
                return msg.edit({ content: "❌ Transaction failed: Insufficient balance at end of spin.", embeds: [] });
            }

            // 5. DATABASE UPDATES
            let profit = 0;
            let companyNote = "";
            let finalResultText = "";

            if (won) {
                // Calculate Winnings
                const totalPayout = Math.floor(amount * multiplier);
                profit = totalPayout - amount; // Pure profit for the user

                if ((parseFloat(finalG?.guild_income) || 0) < profit) {
                    // Company Can't Pay
                    companyNote = "\n\n⚠️ **The Company cannot afford to pay you!**\nNo money was exchanged.";

                    // Update Stats Only (No money transfer)
                    await trackTransaction(client.supabase, player.id, 'gamble_win', 0, `Won Roulette (Company Defaults)`);
                    await client.supabase.from('player_stats').update({
                        total_gambling_won: (pStats.total_gambling_won || 0) + 1
                    }).eq('player_id', player.id);

                    finalResultText = `**Result:** ${resultNum} (${resultColor.toUpperCase()})\n**Outcome:** You Won! (x${multiplier})\n**Payout:** $0 ${companyNote}`;

                } else {
                    // Company Can Pay
                    // User Balance += Profit
                    await client.supabase.from('player_stats').update({ total_income: (finalP?.total_income || 0) + profit }).eq('player_id', player.id);
                    // Company Balance -= Profit
                    await client.supabase.from('approved_guilds').update({ guild_income: (parseFloat(finalG?.guild_income) || 0) - profit }).eq('guild_id', message.guildId);

                    // Track
                    await trackTransaction(client.supabase, player.id, 'gamble_win', profit, `Won Roulette vs Company`);

                    finalResultText = `**Result:** ${resultNum} (${resultColor.toUpperCase()})\n**Outcome:** You Won! (x${multiplier})\n**Payout:** $${totalPayout.toLocaleString()} (Profit: $${profit.toLocaleString()})`;
                }

            } else {
                // LOSS
                // User Balance -= Amount
                await client.supabase.from('player_stats').update({ total_income: (finalP?.total_income || 0) - amount }).eq('player_id', player.id);
                // Company Balance += Amount
                await client.supabase.from('approved_guilds').update({ guild_income: (parseFloat(finalG?.guild_income) || 0) + amount }).eq('guild_id', message.guildId);

                // Track
                await trackTransaction(client.supabase, player.id, 'gamble_loss', amount, `Lost Roulette vs Company`);

                finalResultText = `**Result:** ${resultNum} (${resultColor.toUpperCase()})\n**Outcome:** You Lost.\n**Loss:** $${amount.toLocaleString()}`;
            }

            // 6. FINAL EMBED
            const resultEmbed = new EmbedBuilder()
                .setColor(won ? 0x00FF00 : 0xFF0000)
                .setTitle(`Roulette Result`)
                .setDescription(finalResultText)
                .addFields(
                    { name: 'Bet Amount', value: `$${amount.toLocaleString()}`, inline: true },
                    { name: 'Chosen Option', value: `${formatBet(betType, betValue)}`, inline: true },
                    // { name: 'Multiplier', value: `x${multiplier}`, inline: true } // Included in description
                )
                .setFooter({ text: 'Better luck next time!' });

            await msg.edit({ embeds: [resultEmbed] });


        } catch (error) {
            console.error('Error in Roulette Game Loop:', error);
            msg.edit({ content: "An error occurred processing the result." });
        }
    }, 5500); // 5.5 seconds
}


// --- Helpers ---

function getRouletteColor(num) {
    if (num === 0) return 'green';
    const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    return redNums.includes(num) ? 'red' : 'black';
}

function formatBet(type, value) {
    if (type === 'simple') return value.charAt(0).toUpperCase() + value.slice(1);
    if (type === 'dozen') return value;
    if (type === 'number') return `Number ${value}`;
    return value;
}
