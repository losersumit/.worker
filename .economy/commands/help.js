import { EmbedBuilder } from 'discord.js';

export default {
  name: 'help',
  description: 'Shows all available economy commands',
  async execute(message, args, client) {
    await message.channel.sendTyping();

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('🤖 NMC Economy Bot Commands')
      .setDescription('Here are the available commands to manage your wealth and play games.')
      .addFields(
        {
          name: '💵 Economy',
          value:
            '`?me`\nCheck your balance and stats.\n' +
            '`?me @user`\nCheck another player\'s balance.\n' +
            '`?transfer <amount|all> <@user>`\nSend money to another player.\n' +
            '`?donate <amount|all>`\nDonate money to NMC treasury.\n' +
            '`?my skins`\nView your owned skins.\n' +
            '`?guild`\nView guild treasury & top 5 richest.\n' +
            '`?stats`\nView your statistics for all games.',
          inline: false
        },
        {
          name: '🎲 Games',
          value: '`?gamehelp`\nView information and rules for all available games.',
          inline: false
        },
        {
          name: '🏦 Tax & Economy Rules',
          value:
            '• **Daily Tax (10%)**: Deducted from **Bank Balance** at 12 AM. *Exempt if under €50,000.*\n' +
            '• **Game Tax (20%)**: Deducted from **Gamble Winnings**. ',
          inline: false
        }
      )
      .setFooter({ text: 'NMC Economy • Gamble Responsibly' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },
};
