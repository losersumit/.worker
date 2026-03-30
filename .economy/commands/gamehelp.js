import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { SYMBOLS } from './slot.js';

const PAGES = [
  // Page 0 — Table of contents
  () => new EmbedBuilder()
    .setColor(0x2F3136)
    .setTitle('🎮 Game Help — Contents')
    .setDescription(
      'Use the ◀ ▶ buttons to navigate pages.\n\n' +
      '**Page 1** — 🪙 Coinflip\n' +
      '**Page 2** — 🔫 Russian Roulette\n' +
      '**Page 3** — 🎰 Slots\n' +
      '**Page 4** — 🎡 Roulette'
    )
    .setFooter({ text: 'Page 1 / 5 • NMC Economy' }),

  // Page 1 — Coinflip
  () => new EmbedBuilder()
    .setColor(0xFFFF00)
    .setTitle('🪙 Coinflip')
    .addFields(
      { name: '💡 How to Play', value: '`?cf <amount|all> <@user|nmc>`\nChallenge another player or the company.', inline: false },
      { name: '💰 Payouts', value: '**PVP**: Winner takes bet (10% tax)\n**PVE (NMC)**: Standard 1:1', inline: true },
      { name: '📜 Mechanics', value: '• 50/50 Chance\n• Heads or Tails\n• Instant payout\n• Max bet: €10,000', inline: true }
    )
    .setFooter({ text: 'Page 2 / 5 • NMC Economy' }),

  // Page 2 — Russian Roulette
  () => new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('🔫 Russian Roulette')
    .addFields(
      { name: '💡 How to Play', value: '`?rr <amount|all> <@user|nmc>`\nChallenge another player or the company.', inline: false },
      { name: '💰 Payouts', value: '**PVP**: Winner takes bet (10% tax)\n**PVE (NMC)**: Win = **2x** Bet', inline: true },
      { name: '⏱️ Timeouts (Loser)', value: '< 10k: **30m**\n10k-50k: **2h**\n> 50k: **4h**', inline: true },
      { name: '📜 Mechanics', value: '• 6 Chambers, 1 Bullet\n• 3 Turns each\n• Failure to shoot = Forfeit', inline: false }
    )
    .setFooter({ text: 'Page 3 / 5 • NMC Economy' }),

  // Page 3 — Slots
  () => new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🎰 Slots')
    .addFields(
      { name: '💡 How to Play', value: 'Head to the **slots channel** and use the permanent slot machines.\nPress **Spin** and enter your bet amount.', inline: false },
      { name: '🏆 Triple Payouts', value: 
          `${SYMBOLS['777'].emoji} **777** — €100,000\n` +
          `${SYMBOLS['Seven'].emoji} **Seven** — €50,000\n` +
          `${SYMBOLS['Wild'].emoji} **Wild** — €35,000\n` +
          `${SYMBOLS['Dollar'].emoji} **Dollar** — €25,000\n` +
          `${SYMBOLS['Crown'].emoji} **Crown** — €15,000\n` +
          `${SYMBOLS['Bar'].emoji} **Bar** — €10,000\n` +
          `${SYMBOLS['Watermelon'].emoji} **Watermelon** — €7,000`, 
        inline: true 
      },
      { name: '✅ More Triples', value: 
          `${SYMBOLS['Apple'].emoji} **Apple** — €5,000\n` +
          `${SYMBOLS['Cherry'].emoji} **Cherry** — €3,500\n` +
          `${SYMBOLS['Lemon'].emoji} **Lemon** — €2,500\n` +
          `${SYMBOLS['Cards'].emoji} **Cards** — €2,000\n\n` +
          `*Double payouts also available for 2 matching symbols!*`, 
        inline: true 
      },
      { name: '📜 Mechanics', value: '• Bet any amount\n• 20% tax on winnings\n• Automated via button interactions', inline: false }
    )
    .setFooter({ text: 'Page 4 / 5 • NMC Economy' }),

  // Page 4 — Roulette
  () => new EmbedBuilder()
    .setColor(0x00AA55)
    .setTitle('🎡 Roulette')
    .addFields(
      { name: '💡 How to Play', value: 'Head to the **roulette channel** and use the permanent roulette tables.\n1. Press **Sit** → 2. **Add Bet** → 3. Choose an option → 4. Press **Ready**', inline: false },
      { name: '🎯 Bet Options', value: '**Red / Black** × 2\n**Even / Odd** × 2\n**1-18 / 19-36** × 2\n**1st12 / 2nd12 / 3rd12** × 3', inline: true },
      { name: '📜 Mechanics', value: '• Player vs House\n• Up to 5 players per table\n• 20% tax on winnings\n• 5 min inactivity = refund & reset', inline: true }
    )
    .setFooter({ text: 'Page 5 / 5 • NMC Economy' }),
];

export default {
  name: 'gamehelp',
  description: 'Shows help information for all games',
  async execute(message, args, client) {
    let currentPage = 0;
    const authorId = message.author.id;

    const buildRow = (page) => new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('gamehelp_prev')
        .setEmoji('◀')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('gamehelp_next')
        .setEmoji('▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === PAGES.length - 1),
    );

    const reply = await message.reply({
      embeds: [PAGES[currentPage]()],
      components: [buildRow(currentPage)],
    });

    // Set up a non-expiring collector (no time limit)
    const collector = reply.createMessageComponentCollector({
      filter: (i) => i.user.id === authorId,
    });

    collector.on('collect', async (interaction) => {
      if (interaction.customId === 'gamehelp_prev' && currentPage > 0) {
        currentPage--;
      } else if (interaction.customId === 'gamehelp_next' && currentPage < PAGES.length - 1) {
        currentPage++;
      }

      await interaction.update({
        embeds: [PAGES[currentPage]()],
        components: [buildRow(currentPage)],
      });
    });
  },
};
