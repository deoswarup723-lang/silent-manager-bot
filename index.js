const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// -------------------------------------------------------------
// 1. AUTO-DEPENDENCY CHECK & INSTALLER FOR HOSTING PANELS
// -------------------------------------------------------------
const packageJsonPath = path.join(__dirname, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
    try {
        fs.writeFileSync(packageJsonPath, JSON.stringify({
            name: "hwid-bot",
            version: "1.0.0",
            main: "index.js",
            dependencies: {
                "discord.js": "^14.17.3",
                "dotenv": "^16.4.7"
            }
        }, null, 2));
    } catch (e) {}
}

try {
    require('discord.js');
    require('dotenv');
} catch (err) {
    console.log('[Wispbyte Setup] Required packages missing. Installing discord.js & dotenv now...');
    try {
        execSync('npm install discord.js dotenv --no-audit --no-fund', {
            stdio: 'inherit',
            cwd: __dirname
        });
        console.log('[Wispbyte Setup] Installation complete! Launching bot...');
    } catch (npmErr) {
        console.error('[Wispbyte Setup Error] npm install failed:', npmErr.message);
    }
}

try {
    require('dotenv').config();
} catch (e) {}

const {
    Client,
    GatewayIntentBits,
    Collection,
    ActivityType,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ChannelType
} = require('discord.js');

// -------------------------------------------------------------
// HTTP SERVER (For Render / Railway / Free Web Hosting Health Check)
// -------------------------------------------------------------
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'online', bot: 'SILENT MANAGER', uptime: Math.floor(process.uptime()) }));
}).listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT} (Render Web Service ready)`);
});

// -------------------------------------------------------------
// 2. CONFIGURATION (Pre-filled + .env override)
// -------------------------------------------------------------
const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID || '1554353464073527326',
    GUILD_ID: process.env.GUILD_ID || '1554145409465581601',

    RESELLER_ROLE_ID: process.env.RESELLER_ROLE_ID || '1554345271473864804',
    OWNER_ID: process.env.OWNER_ID || '1378068938847424522',

    XAUTH_EMAIL: process.env.XAUTH_EMAIL || 'sgamersilentcvr@cvr.a',
    XAUTH_PASSWORD: process.env.XAUTH_PASSWORD,
    XAUTH_BACKEND_URL: process.env.XAUTH_BACKEND_URL || 'https://1-xauth-backend.vercel.app',

    EMBED_COLOR: '#5865F2',
    SUCCESS_COLOR: '#2ECC71',
    ERROR_COLOR: '#E74C3C',
    WARNING_COLOR: '#F1C40F'
};

// -------------------------------------------------------------
// 3. STORAGE SERVICE (Authorized Channels)
// -------------------------------------------------------------
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

class StorageService {
    constructor() {
        this.cache = this.loadSettings();
    }

    loadSettings() {
        let channels = ['1554354328146546728'];
        if (process.env.ALLOWED_CHANNELS) {
            const envChannels = process.env.ALLOWED_CHANNELS.split(',').map(s => s.trim()).filter(Boolean);
            channels = Array.from(new Set([...channels, ...envChannels]));
        }

        try {
            if (fs.existsSync(SETTINGS_FILE)) {
                const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
                if (data.allowedChannels) {
                    channels = Array.from(new Set([...channels, ...data.allowedChannels]));
                }
            }
        } catch (e) {}

        const defaultSettings = { allowedChannels: channels };
        this.saveSettings(defaultSettings);
        return defaultSettings;
    }

    saveSettings(settings) {
        try {
            const dir = path.dirname(SETTINGS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
            this.cache = settings;
        } catch (e) {}
    }

    getAllowedChannels() {
        return this.cache.allowedChannels || [];
    }

    addChannel(channelId) {
        const set = new Set(this.cache.allowedChannels || []);
        if (set.has(channelId)) return false;
        set.add(channelId);
        this.cache.allowedChannels = Array.from(set);
        this.saveSettings(this.cache);
        return true;
    }

    removeChannel(channelId) {
        const set = new Set(this.cache.allowedChannels || []);
        if (!set.has(channelId)) return false;
        set.delete(channelId);
        this.cache.allowedChannels = Array.from(set);
        this.saveSettings(this.cache);
        return true;
    }

    isChannelAllowed(channelId) {
        return this.getAllowedChannels().includes(channelId);
    }
}

const storage = new StorageService();

// -------------------------------------------------------------
// 4. API SERVICE
// -------------------------------------------------------------
class ApiService {
    constructor() {
        this.token = null;
        this.tokenExpiresAt = 0;
        this.captain = null;
        this.applicationId = '6aaea0edf96bea0ac3b7c3b5';
        this.tiers = [];
    }

    getJwtExp(token) {
        try {
            const parts = token.split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                if (payload.exp) return payload.exp * 1000;
            }
        } catch (e) {}
        return Date.now() + 12 * 60 * 60 * 1000;
    }

    async login(force = false) {
        if (!force && this.token && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
            return this.token;
        }

        console.log('[Auth] Authenticating with API...');
        const res = await fetch(`${CONFIG.XAUTH_BACKEND_URL}/captains/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: CONFIG.XAUTH_EMAIL,
                password: CONFIG.XAUTH_PASSWORD
            })
        });

        const data = await res.json();
        if (!res.ok) {
            const errMsg = data.message || data.error || (data.errors && data.errors[0]?.msg) || 'Failed to authenticate';
            throw new Error(`[Login Error] ${errMsg}`);
        }

        this.token = data.token;
        this.tokenExpiresAt = this.getJwtExp(this.token);
        this.captain = data.captain;

        if (this.captain?.allowedApps?.length > 0) {
            this.applicationId = this.captain.allowedApps[0];
        }

        console.log(`[Auth] Logged in as ${this.captain?.username || this.captain?.email}. Credits: ${this.captain?.credits}`);
        await this.fetchProfile();
        return this.token;
    }

    async ensureToken() {
        if (!this.token || Date.now() >= this.tokenExpiresAt - 5 * 60 * 1000) {
            await this.login();
        }
        return this.token;
    }

    async fetchProfile() {
        const token = await this.ensureToken();
        const res = await fetch(`${CONFIG.XAUTH_BACKEND_URL}/captains/profile`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (res.status === 401) {
            await this.login(true);
            return this.fetchProfile();
        }

        const data = await res.json();
        if (data.captain) {
            this.captain = data.captain;
            const apps = data.captain.applications || [];
            if (apps.length > 0) {
                const app = apps[0];
                this.applicationId = app._id;
                this.tiers = app.resellerSettings?.subscriptionTiers || [
                    { days: 1, credits: 1, label: '1DAY' },
                    { days: 7, credits: 7, label: '7DAY' },
                    { days: 14, credits: 14, label: '14DAY' },
                    { days: 30, credits: 30, label: '30DAY' },
                    { days: 999, credits: 100, label: 'LIFETIME' }
                ];
            }
        }
        return data;
    }

    async getTiers() {
        if (!this.tiers || this.tiers.length === 0) {
            await this.fetchProfile();
        }
        return this.tiers;
    }

    async whitelistHWID({ hwid, name, duration = 'LIFETIME' }) {
        if (!hwid || !hwid.trim()) throw new Error('HWID cannot be empty.');

        await this.ensureToken();
        const tiers = await this.getTiers();

        let tierIndex = tiers.findIndex(t => t.label?.toUpperCase() === duration?.toUpperCase());
        if (tierIndex === -1) {
            tierIndex = tiers.findIndex(t => t.label?.toUpperCase() === 'LIFETIME');
            if (tierIndex === -1) tierIndex = tiers.length - 1;
        }

        const selectedTier = tiers[tierIndex] || { days: 999, credits: 100, label: 'LIFETIME' };
        const cleanName = (name && name.trim()) ? name.trim() : `User-${hwid.slice(-6)}`;
        const cleanHwid = hwid.trim();

        const payload = {
            name: cleanName,
            hwid: cleanHwid,
            applicationId: this.applicationId,
            tierIndex: tierIndex,
            tierDays: selectedTier.days
        };

        const executeCreate = async (token) => {
            return await fetch(`${CONFIG.XAUTH_BACKEND_URL}/hwids/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
        };

        let res = await executeCreate(this.token);
        if (res.status === 401) {
            await this.login(true);
            res = await executeCreate(this.token);
        }

        const data = await res.json();
        if (!res.ok) {
            const err = data.message || data.error || (data.errors && data.errors[0]?.msg) || 'Failed to whitelist HWID';
            throw new Error(err);
        }

        if (data.remainingCredits !== undefined && this.captain) {
            this.captain.credits = data.remainingCredits;
        }

        return {
            success: true,
            hwidAccess: data.hwidAccess,
            tier: selectedTier,
            remainingCredits: data.remainingCredits ?? this.captain?.credits
        };
    }

    async removeHWID(hwidOrName) {
        if (!hwidOrName || !hwidOrName.trim()) throw new Error('HWID or Name cannot be empty.');

        await this.ensureToken();
        const searchTerm = hwidOrName.trim().toLowerCase();

        const listData = await this.listHWIDs();
        const accesses = listData.hwidAccesses || [];

        const match = accesses.find(item => {
            const itemHwid = (item.hwid || '').toLowerCase();
            const itemName = (item.name || '').toLowerCase();
            const itemId = (item._id || '').toLowerCase();
            return itemHwid === searchTerm || itemName === searchTerm || itemId === searchTerm;
        });

        if (!match) {
            throw new Error(`No whitelisted HWID found matching "${hwidOrName}".`);
        }

        const executeDelete = async (token) => {
            return await fetch(`${CONFIG.XAUTH_BACKEND_URL}/hwids/delete/${match._id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
        };

        let res = await executeDelete(this.token);
        if (res.status === 401) {
            await this.login(true);
            res = await executeDelete(this.token);
        }

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message || data.error || 'Failed to delete HWID');
        }

        return {
            success: true,
            deletedHWID: match,
            message: data.message || 'HWID deleted successfully'
        };
    }

    async listHWIDs() {
        await this.ensureToken();

        const executeGet = async (token) => {
            return await fetch(`${CONFIG.XAUTH_BACKEND_URL}/hwids/${this.applicationId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
        };

        let res = await executeGet(this.token);
        if (res.status === 401) {
            await this.login(true);
            res = await executeGet(this.token);
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Failed to fetch HWID list');
        return data;
    }

    async getAccountStatus() {
        await this.fetchProfile();
        return {
            username: this.captain?.username || 'Reseller',
            email: this.captain?.email,
            credits: this.captain?.credits ?? 0,
            applicationId: this.applicationId
        };
    }
}

const api = new ApiService();

// -------------------------------------------------------------
// 5. SLASH COMMAND DEFINITIONS
// -------------------------------------------------------------
const hwidSlashCommand = new SlashCommandBuilder()
    .setName('hwid')
    .setDescription('Manage HWID whitelist')
    .addSubcommand(sub =>
        sub.setName('whitelist')
            .setDescription('Whitelist a new HWID')
            .addStringOption(opt => opt.setName('hwid').setDescription('Hardware ID to whitelist').setRequired(true))
            .addStringOption(opt => opt.setName('name').setDescription('Customer / Device name').setRequired(false))
            .addStringOption(opt =>
                opt.setName('duration')
                    .setDescription('Select access duration')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Lifetime (999 Days - 100 Credits)', value: 'LIFETIME' },
                        { name: '30 Days (30 Credits)', value: '30DAY' },
                        { name: '14 Days (14 Credits)', value: '14DAY' },
                        { name: '7 Days (7 Credits)', value: '7DAY' },
                        { name: '1 Day (1 Credit)', value: '1DAY' }
                    )
            )
    )
    .addSubcommand(sub =>
        sub.setName('remove')
            .setDescription('Remove a whitelisted HWID')
            .addStringOption(opt => opt.setName('hwid').setDescription('HWID or Name to remove').setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName('list')
            .setDescription('List all whitelisted HWIDs and check credits')
    );

const channelSlashCommand = new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Configure allowed channels for bot commands (Owner Only)')
    .addSubcommand(sub =>
        sub.setName('set')
            .setDescription('Set / authorize a channel for bot commands')
            .addChannelOption(opt =>
                opt.setName('target')
                    .setDescription('Select the channel to authorize (defaults to current channel)')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName('remove')
            .setDescription('Remove / deauthorize a channel from bot commands')
            .addChannelOption(opt =>
                opt.setName('target')
                    .setDescription('Select the channel to deauthorize (defaults to current channel)')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName('list')
            .setDescription('List all authorized channels for bot commands')
    );

// -------------------------------------------------------------
// 6. DISCORD CLIENT INITIALIZATION & AUTO-DEPLOY
// -------------------------------------------------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

client.once(Events.ClientReady, async () => {
    console.log('=============================================');
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    console.log(`👑 Owner ID: ${CONFIG.OWNER_ID}`);
    console.log(`💼 Reseller Role ID: ${CONFIG.RESELLER_ROLE_ID}`);

    const allowed = storage.getAllowedChannels();
    console.log(`📌 Allowed Channels (${allowed.length}):`, allowed.join(', ') || 'None set yet');

    // Auto-sync slash commands
    try {
        const rest = new REST({ version: '10' }).setToken(CONFIG.DISCORD_TOKEN);
        const commandJson = [hwidSlashCommand.toJSON(), channelSlashCommand.toJSON()];

        if (CONFIG.GUILD_ID && CONFIG.CLIENT_ID) {
            await rest.put(
                Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
                { body: commandJson }
            );
            console.log(`⚡ Slash commands auto-synced for Guild ID: ${CONFIG.GUILD_ID}`);
        } else if (CONFIG.CLIENT_ID) {
            await rest.put(
                Routes.applicationCommands(CONFIG.CLIENT_ID),
                { body: commandJson }
            );
            console.log('⚡ Global slash commands auto-synced');
        }
    } catch (deployErr) {
        console.error('⚠️ Could not auto-sync commands on startup:', deployErr.message);
    }

    try {
        console.log('[System] Checking authentication...');
        const status = await api.getAccountStatus();
        console.log(`✅ Connected successfully! Reseller: ${status.username} (${status.email}) | Credits: ${status.credits}`);
    } catch (err) {
        console.error('❌ Failed to authenticate on startup:', err.message);
    }

    client.user.setActivity('/hwid whitelist', { type: ActivityType.Playing });
    console.log('=============================================');
});

// -------------------------------------------------------------
// 7. COMMAND HANDLER WITH STRICT CHANNEL & ROLE PERMISSIONS
// -------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const isOwner = interaction.user.id === CONFIG.OWNER_ID;
    const isChannelCommand = interaction.commandName === 'channel';
    const isChannelAllowed = storage.isChannelAllowed(interaction.channelId);

    // 1. Channel check: "BOT CMD ONLY WORK IN CHANNEL SET BY OWNER"
    if (!isChannelAllowed) {
        if (!(isOwner && isChannelCommand)) {
            return await interaction.reply({
                content: `❌ **Command Restricted!**\nBot commands can only be used in channels authorized by the Owner (<@${CONFIG.OWNER_ID}>).`,
                ephemeral: true
            });
        }
    }

    // 2. /channel commands (Owner Only)
    if (isChannelCommand) {
        if (!isOwner) {
            return await interaction.reply({
                content: `❌ **Owner Only!** Only the Bot Owner (<@${CONFIG.OWNER_ID}>) can configure bot channels.`,
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const selectedChannel = interaction.options.getChannel('target') || interaction.channel;

        if (subcommand === 'set') {
            const added = storage.addChannel(selectedChannel.id);
            const embed = new EmbedBuilder()
                .setColor(added ? CONFIG.SUCCESS_COLOR : CONFIG.WARNING_COLOR)
                .setTitle(added ? '✅ Channel Authorized' : 'ℹ️ Channel Already Authorized')
                .setDescription(
                    added
                        ? `Channel <#${selectedChannel.id}> has been added to authorized channels.\nBot commands will now work here.`
                        : `Channel <#${selectedChannel.id}> is already authorized.`
                )
                .setTimestamp();
            return await interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'remove') {
            const removed = storage.removeChannel(selectedChannel.id);
            const embed = new EmbedBuilder()
                .setColor(removed ? CONFIG.SUCCESS_COLOR : CONFIG.ERROR_COLOR)
                .setTitle(removed ? '🗑️ Channel Removed' : '⚠️ Channel Not Found')
                .setDescription(
                    removed
                        ? `Channel <#${selectedChannel.id}> has been removed from authorized channels.\nBot commands will no longer work here.`
                        : `Channel <#${selectedChannel.id}> was not in authorized channels.`
                )
                .setTimestamp();
            return await interaction.reply({ embeds: [embed] });
        }

        if (subcommand === 'list') {
            const channels = storage.getAllowedChannels();
            let description = '';
            if (channels.length === 0) {
                description = '⚠️ *No channels authorized yet.*\nUse `/channel set` to authorize a channel.';
            } else {
                description = '**Authorized Channels:**\n' + channels.map(id => `• <#${id}> (\`${id}\`)`).join('\n');
            }
            const embed = new EmbedBuilder()
                .setColor(CONFIG.EMBED_COLOR)
                .setTitle('📌 Authorized Command Channels')
                .setDescription(description)
                .setTimestamp();
            return await interaction.reply({ embeds: [embed] });
        }
    }

    // 3. /hwid commands (Reseller Role or Owner)
    if (interaction.commandName === 'hwid') {
        const memberRoles = interaction.member?.roles;
        const hasResellerRole = memberRoles && (
            Array.isArray(memberRoles)
                ? memberRoles.includes(CONFIG.RESELLER_ROLE_ID)
                : memberRoles.cache?.has(CONFIG.RESELLER_ROLE_ID)
        );

        if (!isOwner && !hasResellerRole) {
            return await interaction.reply({
                content: `❌ **Access Denied!**\nYou must have the Reseller Role (<@&${CONFIG.RESELLER_ROLE_ID}>) to use this command.`,
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'whitelist') {
            await interaction.deferReply();
            const hwid = interaction.options.getString('hwid');
            const name = interaction.options.getString('name') || interaction.user.username;
            const duration = interaction.options.getString('duration') || 'LIFETIME';

            try {
                const result = await api.whitelistHWID({ hwid, name, duration });
                const access = result.hwidAccess;

                const embed = new EmbedBuilder()
                    .setTitle('✅ HWID Whitelisted Successfully')
                    .setColor(CONFIG.SUCCESS_COLOR)
                    .addFields(
                        { name: '👤 Name', value: `\`${access?.name || name}\``, inline: true },
                        { name: '⏱️ Duration', value: `\`${result.tier.label} (${result.tier.days} Days)\``, inline: true },
                        { name: '💳 Remaining Credits', value: `\`${result.remainingCredits}\``, inline: true },
                        { name: '🔑 HWID', value: `\`\`\`${access?.hwid || hwid}\`\`\``, inline: false },
                        { name: '📅 Expiry Date', value: access?.subscriptionEnd ? `<t:${Math.floor(new Date(access.subscriptionEnd).getTime() / 1000)}:F>` : 'Lifetime / None', inline: false }
                    )
                    .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                console.error('[HWID Whitelist Error]', err);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Whitelist Failed')
                    .setColor(CONFIG.ERROR_COLOR)
                    .setDescription(`**Error:** ${err.message}`)
                    .setTimestamp();
                return await interaction.editReply({ embeds: [errorEmbed] });
            }
        }

        if (subcommand === 'remove') {
            await interaction.deferReply();
            const target = interaction.options.getString('hwid');

            try {
                const result = await api.removeHWID(target);
                const deleted = result.deletedHWID;

                const embed = new EmbedBuilder()
                    .setTitle('🗑️ HWID Removed Successfully')
                    .setColor(CONFIG.SUCCESS_COLOR)
                    .setDescription(`The HWID has been deleted permanently from system.`)
                    .addFields(
                        { name: '👤 Name', value: `\`${deleted?.name || 'N/A'}\``, inline: true },
                        { name: '🔑 HWID', value: `\`\`\`${deleted?.hwid || target}\`\`\``, inline: false }
                    )
                    .setFooter({ text: `Removed by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                console.error('[HWID Remove Error]', err);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Remove Failed')
                    .setColor(CONFIG.ERROR_COLOR)
                    .setDescription(`**Error:** ${err.message}`)
                    .setTimestamp();
                return await interaction.editReply({ embeds: [errorEmbed] });
            }
        }

        if (subcommand === 'list') {
            await interaction.deferReply();

            try {
                const listData = await api.listHWIDs();
                const status = await api.getAccountStatus();
                const accesses = listData.hwidAccesses || [];

                let description = `**Total Whitelisted Devices:** ${accesses.length}\n**Reseller Credits:** ${status.credits}\n\n`;

                if (accesses.length === 0) {
                    description += '*No active HWID whitelists found.*';
                } else {
                    const recent = accesses.slice(-10).reverse();
                    recent.forEach((item, index) => {
                        const expiry = item.subscriptionEnd ? `<t:${Math.floor(new Date(item.subscriptionEnd).getTime() / 1000)}:R>` : 'Lifetime';
                        description += `**${index + 1}. ${item.name}**\n\`${item.hwid}\` | Status: \`${item.status}\` | Expires: ${expiry}\n\n`;
                    });

                    if (accesses.length > 10) {
                        description += `*...and ${accesses.length - 10} more in dashboard.*`;
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle('📋 Whitelist Status')
                    .setColor(CONFIG.EMBED_COLOR)
                    .setDescription(description)
                    .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            } catch (err) {
                console.error('[HWID List Error]', err);
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Failed to fetch list')
                    .setColor(CONFIG.ERROR_COLOR)
                    .setDescription(`**Error:** ${err.message}`)
                    .setTimestamp();
                return await interaction.editReply({ embeds: [errorEmbed] });
            }
        }
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

client.login(CONFIG.DISCORD_TOKEN).catch(err => {
    console.error('❌ Failed to login to Discord:', err.message);
});
