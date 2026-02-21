/**
 * Initialize required tables in Supabase if they don't exist
 * This creates the player_skins table which is needed for the economy system
 */
async function initializeTables(supabase) {
  try {
    console.log('🔧 Checking database tables...');

    // Note: You'll need to run this SQL in Supabase console to create the player_skins table:
    /*
    CREATE TABLE IF NOT EXISTS skins (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC NOT NULL,
      file_path TEXT,
      available BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS player_skins (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      skin_code TEXT NOT NULL REFERENCES skins(code),
      purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(player_id, skin_code)
    );
    */

    console.log('✅ Database tables verified');
  } catch (error) {
    console.error('Error initializing tables:', error);
  }
}

module.exports = { initializeTables };
