import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';

export default {
    name: 'rr',
    description: 'Play Russian Roulette for money and timeouts.',
    async execute(message, args, client) {
        // Help Subcommand
        if (args[0] === 'help') {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('Russian Roulette Rules')
                .addFields(
                    { name: '🔫 How to Play', value: '`?rr <amount|all> <@user|nmc>`', inline: true },
                    { name: '💰 Payouts', value: '**PVP**: Winner takes bet (10% fee)\n**PVE (NMC)**: Win = **4x** Bet', inline: true },
                    { name: '⏱️ Timeouts (Loser)', value: '< 10k: **30m**\n10k-50k: **2h**\n> 50k: **4h**', inline: false },
                    { name: '📜 Mechanics', value: '• 6 Chambers, 1 Bullet.\n• 3 Turns each.\n• Failure to shoot = Forfeit.', inline: false }
                )
                .setFooter({ text: 'Risk everything.' });
            return message.reply({ embeds: [embed] });
        }

        if (args.length < 2) return message.reply('Usage: `?rr <amount|all> <@user | nmc>` or `?rr help`');

        await message.channel.sendTyping();

        // Initialize logic
        try {
            // Fetch challenger stats first for "all" logic
            const { data: challenger } = await client.supabase.from('players').select('id').eq('discord_id', message.author.id).single();
            if (!challenger) return message.reply('You are not registered in the economy system.');

            const { data: cStats } = await client.supabase.from('player_stats').select('total_income').eq('player_id', challenger.id).single();

            // Bet Logic
            let amount = 0;
            if (args[0].toLowerCase() === 'all') {
                amount = cStats.total_income;
                if (amount <= 0) return message.reply('You have no money to bet!');
            } else {
                amount = parseFloat(args[0]);
            }

            if (isNaN(amount) || amount <= 0) return message.reply('Enter a valid amount.');
            if (cStats.total_income < amount) return message.reply('You have insufficient balance.');

            const COMPANY_ID = '1453737415318573280'; // Verify ID
            const rawTarget = args[1].toLowerCase();

            // Determine target
            let targetUser = message.mentions.users.first();
            let isCompany = false;

            if (rawTarget === 'nmc' || (targetUser && targetUser.id === COMPANY_ID)) {
                isCompany = true;
            } else if (targetUser && targetUser.id === client.user.id) {
                isCompany = true;
            }

            if (!isCompany && (!targetUser || targetUser.bot)) {
                return message.reply('Please mention a valid user or type "nmc" to play against the company.');
            }

            if (!isCompany && targetUser.id === message.author.id) return message.reply('You cannot play against yourself!');

            // Initialize Players
            const players = [message.author]; // 0: Challenger
            let targetId = null;
            let targetData = null;

            if (isCompany) {
                // Check Company Balance (Need to pay out 3x)
                const { data: guild } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
                const maxPayout = amount * 4;
                const companyBalance = parseFloat(guild?.guild_income || 0);

                if (companyBalance < maxPayout) {
                    return message.reply(`The Company (NMC) cannot afford a 4x payout! Company Balance: $${Math.floor(companyBalance)}`);
                }
                players.push({ id: COMPANY_ID, username: 'NMC', bot: true, toString: () => 'NMC' }); // Mock user for NMC
                targetId = COMPANY_ID;

                // Start Game Immediately for PVE
                startGame(client, message, players, amount, challenger, null, true);

            } else {
                // PVP Validation
                const { data: tData } = await client.supabase.from('players').select('id').eq('discord_id', targetUser.id).single();
                if (!tData) return message.reply('Target player is not registered.');
                targetData = tData;

                const { data: tStats } = await client.supabase.from('player_stats').select('total_income').eq('player_id', targetData.id).single();
                if (tStats.total_income < amount) return message.reply('Target has insufficient balance.');

                players.push(targetUser);
                targetId = targetUser.id;

                // Send Challenge
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('accept').setLabel('Accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('reject').setLabel('Reject').setStyle(ButtonStyle.Danger)
                );

                const challengeMsg = await message.reply({
                    content: `${targetUser}, ${message.author} challenges you to Russian Roulette for **$${amount.toLocaleString()}**!\n**Loser gets a timeout!**\n< 10k: 30m | 10k-50k: 2h | 50k+: 4h`,
                    components: [row]
                });

                const collector = challengeMsg.createMessageComponentCollector({ time: 60000 });

                collector.on('collect', async (i) => {
                    if (i.user.id !== targetUser.id) {
                        return i.reply({ content: 'Not your challenge!', flags: MessageFlags.Ephemeral });
                    }


                    if (i.customId === 'reject') {
                        await i.update({ content: `${targetUser} rejected the challenge.`, components: [] });
                        return collector.stop();
                    }

                    // Accepted
                    await i.update({ content: `**Challenge Accepted!**`, components: [] }); // Remove buttons
                    collector.stop();
                    startGame(client, message, players, amount, challenger, targetData, false);
                });
            }

        } catch (err) {
            console.error(err);
            message.reply('An error occurred while setting up the game.');
        }
    }
};

async function startGame(client, message, players, amount, challengerDb, targetDb, isCompany) {
    const gameMsg = await message.channel.send(`**Russian Roulette**\nLoading the chamber...\nhttps://media.tenor.com/x6dpuRtKHD4AAAAC/russian-roulette-gun.gif`);

    setTimeout(async () => {
        try {
            const bulletPos = Math.floor(Math.random() * 6); // 0-5

            // Game State
            let currentTurn = 0; // 0 for Challenger, 1 for Target
            let chamber = 0;

            await gameMsg.edit(`**Russian Roulette**\nChamber Loaded. ${players[currentTurn]} starts.`);

            gameLoop(client, message, gameMsg, players, currentTurn, chamber, bulletPos, amount, challengerDb, targetDb, isCompany);
        } catch (e) {
            console.error("Error starting RR game loop:", e);
            message.reply("Failed to start the game loop.");
        }
    }, 2000); // 2s delay
}

async function gameLoop(client, message, gameMsg, players, currentTurn, chamber, bulletPos, amount, challengerDb, targetDb, isCompany) {
    const currentPlayer = players[currentTurn];
    const isBot = isCompany && currentTurn === 1;

    // Button
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('shoot').setLabel('Shoot').setStyle(ButtonStyle.Danger).setEmoji('🔫')
    );

    if (isBot) {
        await gameMsg.edit({
            content: `**Round ${chamber + 1}/6**\n${currentPlayer} is aiming...`,
            components: []
        });

        setTimeout(async () => {
            handleShoot(client, message, gameMsg, players, currentTurn, chamber, bulletPos, amount, challengerDb, targetDb, isCompany, true);
        }, 2000);

    } else {
        await gameMsg.edit({
            content: `**Round ${chamber + 1}/6**\n${currentPlayer}, it's your turn. Pull the trigger.`,
            components: [row]
        });

        // Create Collector
        const filter = i => i.customId === 'shoot' && i.user.id === currentPlayer.id;
        const collector = gameMsg.createMessageComponentCollector({ filter, time: 60000, max: 1 });

        collector.on('collect', async (i) => {
            try {
                await i.deferUpdate();
                handleShoot(client, message, gameMsg, players, currentTurn, chamber, bulletPos, amount, challengerDb, targetDb, isCompany, false);
            } catch (e) {
                console.error("Error in RR shoot collector:", e);
                gameMsg.channel.send("An error occurred processing the shot.");
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                await gameMsg.edit({ content: `⏱️ ${currentPlayer} was too scared to shoot! Game over.`, components: [] });
                await handleLoss(client, message, players, currentTurn, amount, challengerDb, targetDb, isCompany);
            }
        });
    }

}

async function handleShoot(client, message, gameMsg, players, currentTurn, chamber, bulletPos, amount, challengerDb, targetDb, isCompany, isBot) {
    const currentPlayer = players[currentTurn];

    if (chamber === bulletPos) {
        // BANG!
        await gameMsg.edit({ content: `**BANG!** 💥\n${currentPlayer} pulled the trigger and died!`, components: [] });

        // Handle Loss
        await handleLoss(client, message, players, currentTurn, amount, challengerDb, targetDb, isCompany);

    } else {
        // Click...
        await gameMsg.edit({ content: `*Click*... Empty. 😰`, components: [] });

        setTimeout(() => {
            try {
                // Next Turn
                const nextTurn = (currentTurn + 1) % 2;
                const nextChamber = chamber + 1;

                if (nextChamber >= 6) {
                    gameMsg.channel.send("Wait... the gun jammed? (Logic Error: Bullet should have fired)");
                    return;
                }

                gameLoop(client, message, gameMsg, players, nextTurn, nextChamber, bulletPos, amount, challengerDb, targetDb, isCompany);
            } catch (e) {
                console.error("Error in RR next turn timeout:", e);
            }
        }, 1500);
    }
}

async function handleLoss(client, message, players, loserIndex, amount, challengerDb, targetDb, isCompany) {
    const loser = players[loserIndex];
    const winnerIndex = (loserIndex + 1) % 2;
    const winner = players[winnerIndex];

    // Timeout Calculation
    let timeoutDuration = 0;
    if (amount < 10000) timeoutDuration = 30 * 60 * 1000; // 30m
    else if (amount < 50000) timeoutDuration = 2 * 60 * 60 * 1000; // 2h
    else timeoutDuration = 4 * 60 * 60 * 1000; // 4h

    // Apply Timeout logic
    if (!loser.bot) {
        try {
            const member = await message.guild.members.fetch(loser.id);
            if (member) {
                if (member.moderatable) {
                    await member.timeout(timeoutDuration, 'Lost Russian Roulette');
                    message.channel.send(`🚫 ${loser} has been timed out for ${timeoutDuration / (60 * 1000)} minutes!`);
                } else {
                    message.channel.send(`⚠️ I tried to timeout ${loser}, but I don't have permission! (Check my role hierarchy)`);
                }
            }
        } catch (e) {
            console.error('Failed to timeout user:', e);
            message.channel.send(`Could not timeout ${loser} (Error: ${e.message}).`);
        }
    }

    // Money Logic
    let winnings = 0;
    let fee = 0;

    if (isCompany) {
        // PVE Logic
        // If User Wins: Gets 5x Bet. Company Pays 5x.
        // If User Loses: Company Gets Bet. User Loses Bet.
        if (!winner.bot) {
            // User Won against Company
            winnings = amount * 4;
            // Company pays winnings
        } else {
            // Company Won (User Lost)
            // User lost 'amount'. Company gains 'amount'.
            winnings = amount;
        }
    } else {
        // PVP Logic
        // Standard: Winner +90%, Loser -100%. 10% Fee.
        fee = amount * 0.1;
        winnings = amount - fee;
    }

    try {
        const winnerId = winnerIndex === 0 ? challengerDb.id : (targetDb ? targetDb.id : null);
        const loserId = loserIndex === 0 ? challengerDb.id : (targetDb ? targetDb.id : null);

        const updatePromises = [];

        // Update Winner
        if (!winner.bot) {
            updatePromises.push((async () => {
                const { data: wStats } = await client.supabase.from('player_stats').select('total_income').eq('player_id', winnerId).single();
                await client.supabase.from('player_stats').update({ total_income: wStats.total_income + winnings }).eq('player_id', winnerId);
                await trackTransaction(client.supabase, winnerId, 'gamble_win', winnings, `Won Russian Roulette vs ${loser.username || 'NMC'}`);
            })());
        } else {
            // Company Wins use same table as updates, so we might need to be careful if multiple guild updates
            // But here winner is company, so we update guild income
            updatePromises.push((async () => {
                const { data: guild } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
                const newIncome = (parseFloat(guild?.guild_income) || 0) + amount;
                await client.supabase.from('approved_guilds').update({ guild_income: newIncome }).eq('guild_id', message.guildId);
            })());
        }

        // Update Loser
        if (!loser.bot) {
            updatePromises.push((async () => {
                const { data: lStats } = await client.supabase.from('player_stats').select('total_income').eq('player_id', loserId).single();
                await client.supabase.from('player_stats').update({ total_income: lStats.total_income - amount }).eq('player_id', loserId);
                await trackTransaction(client.supabase, loserId, 'gamble_loss', amount, `Lost Russian Roulette vs ${winner.username || 'NMC'}`);
            })());
        } else {
            // Company Loses
            updatePromises.push((async () => {
                const { data: guild } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
                // Bug fix: The user wins 4x the bet. The company must deduct that same 4x amount (which is `winnings`).
                const newIncome = (parseFloat(guild?.guild_income) || 0) - winnings;
                await client.supabase.from('approved_guilds').update({ guild_income: newIncome }).eq('guild_id', message.guildId);
            })());
        }

        // Guild Fee (PVP Only)
        if (!isCompany) {
            updatePromises.push((async () => {
                const { data: guild } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
                await client.supabase.from('approved_guilds').update({ guild_income: (parseFloat(guild?.guild_income) || 0) + fee }).eq('guild_id', message.guildId);
            })());
        }

        await Promise.all(updatePromises);

        message.channel.send(`💰 ${winner} wins **$${winnings.toLocaleString()}**!`);

    } catch (err) {
        console.error('Error in money transfer:', err);
        message.channel.send('CRITICAL: An error occurred during money transfer. Please contact admin.');
    }
}
