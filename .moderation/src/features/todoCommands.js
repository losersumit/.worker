import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { supabase } from '../clients/supabase.js';
import { resolveAttachmentFromLink } from '../utils/discordUtils.js';

const COMMANDER_ROLE_ID = process.env.COMMANDER_ROLE_ID || '1448029016844931143';
const PARTNER_ROLE_ID = process.env.PARTNER_ROLE_ID || '1455251260763541731';

function hasModPermission(member) {
    if (!member) return false;
    return member.roles.cache.has(COMMANDER_ROLE_ID) || member.roles.cache.has(PARTNER_ROLE_ID);
}

export async function generateTodoEmbed(page = 0, client) {
    const limit = 5;
    const offset = page * limit;

    const { data: todos, count, error } = await supabase
        .from('todos')
        .select('*', { count: 'exact' })
        .order('id', { ascending: false })
        .range(offset, offset + limit - 1);

    if (error) {
        console.error('Database error in generateTodoEmbed:', error);
        throw error;
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📋 NMC Command Cabin Tasks')
        .setDescription('Below are the recently registered tasks. Use `◀️ Previous` and `Next ▶️` buttons to navigate.')
        .setTimestamp();

    if (!todos || todos.length === 0) {
        embed.setDescription('❌ There are no tasks recorded in the todo list.');
        
        const prevButton = new ButtonBuilder()
            .setCustomId(`todo_prev:${page - 1}`)
            .setLabel('◀️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);

        const nextButton = new ButtonBuilder()
            .setCustomId(`todo_next:${page + 1}`)
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);

        const row = new ActionRowBuilder().addComponents(prevButton, nextButton);
        return { embeds: [embed], components: [row] };
    }

    let descriptionText = '';
    
    for (const todo of todos) {
        let statusEmoji = '⏳';
        if (todo.status === 'Working') statusEmoji = '⚙️';
        else if (todo.status === 'Done') statusEmoji = '✅';
        else if (todo.status === 'Rejected') statusEmoji = '❌';

        let freshImageUrl = null;
        if (todo.image_url && todo.image_url.includes('discord.com/channels/')) {
            const resolved = await resolveAttachmentFromLink(client, todo.image_url);
            if (resolved) {
                freshImageUrl = resolved.url;
            }
        } else {
            freshImageUrl = todo.image_url;
        }

        descriptionText += `🔹 **#${todo.id}** — ${todo.task}\n`;
        descriptionText += `Status: ${statusEmoji} **${todo.status}** | Initiated by: **${todo.created_by}**`;
        if (freshImageUrl) {
            descriptionText += ` | 🖼️ [View Attachment](${freshImageUrl})`;
        }
        descriptionText += `\n*Added <t:${Math.floor(new Date(todo.created_at).getTime() / 1000)}:R>*\n\n`;
    }

    embed.setDescription(descriptionText.trim());
    embed.setFooter({ text: `Page ${page + 1} of ${Math.ceil(count / limit)} | Total Tasks: ${count}` });

    const prevButton = new ButtonBuilder()
        .setCustomId(`todo_prev:${page - 1}`)
        .setLabel('◀️ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page <= 0);

    const hasMore = count > (page + 1) * limit;
    const nextButton = new ButtonBuilder()
        .setCustomId(`todo_next:${page + 1}`)
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!hasMore);

    const row = new ActionRowBuilder().addComponents(prevButton, nextButton);

    return { embeds: [embed], components: [row] };
}

export async function handleTodoPagination(interaction, client) {
    const BONDS_CABIN_CHANNEL_ID = process.env.BONDS_CABIN_CHANNEL_ID || '1448038019755151391';
    if (interaction.channelId !== BONDS_CABIN_CHANNEL_ID) {
        return interaction.reply({ content: `❌ This interaction is only allowed in <#${BONDS_CABIN_CHANNEL_ID}>.`, ephemeral: true });
    }

    const parts = interaction.customId.split(':');
    const page = parseInt(parts[1]) || 0;

    try {
        const response = await generateTodoEmbed(page, client);
        await interaction.update(response);
    } catch (err) {
        console.error('Error in handleTodoPagination:', err);
        await interaction.reply({ content: '❌ Failed to paginate todo list.', ephemeral: true });
    }
}

export async function handleTodoCommand(message, args, client) {
    const BONDS_CABIN_CHANNEL_ID = process.env.BONDS_CABIN_CHANNEL_ID || '1448038019755151391';
    if (message.channelId !== BONDS_CABIN_CHANNEL_ID) {
        return message.reply(`❌ The \`!todo\` command can only be used in Bond's Cabin (<#${BONDS_CABIN_CHANNEL_ID}>).`);
    }

    const subCommand = args[0]?.toLowerCase();

    if (!subCommand || subCommand === 'list') {
        try {
            const response = await generateTodoEmbed(0, client);
            await message.reply(response);
        } catch (err) {
            console.error('Error fetching todos:', err);
            await message.reply('❌ Failed to fetch the todo list.');
        }
        return;
    }

    if (subCommand === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x2F3136)
            .setTitle('📋 Todo List Command System')
            .setDescription('Manage commands and tasks in Bond\'s Cabin.')
            .addFields(
                {
                    name: '⚡ Public Commands (Anyone)',
                    value: 
                        '`!todo` / `!todo list` - Show the 5 most recent tasks (paginated).\n' +
                        '`!todo add <text>` - Register a new task. You can optionally upload/attach an image with this message.\n' +
                        '`!todo help` - Show this menu.'
                },
                {
                    name: '🛡️ Admin Commands (Commander/Partner only)',
                    value:
                        '`!todo working <number>` - Set a task\'s status to Working.\n' +
                        '`!todo done <number>` - Set a task\'s status to Done.\n' +
                        '`!todo reject <number>` - Set a task\'s status to Rejected.\n' +
                        '`!todo delete <number>` - Permanently delete a task.'
                }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
        return;
    }

    if (subCommand === 'add') {
        const taskText = args.slice(1).join(' ').trim();
        if (!taskText) {
            return message.reply('❌ Usage: `!todo add <task description>` (you can also upload an image alongside the command).');
        }

        const attachment = message.attachments.first();
        // Save the Discord message link instead of raw attachment CDN URL to avoid 24h expiration
        const imageUrl = attachment ? `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}` : null;
        const initiatorName = message.member?.displayName || message.author.username;
        const initiatorId = message.author.id;

        try {
            const { data: todo, error } = await supabase
                .from('todos')
                .insert({
                    task: taskText,
                    created_by: initiatorName,
                    created_by_id: initiatorId,
                    image_url: imageUrl,
                    status: 'Not reviewed yet'
                })
                .select()
                .single();

            if (error) throw error;

            const embed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('✅ Task Registered')
                .setDescription(`Task **#${todo.id}** has been registered successfully!`)
                .addFields(
                    { name: '📝 Description', value: todo.task },
                    { name: '👤 Initiated By', value: `${todo.created_by} (<@${todo.created_by_id}>)`, inline: true },
                    { name: '⏳ Status', value: `\`${todo.status}\``, inline: true }
                )
                .setTimestamp();

            if (todo.image_url) {
                let freshImageUrl = null;
                if (todo.image_url.includes('discord.com/channels/')) {
                    const resolved = await resolveAttachmentFromLink(client, todo.image_url);
                    if (resolved) {
                        freshImageUrl = resolved.url;
                    }
                } else {
                    freshImageUrl = todo.image_url;
                }

                if (freshImageUrl) {
                    embed.setImage(freshImageUrl);
                }
            }

            await message.reply({ embeds: [embed] });
        } catch (err) {
            console.error('Error adding todo:', err);
            await message.reply('❌ Failed to add the task to the todo list.');
        }
        return;
    }

    // Admin commands
    const adminCommands = ['working', 'done', 'reject', 'delete'];
    if (adminCommands.includes(subCommand)) {
        if (!hasModPermission(message.member)) {
            return message.reply('❌ You do not have permission to use admin todo commands.');
        }

        const taskNumber = parseInt(args[1]);
        if (isNaN(taskNumber)) {
            return message.reply(`❌ Usage: \`!todo ${subCommand} <task_number>\`. Example: \`!todo ${subCommand} 5\``);
        }

        try {
            if (subCommand === 'delete') {
                const { data: deletedTodo, error } = await supabase
                    .from('todos')
                    .delete()
                    .eq('id', taskNumber)
                    .select()
                    .single();

                if (error || !deletedTodo) {
                    return message.reply(`❌ Task **#${taskNumber}** not found or already deleted.`);
                }

                await message.reply(`🗑️ Task **#${taskNumber}** has been permanently deleted.`);
            } else {
                let statusString = 'Not reviewed yet';
                if (subCommand === 'working') statusString = 'Working';
                else if (subCommand === 'done') statusString = 'Done';
                else if (subCommand === 'reject') statusString = 'Rejected';

                const { data: updatedTodo, error } = await supabase
                    .from('todos')
                    .update({ status: statusString })
                    .eq('id', taskNumber)
                    .select()
                    .single();

                if (error || !updatedTodo) {
                    return message.reply(`❌ Task **#${taskNumber}** not found.`);
                }

                let statusEmoji = '⏳';
                if (statusString === 'Working') statusEmoji = '⚙️';
                else if (statusString === 'Done') statusEmoji = '✅';
                else if (statusString === 'Rejected') statusEmoji = '❌';

                const embed = new EmbedBuilder()
                    .setColor(subCommand === 'done' ? 0x2ECC71 : subCommand === 'reject' ? 0xE74C3C : 0xF1C40F)
                    .setDescription(`System task **#${taskNumber}** status updated to: ${statusEmoji} **${statusString}**`)
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }
        } catch (err) {
            console.error(`Error executing todo ${subCommand}:`, err);
            await message.reply(`❌ Failed to execute todo ${subCommand} action.`);
        }
        return;
    }

    await message.reply('❌ Unknown todo subcommand. Use `!todo help` to see available commands.');
}
