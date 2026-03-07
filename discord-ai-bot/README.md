# Discord AI Bot (RAG)

## Setup
1. Create a PostgreSQL database and enable `pgvector`.
2. Run `src/db/schema.sql` against your database.
3. Fill `.env` with `DISCORD_TOKEN`, `OPENAI_API_KEY`, and `DATABASE_URL`.
4. Install dependencies:
   ```bash
   npm install
   ```
5. Start bot + API:
   ```bash
   node src/bot.js
   ```

## Commands
- `!ask <question>`: ask about historical server context.
- `!summary`: summarize the last 100 messages in channel.
- `!context`: show retrieved context snippets.

## API
- `GET /health`
- `POST /ask` with JSON body:
  ```json
  {
    "question": "why was john muted yesterday",
    "channelId": "1234567890",
    "hours": 24
  }
  ```
