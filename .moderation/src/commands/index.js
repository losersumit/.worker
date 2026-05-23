/**
 * Discord AI Moderation Bot - Commands
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserWarnings, resetWarnings, getServerStatistics } from '../systems/storage.js'; // Updated import
import enlist from "./enlist.js";
import setwh from "./setwh.js";
import addpartner from "./addpartner.js";
import adddriver from "./adddriver.js";
import addmedia from "./addmedia.js";
import promote from "./promote.js";
import sendstylingembed from "./sendstylingembed.js";


export const commands = [

    enlist,
    setwh,
    addpartner,
    adddriver,
    addmedia,
    promote,
    sendstylingembed
];

// Helper function to format dates
function formatDate(dateString) {
    const date = new Date(dateString);
    return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

// Helper function to format action types
function formatActionType(actionType) {
    switch (actionType) {
        case 'timeout_1h':
            return 'Timeout (1 hour)';
        case 'timeout_24h':
            return 'Timeout (24 hours)';
        case 'kick':
            return 'Kick';
        case 'ban':
            return 'Ban';
        default:
            return actionType;
    }
}
