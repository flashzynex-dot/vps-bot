// Load environment variables from the .env file
require('dotenv').config();

// Import necessary classes from discord.js
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActivityType, ChannelType } = require('discord.js');

// --- 1. BASIC VALIDATION ---
// This checks if your .env file is filled out correctly. If not, it stops the bot.
const { DISCORD_TOKEN, CLIENT_ID, ADMIN_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !ADMIN_ID) {
    console.error("FATAL ERROR: Your .env file is missing or incomplete. Please fill it out with DISCORD_TOKEN, CLIENT_ID, and ADMIN_ID.");
    process.exit(1);
}

// --- 2. FAKE LXC MANAGER ---
// This simulates your LXC host. In a real bot, you would replace the functions
// inside with API calls to your Proxmox/LXC server.
class VpsManager {
    constructor() {
        // This is our fake database. It stores user LXC info.
        // It will reset every time the bot restarts.
        this.vpsDatabase = new Map();
        this.vpsIdCounter = 1000;
    }

    // Simulates creating an LXC container
    createLxc(user, specs) {
        // Check if the user already has a VPS
        if (this.getUserVps(user.id)) {
            return { success: false, message: "User already has a VPS." };
        }
        const vpsId = `LXC-${this.vpsIdCounter++}`;
        const newVps = {
            id: vpsId,
            owner: user,
            specs: specs,
            status: 'offline',
            // This is the key part for your request: a fake tmate session.
            tmateSession: `ssh ${user.username}-${vpsId}@tmate.kexson.host`,
        };
        this.vpsDatabase.set(user.id, newVps);
        console.log(`[LXC] Created container ${vpsId} for ${user.tag}.`);
        return { success: true, vps: newVps };
    }

    // Simulates performing an action on an LXC container
    performAction(userId, action) {
        const vps = this.getUserVps(userId);
        if (!vps) {
            return { success: false, message: "VPS not found." };
        }
        console.log(`[LXC] Performing action '${action}' on VPS ${vps.id} for ${vps.owner.tag}.`);
        // In a real bot, you would make an API call here.
        switch (action) {
            case 'start':
                vps.status = 'online';
                break;
            case 'shutdown':
                vps.status = 'offline';
                break;
            case 'reboot':
                vps.status = 'rebooting';
                setTimeout(() => { vps.status = 'online'; }, 5000); // Simulate reboot time
                break;
        }
        return { success: true, vps: vps };
    }

    // Helper function to find a user's VPS
    getUserVps(userId) {
        return this.vpsDatabase.get(userId);
    }
}

// --- 3. BOT INITIALIZATION ---
const client = new Client({
    // These intents are required for the bot to receive messages and slash commands.
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    // This is required to receive Direct Messages (DMs)
    partials: [Partials.Channel]
});

// Create an instance of our VPS manager and attach it to the client
client.vpsManager = new VpsManager();

// --- 4. COMMAND DEFINITIONS ---
// This is where we define all the slash commands the bot will use.
const commands = [
    // === ADMIN COMMAND ===
    {
        data: new SlashCommandBuilder()
            .setName('deploy')
            .setDescription('Deploys a new LXC VPS for a user.')
            .addUserOption(option => option.setName('user').setDescription('The user to deploy the VPS for').setRequired(true))
            .addIntegerOption(option => option.setName('ram').setDescription('RAM in MB').setRequired(true))
            .addIntegerOption(option => option.setName('disk').setDescription('Disk space in GB').setRequired(true))
            .addIntegerOption(option => option.setName('cpu').setDescription('Number of CPU cores').setRequired(true)),
        category: 'admin',
        async execute(interaction) {
            const user = interaction.options.getUser('user');
            const specs = {
                ram: interaction.options.getInteger('ram'),
                disk: interaction.options.getInteger('disk'),
                cpu: interaction.options.getInteger('cpu'),
            };

            // Defer the reply because sending a DM can take a moment
            await interaction.deferReply();

            const result = client.vpsManager.createLxc(user, specs);
            if (!result.success) {
                return interaction.editReply(`❌ Error: ${result.message}`);
            }

            const vps = result.vps;

            // This is the DM you requested.
            const dmEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🎉 Your LXC VPS is Ready!')
                .setDescription(`Your new container has been created and is ready for use.`)
                .addFields(
                    { name: '🖥️ VPS Details', value: `**ID:** ${vps.id}\n**RAM:** ${vps.specs.ram}MB\n**Disk:** ${vps.specs.disk}GB\n**CPU:** ${vps.specs.cpu} Cores`, inline: false },
                    { name: '🔑 SSH Access (tmate)', value: `You can connect instantly using the command below in your terminal:\n\`\`\`${vps.tmateSession}\`\`\``, inline: false }
                )
                .setFooter({ text: 'Manage your VPS by sending me commands in this DM! Type !help' })
                .setTimestamp();

            try {
                // Send the DM to the user
                await user.send({ embeds: [dmEmbed] });
                // Confirm to the admin in the channel
                await interaction.editReply(`✅ Successfully deployed LXC VPS \`${vps.id}\` for **${user.tag}**. They have been notified via DM.`);
            } catch (error) {
                console.error(`[ERROR] Could not send DM to ${user.tag}.`, error);
                await interaction.editReply(`✅ VPS \`${vps.id}\` deployed for **${user.tag}**, but I could not send them a DM. Please tell them to check their privacy settings.`);
            }
        }
    },

    // === USER COMMAND (in-server) ===
    {
        data: new SlashCommandBuilder()
            .setName('manage')
            .setDescription('Get instructions to manage your VPS via DM.'),
        category: 'user',
        async execute(interaction) {
            const vps = client.vpsManager.getUserVps(interaction.user.id);
            if (!vps) {
                return interaction.reply({ content: 'You do not have a VPS deployed. Please contact an administrator.', ephemeral: true });
            }
            await interaction.reply({ content: '✅ Please check your Direct Messages for VPS management instructions.', ephemeral: true });
            try {
                await interaction.user.send(`Hello! You can manage your VPS (\`${vps.id}\`) by sending me commands in this DM. Type \`!help\` to see what you can do.`);
            } catch (error) {
                console.error(`[ERROR] Could not send DM to ${interaction.user.tag}.`, error);
            }
        }
    }
];

// --- 5. EVENT HANDLERS ---

// Ready Event: Registers slash commands and sets bot status
// This code runs once when the bot successfully logs in.
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);

    // Set the bot's "Watching" status
    client.user.setActivity('LXC Host', { type: ActivityType.Watching });

    // This part registers all your commands with Discord
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);
        const data = await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands.map(cmd => cmd.data.toJSON()) },
        );
        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error('ERROR: Could not register commands.', error);
    }
});

// Interaction Create Event: Handles slash commands
// This code runs every time someone uses a slash command.
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = commands.find(cmd => cmd.data.name === interaction.commandName);
    if (!command) return;

    // Admin-only check
    if (command.category === 'admin' && interaction.user.id !== ADMIN_ID) {
        return interaction.reply({ content: '❌ You are not an admin.', ephemeral: true });
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`[ERROR] executing command ${interaction.commandName}:`, error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// Message Create Event: Handles DM commands for users
// This code runs every time a message is sent in a DM.
client.on('messageCreate', async message => {
    // Ignore messages from bots, non-DM channels, and users without a VPS
    if (message.author.bot || message.channel.type !== ChannelType.DM) return;
    const vps = client.vpsManager.getUserVps(message.author.id);
    if (!vps) return;

    const args = message.content.trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    if (!commandName.startsWith('!')) return;

    console.log(`[USER ACTION] ${message.author.tag} ran DM command '${commandName}' on VPS ${vps.id}.`);

    const reply = async (content) => {
        try { await message.author.send(content); }
        catch (e) { console.error(`[DM ERROR] Could not reply to ${message.author.tag}:`, e); }
    };

    switch (commandName) {
        case '!help':
            await reply('**Available Commands:**\n`!status` - Check VPS status.\n`!reboot` - Reboot your VPS.\n`!shutdown` - Shutdown your VPS.\n`!start` - Start your VPS.\n`!ssh` - Show your SSH access info.');
            break;
        case '!status':
            await reply(`Your VPS (\`${vps.id}\`) status is: **${vps.status.toUpperCase()}**`);
            break;
        case '!reboot':
            client.vpsManager.performAction(message.author.id, 'reboot');
            await reply(`🔄 Your VPS (\`${vps.id}\`) is now rebooting.`);
            break;
        case '!shutdown':
            client.vpsManager.performAction(message.author.id, 'shutdown');
            await reply(`🛑 Your VPS (\`${vps.id}\`) has been shut down.`);
            break;
        case '!start':
            client.vpsManager.performAction(message.author.id, 'start');
            await reply(`▶️ Your VPS (\`${vps.id}\`) has been started.`);
            break;
        case '!ssh':
            await reply(`🔑 SSH Access for \`${vps.id}\`:\n\`\`\`${vps.tmateSession}\`\`\``);
            break;
        default:
            await reply(`Unknown command. Type \`!help\` to see available commands.`);
    }
});

// --- 6. LOGIN ---
// This starts the bot.
client.login(DISCORD_TOKEN);
