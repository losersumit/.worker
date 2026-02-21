const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'help',
  description: 'Shows all available economy commands',
  async execute(message, args, client) {
    await message.channel.sendTyping(); // instant feedback

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('🤖 TOE Economy Bot Commands')
      .setDescription('Here are the available commands to manage your wealth and play games.')
      .addFields(
        {
          name: '💵 Economy',
          value:
            '`?me`\nCheck your balance and stats.\n' +
            '`?transfer <amount|all> <@user>`\nSend money to another player.\n' +
            '`?my skins`\nView your owned skins.',
          inline: false
        },
        {
          name: '🎲 Games',
          value:
            '`Coinflip`\n`?cf help`\n' +
            '`Russian Roulette`\n`?rr help`\n' +
            '`Roulette`\n`?rl help`',
          inline: false
        },
        {
          name: '🤝 Community',
          value:
            '`?donate <amount|all>`\nDonate to NMC.\n' +
            '`?help`\nShow this help message.',
          inline: false
        }
      )
      .setFooter({ text: 'TOE Economy • Gamble Responsibly' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  },
};

