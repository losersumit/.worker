/**
 * Realtime guild income listener
 * Updates voice channel name when guild_income changes
 */
let activeSubscription = null;

async function setupGuildIncomeListener(client, supabase, guildId, channelId) {
  console.log(`[REALTIME] 🔄 Initializing guild income listener for guild: ${guildId}`);

  // Initial Sync
  await syncIncome(client, supabase, guildId, channelId);

  // Start Subscription
  subscribeToChannel(client, supabase, guildId, channelId);
}

async function syncIncome(client, supabase, guildId, channelId) {
  try {
    const { data: guildData, error: fetchError } = await supabase
      .from('approved_guilds')
      .select('guild_income')
      .eq('guild_id', guildId)
      .single();

    if (fetchError) {
      console.error('[REALTIME] ❌ Failed initial fetch of guild income:', fetchError.message);
    } else if (guildData) {
      console.log(`[REALTIME] 📥 Initial sync: Income is $${guildData.guild_income}`);
      await updateChannelName(client, guildId, channelId, guildData.guild_income);
    }
  } catch (e) {
    console.error('[REALTIME] Sync error:', e);
  }
}

function subscribeToChannel(client, supabase, guildId, channelId) {
  if (activeSubscription) {
    try { activeSubscription.unsubscribe(); } catch (e) { /* ignore */ }
  }

  activeSubscription = supabase
    .channel(`guild_income_${guildId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'approved_guilds',
        filter: `guild_id=eq.${guildId}`,
      },
      (payload) => {
        console.log('[REALTIME] ⚡ Received UPDATE event');
        updateChannelName(client, guildId, channelId, payload.new.guild_income);
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[REALTIME] ✅ Connected! Listening for updates on guild_id=${guildId}`);
      } else if (status === 'CLOSED') {
        console.log('[REALTIME] 🔌 Disconnected. Reconnecting in 10m...');
        setTimeout(() => subscribeToChannel(client, supabase, guildId, channelId), 600000);
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[REALTIME] ❌ Connection Error:', err);
        console.log('[REALTIME] ⚠️ Retrying connection in 10m...');
        setTimeout(() => subscribeToChannel(client, supabase, guildId, channelId), 600000);
      } else if (status === 'TIMED_OUT') {
        console.error('[REALTIME] ⚠️ Connection Timed Out. Retrying in 10m...');
        setTimeout(() => subscribeToChannel(client, supabase, guildId, channelId), 600000);
      }
    });
}

/**
 * Update voice channel name with current guild income
 */
async function updateChannelName(client, guildId, channelId, guildIncome) {
  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      console.error(`[REALTIME] ❌ Guild ${guildId} not found`);
      return;
    }

    const channel = await guild.channels.fetch(channelId);

    if (channel && channel.isVoiceBased?.()) {
      const newName = `NMC = $${Math.floor(guildIncome || 0)}`;

      // Avoid API spam: only update if name is different
      if (channel.name !== newName) {
        await channel.setName(newName);
        console.log(`[REALTIME] ✏️ Channel renamed: "${newName}"`);
      } else {
        // console.log(`[REALTIME] Channel name already correct ("${newName}"), skipping update.`);
      }
    } else {
      console.error(`[REALTIME] ❌ Channel ${channelId} not found or is not a voice channel`);
    }
  } catch (error) {
    console.error('[REALTIME] ❌ Error updating channel name:', error.message);
  }
}

module.exports = { setupGuildIncomeListener, updateChannelName };

