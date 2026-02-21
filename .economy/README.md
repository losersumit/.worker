# NMC Economy Bot

A comprehensive Discord economy bot for the NMC server with Supabase integration.

## Features

- **?me** - View your economy stats (income, owned skins, donations, tax paid)
- **?shop** - Browse available truck skins with prices
- **?buy <code>** - Purchase a skin (auto-DM with 5-minute download window)
- **?cf <amount> <@user>** - Challenge another player to a coin flip with money at stake
- **?donate nmc <amount>** - Donate money to the NMC company
- **?transfer <amount> <@user>** - Transfer money to another player
- **Daily Tax** - 10% of all player income is automatically deducted daily and distributed to guilds
- **Donation Role** - Players who donate 250,000+ automatically receive the NMC Donor role

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   - Copy `.env.example` to `.env`
   - Fill in your Discord bot token, Supabase URL, and Supabase key
   - Add your guild ID

3. **Supabase Setup**
   Run these SQL commands in your Supabase SQL editor:
   
   ```sql
   -- Create skins table
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

   -- Create player_skins table
   CREATE TABLE IF NOT EXISTS player_skins (
     id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     skin_code TEXT NOT NULL REFERENCES skins(code),
     purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     UNIQUE(player_id, skin_code)
   );
   ```

4. **Start the Bot**
   ```bash
   npm start
   ```

## Command Usage

### ?me
Shows your current economy stats including:
- Total income
- Owned skins
- Total donations
- Tax paid
- Current level and stars

### ?shop
Displays all available truck skins with their prices and codes.

### ?buy <code>
Purchase a skin by providing its code. The skin will be DMed to you with a 5-minute expiration.

### ?cf <amount> <@user>
Challenge another player to a coin flip:
- First user accepts/rejects the challenge
- If accepted, challenged user picks Heads or Tails
- Bot flips a coin and transfers money
- 10% of bet amount goes to company

### ?donate nmc <amount>
Donate money to the NMC company. Players who donate 250,000+ receive a special role.

### ?transfer <amount> <@user>
Transfer money directly to another player.

## Daily Tax System

Every 24 hours, the bot automatically:
- Deducts 10% from every player's income
- Distributes collected tax to guild accounts
- Logs tax collection for records

To enable this, uncomment the tax scheduler in `index.js`.

## Notes

- Embeds are marked with `{put_embed_here}` - customize these to match your server theme
- Player registration is handled by an external bot (as mentioned in requirements)
- All monetary transactions are stored in Supabase
- Skin files are sent via Discord DM and auto-deleted after 5 minutes

## Troubleshooting

- **"You are not registered"**: The player registration bot needs to run first
- **"Insufficient balance"**: Player doesn't have enough money for the transaction
- **DM not sent**: Check bot permissions and if user has DMs enabled
