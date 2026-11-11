require('dotenv').config();
const crypto = require('crypto');
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    REST,
    Routes,
    PermissionFlagsBits,
} = require('discord.js');
const express = require('express');
const passport = require('passport');
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const session = require('express-session');

const app = express();

// Necessário para sessões funcionarem atrás do proxy do Railway
app.set('trust proxy', 1);

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;

// ─── Tokens temporários (substitui sessão para o discordId) ───────────────────
// Map: token (hex aleatório) -> { discordId, expiresAt }
// Evita problemas de sessão com reverse proxies (Railway, Render, etc.)
const pendingVerifications = new Map();

function createToken(discordId) {
    const token = crypto.randomBytes(20).toString('hex');
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos
    pendingVerifications.set(token, { discordId, expiresAt });
    setTimeout(() => pendingVerifications.delete(token), 10 * 60 * 1000);
    return token;
}

function consumeToken(token) {
    const entry = pendingVerifications.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        pendingVerifications.delete(token);
        return null;
    }
    pendingVerifications.delete(token); // token de uso único
    return entry.discordId;
}

// ─── Sessão mínima (só para o passport funcionar) ────────────────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_dev_secret_muda_isto',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: BASE_URL.startsWith('https'),
        sameSite: BASE_URL.startsWith('https') ? 'none' : 'lax',
    },
}));
app.use(passport.initialize());
app.use(passport.session());

// ─── Estratégia Microsoft OAuth2 ─────────────────────────────────────────────
passport.use(new MicrosoftStrategy(
    {
        clientID: process.env.MS_CLIENT_ID,
        clientSecret: process.env.MS_CLIENT_SECRET,
        callbackURL: `${BASE_URL}/auth/microsoft/callback`,
        scope: ['user.read'],
    },
    async (_accessToken, _refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value ?? null;
        return done(null, { email });
    },
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ─── Validação de Caloiro ─────────────────────────────────────────────────────
// Formato: 826XXXX@estg.ipp.pt
const CALOIRO_REGEX = /^826\d{4}@estg\.ipp\.pt$/i;
function isCaloiro(email) {
    return email && CALOIRO_REGEX.test(email);
}

// ─── Rotas Web ────────────────────────────────────────────────────────────────

// Inicia o fluxo OAuth2 — gera um token e passa-o como state
app.get('/auth/microsoft', (req, res, next) => {
    if (!req.query.discordId) {
        return res.status(400).send('❌ Pedido inválido: falta o ID do Discord.');
    }
    const token = createToken(req.query.discordId);
    // O token é passado como state através do fluxo OAuth2
    // Não depende de sessão — é recuperado no callback via req.query.state
    passport.authenticate('microsoft', { state: token })(req, res, next);
});

// Callback da Microsoft após login
app.get(
    '/auth/microsoft/callback',
    passport.authenticate('microsoft', { failureRedirect: '/auth/failed' }),
    async (req, res) => {
        const userEmail = req.user.email;
        // Recuperar discordId a partir do token no state (sem usar sessão)
        const token = req.query.state;
        const discordId = consumeToken(token);

        if (!userEmail) {
            return res.status(400).send('❌ Não foi possível obter o email da tua conta Microsoft.');
        }
        if (!discordId) {
            return res.status(400).send('❌ Link expirado ou inválido. Clica de novo no botão no Discord.');
        }
        if (!isCaloiro(userEmail)) {
            return res.status(403).send(
                `❌ Verificação falhou: o email <b>${userEmail}</b> não pertence a um caloiro de 2026 válido.`
            );
        }

        try {
            const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID);
            const member = await guild.members.fetch(discordId);
            await member.roles.add(process.env.ROLE_ID);
            console.log(`✅ Cargo atribuído: ${discordId} (${userEmail})`);
            return res.send('🎉 Conta verificada com sucesso! Podes fechar esta janela e voltar ao Discord.');
        } catch (error) {
            console.error('Erro ao atribuir cargo:', error);
            return res.status(500).send('⚠️ Erro ao atribuir o cargo. Contacta um administrador.');
        }
    }
);

app.get('/auth/failed', (_req, res) => {
    res.status(401).send('❌ Autenticação com a Microsoft falhou. Tenta novamente.');
});

// ─── Bot Discord ──────────────────────────────────────────────────────────────
discordClient.once('clientReady', async (client) => {
    console.log(`🤖 Bot ligado como ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('painel')
            .setDescription('Envia o painel de verificação de caloiros (só administradores)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .toJSON(),
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID),
            { body: commands }
        );
        console.log('✅ Slash command /painel registado');
    } catch (err) {
        console.error('Erro ao registar slash commands:', err);
    }
});

discordClient.on('interactionCreate', async (interaction) => {
    // ── Slash command /painel (apenas admins) ──
    if (interaction.isChatInputCommand() && interaction.commandName === 'painel') {
        const embed = new EmbedBuilder()
            .setTitle('🎓 Verificação de Caloiro — ESTG·IPP')
            .setDescription(
                'Bem-vindo ao servidor!\n\n' +
                'Para obteres o cargo de **Caloiro**, clica no botão abaixo e faz login com a tua conta institucional `@estg.ipp.pt`.\n\n' +
                '> A verificação é automática e segura. O teu cargo será atribuído imediatamente após o login.'
            )
            .setColor(0x5865F2)
            .setFooter({ text: 'Apenas contas 826XXXX@estg.ipp.pt são aceites.' });

        const button = new ButtonBuilder()
            .setCustomId('iniciar_verificacao')
            .setLabel('✅  Verificar como Caloiro')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);
        await interaction.reply({ embeds: [embed], components: [row] });
        return;
    }

    // ── Clique no botão de verificação ──
    if (interaction.isButton() && interaction.customId === 'iniciar_verificacao') {
        const link = `${BASE_URL}/auth/microsoft?discordId=${interaction.user.id}`;
        await interaction.reply({
            content:
                `🔗 **Clica no link abaixo** para fazeres login com a tua conta institucional da ESTG:\n${link}\n\n` +
                `⚠️ Este link é pessoal — não o partilhes com ninguém!`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
});

// ─── Arranque ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🌐 Servidor web ativo em ${BASE_URL} (porta ${PORT})`);
});

discordClient.login(process.env.DISCORD_TOKEN);
