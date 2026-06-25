/**
 * Database Tools — Capability Module
 * Provides query access to Supabase player data, stats, VTCs, and leaderboards.
 */

import { findFaqAnswer } from '../faq.js';
import { getCached, setCached } from '../cache.js';

// ─── Tool Definitions ───────────────────────────────────────────────

export const definitions = [
    {
        type: 'function',
        function: {
            name: 'get_enlisted_count',
            description: 'Get the total number of currently enlisted drivers in NMC.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_driver_profile',
            description:
                'Get a specific driver\'s full profile: rank, KMs driven, jobs logged, wallet balance, ' +
                'VTC membership, level, and display name. Use when someone asks about a specific person\'s stats.',
            parameters: {
                type: 'object',
                properties: {
                    user_id: {
                        type: 'string',
                        description: 'The Discord user ID of the driver.',
                    },
                },
                required: ['user_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_rank_eligibility',
            description:
                'Check if a driver is eligible for a specific rank promotion. Fetches both the driver\'s ' +
                'current stats and the rank requirements, then compares them. Use when someone asks ' +
                '"am I eligible for X?" or "can I become X?".',
            parameters: {
                type: 'object',
                properties: {
                    user_id: {
                        type: 'string',
                        description: 'The Discord user ID of the driver to check.',
                    },
                    target_rank: {
                        type: 'string',
                        description: 'The rank to check eligibility for.',
                        enum: ['Operator', 'Field Operator', 'SMO'],
                    },
                },
                required: ['user_id', 'target_rank'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_leaderboard',
            description: 'Get the top drivers leaderboard sorted by KMs driven, total runs/jobs, or wallet balance.',
            parameters: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        description: 'What to sort the leaderboard by.',
                        enum: ['km', 'runs', 'wallet'],
                    },
                    limit: {
                        type: 'number',
                        description: 'Number of results to return (default 10, max 25).',
                    },
                },
                required: ['type'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_vtc_list',
            description: 'Get a list of all approved VTCs (guilds) in the UVS system with their status and stats.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_player',
            description: 'Fuzzy-search for a player by their display name. Use when someone asks about a player by name rather than ID.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The player name to search for (partial matches work).',
                    },
                },
                required: ['name'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_guild_stats',
            description: 'Get detailed stats for a specific VTC/guild: income, runs, net worth, member count.',
            parameters: {
                type: 'object',
                properties: {
                    guild_id: {
                        type: 'string',
                        description: 'The Discord guild ID of the VTC.',
                    },
                },
                required: ['guild_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_job_logs',
            description: 'Get recent job logs for a specific driver (their last deliveries/runs).',
            parameters: {
                type: 'object',
                properties: {
                    user_id: {
                        type: 'string',
                        description: 'The Discord user ID of the driver.',
                    },
                    limit: {
                        type: 'number',
                        description: 'Number of job logs to return (default 5, max 20).',
                    },
                },
                required: ['user_id'],
            },
        },
    },
];

// ─── Executor ───────────────────────────────────────────────────────

export async function execute(toolName, args, context) {
    const { supabase } = context;
    if (!supabase) return { error: 'Database not available.' };

    try {
        switch (toolName) {
            case 'get_enlisted_count': {
                const cached = getCached('enlisted_count');
                if (cached !== undefined) return cached;

                const { count, error } = await supabase
                    .from('players')
                    .select('id', { count: 'exact', head: true });

                if (error) return { error: error.message };
                const result = { count: count || 0 };
                setCached('enlisted_count', result, 60_000);
                return result;
            }

            case 'get_driver_profile': {
                const { data: player, error: pErr } = await supabase
                    .from('players')
                    .select('id, discord_id, display_name, created_at')
                    .eq('discord_id', args.user_id)
                    .maybeSingle();

                if (pErr) return { error: pErr.message };
                if (!player) return { found: false, message: 'Player not found in database.' };

                const { data: stats, error: sErr } = await supabase
                    .from('player_stats')
                    .select('level, wallet, total_km, total_runs')
                    .eq('player_id', player.id)
                    .maybeSingle();

                if (sErr) return { error: sErr.message };

                return {
                    found: true,
                    displayName: player.display_name,
                    discordId: player.discord_id,
                    level: stats?.level || 0,
                    totalKm: stats?.total_km || 0,
                    totalRuns: stats?.total_runs || 0,
                    wallet: stats?.wallet || 0,
                    joinedAt: player.created_at,
                };
            }

            case 'check_rank_eligibility': {
                // Fetch player stats
                const { data: player, error: pErr } = await supabase
                    .from('players')
                    .select('id, display_name')
                    .eq('discord_id', args.user_id)
                    .maybeSingle();

                if (pErr) return { error: pErr.message };
                if (!player) return { eligible: false, message: 'Player not found in database.' };

                const { data: stats } = await supabase
                    .from('player_stats')
                    .select('level, wallet, total_km, total_runs')
                    .eq('player_id', player.id)
                    .maybeSingle();

                // Fetch rank requirements from FAQ
                const faqContent = await findFaqAnswer(`${args.target_rank} rank requirements promotion`).catch(() => null);

                return {
                    player: player.display_name,
                    targetRank: args.target_rank,
                    currentStats: {
                        level: stats?.level || 0,
                        totalKm: stats?.total_km || 0,
                        totalRuns: stats?.total_runs || 0,
                        wallet: stats?.wallet || 0,
                    },
                    rankRequirements: faqContent || 'Could not retrieve rank requirements from FAQ.',
                    note: 'Compare the current stats against the rank requirements to determine eligibility.',
                };
            }

            case 'get_leaderboard': {
                const limit = Math.min(Math.max(args.limit || 10, 1), 25);
                const sortField = args.type === 'km' ? 'total_km' :
                                  args.type === 'runs' ? 'total_runs' : 'wallet';

                const { data, error } = await supabase
                    .from('player_stats')
                    .select('player_id, level, total_km, total_runs, wallet, players(display_name)')
                    .order(sortField, { ascending: false })
                    .limit(limit);

                if (error) return { error: error.message };

                const leaderboard = (data || []).map((row, i) => ({
                    rank: i + 1,
                    name: row.players?.display_name || 'Unknown',
                    value: row[sortField],
                }));

                return { type: args.type, leaderboard };
            }

            case 'get_vtc_list': {
                const cached = getCached('vtc_list');
                if (cached !== undefined) return cached;

                const { data, error } = await supabase
                    .from('approved_guilds')
                    .select('guild_id, guild_name, guild_income, total_runs, net_worth, status');

                if (error) return { error: error.message };
                const result = { vtcs: data || [] };
                setCached('vtc_list', result, 60_000);
                return result;
            }

            case 'search_player': {
                const { data, error } = await supabase
                    .from('players')
                    .select('discord_id, display_name, created_at')
                    .ilike('display_name', `%${args.name}%`)
                    .limit(10);

                if (error) return { error: error.message };
                return { results: data || [], count: (data || []).length };
            }

            case 'get_guild_stats': {
                const { data, error } = await supabase
                    .from('approved_guilds')
                    .select('*')
                    .eq('guild_id', args.guild_id)
                    .maybeSingle();

                if (error) return { error: error.message };
                if (!data) return { found: false, message: 'VTC not found.' };
                return { found: true, ...data };
            }

            case 'get_job_logs': {
                const limit = Math.min(Math.max(args.limit || 5, 1), 20);

                // First get player ID
                const { data: player } = await supabase
                    .from('players')
                    .select('id')
                    .eq('discord_id', args.user_id)
                    .maybeSingle();

                if (!player) return { found: false, message: 'Player not found.' };

                const { data, error } = await supabase
                    .from('player_economy_history')
                    .select('transaction_type, amount, details, created_at')
                    .eq('player_id', player.id)
                    .eq('transaction_type', 'job_log')
                    .order('created_at', { ascending: false })
                    .limit(limit);

                if (error) return { error: error.message };
                return { logs: data || [], count: (data || []).length };
            }

            default:
                return { error: `Unknown database tool: ${toolName}` };
        }
    } catch (err) {
        console.error(`[databaseTools] ${toolName} error:`, err.message);
        return { error: `Database query failed: ${err.message}` };
    }
}
