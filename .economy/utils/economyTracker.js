/**
 * Economy Tracker Utility
 * Handles logging transactions to player_economy_data and player_economy_history
 */

/**
 * Track a transaction for a player
 * Updates running totals in player_economy_data and logs to player_economy_history
 */
async function trackTransaction(supabase, playerId, transactionType, amount, details = null) {
  try {
    // Get current player economy data or create new row
    // Get current player economy data
    const { data: currentData, error: selectError } = await supabase
      .from('player_economy_data')
      .select('*')
      .eq('player_id', playerId)
      .single();

    // CRITICAL FIX: explicit error handling
    if (selectError && selectError.code !== 'PGRST116') {
      console.error(`[EconomyTracker] Aborting transaction for ${playerId} due to read error:`, selectError);
      return false; // ABORT. Do not overwrite with 0.
    }

    let updateData = {};

    // Determine which field to increment based on transaction type
    switch (transactionType) {
      case 'tax':
        updateData.total_tax_paid = (currentData?.total_tax_paid || 0) + amount;
        break;
      case 'gamble_win':
        updateData.total_gambling_won = (currentData?.total_gambling_won || 0) + amount;
        break;
      case 'gamble_loss':
        updateData.total_gambling_lost = (currentData?.total_gambling_lost || 0) + amount;
        break;
      case 'donate':
        updateData.total_donated = (currentData?.total_donated || 0) + amount;
        break;
      case 'transfer':
        updateData.total_transferred = (currentData?.total_transferred || 0) + amount;
        break;
      case 'gift':
        // Gifts are logged to history but do not affect running totals like trasferred/donated
        break;
      case 'buy':
        // Purchases are logged to history.
        // If a total_spent column exists in the future, update it here.
        break;
      default:
        console.error(`Unknown transaction type: ${transactionType}`);
        return false;
    }

    // Upsert into player_economy_data
    const { error: upsertError } = await supabase
      .from('player_economy_data')
      .upsert(
        {
          player_id: playerId,
          ...updateData,
        },
        { onConflict: 'player_id' }
      );

    if (upsertError) {
      console.error(`Error upserting economy data for player ${playerId}:`, upsertError);
      return false;
    }

    // Insert into player_economy_history
    const { error: historyError } = await supabase
      .from('player_economy_history')
      .insert([
        {
          player_id: playerId,
          transaction_type: transactionType,
          amount: amount,
          details: details,
        },
      ]);

    if (historyError) {
      console.error(`Error inserting history for player ${playerId}:`, historyError);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in trackTransaction:', error);
    return false;
  }
}

/**
 * Get player economy data with fallback to zeros
 */
async function getPlayerEconomyData(supabase, playerId) {
  try {
    const { data } = await supabase
      .from('player_economy_data')
      .select('*')
      .eq('player_id', playerId)
      .single();

    // Return data with defaults if null
    return {
      total_tax_paid: data?.total_tax_paid || 0,
      total_gambling_won: data?.total_gambling_won || 0,
      total_gambling_lost: data?.total_gambling_lost || 0,
      total_donated: data?.total_donated || 0,
      total_transferred: data?.total_transferred || 0,
    };
  } catch (error) {
    // Return all zeros if no data exists
    return {
      total_tax_paid: 0,
      total_gambling_won: 0,
      total_gambling_lost: 0,
      total_donated: 0,
      total_transferred: 0,
    };
  }
}

module.exports = { trackTransaction, getPlayerEconomyData };
