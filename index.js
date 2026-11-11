require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const passport = require('passport');
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const session = require('express-session');

const app = express();
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

// ─── Sessões & Passport ───────────────────────────────────────────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_dev_secret_muda_isto',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: BASE_URL.startsWith('https') },
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
        const email =
            profile.emails && profile.emails[0]
                ? profile.emails[0].value
                : null;
        return done(null, { email });
    },
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ─── Validação de Caloiro ─────────────────────────────────────────────────────
// Formato esperado: 826XXXX@estg.ipp.pt  (ano 2026, 4 dígitos de número)
const CALOIRO_REGEX = /^826\d{4}@estg\.ipp\.pt$/i;

function isCaloiro(email) {
    return email && CALOIRO_REGEX.test(email);
}

// ─── Rotas Web ────────────────────────────────────────────────────────────────

// Inicia o fluxo OAuth2 — recebe o discordId como query param
app.get('/auth/microsoft', (req, res, next) => {
    if (!req.query.discordId) {
        return res.status(400).send('❌ Pedido inválido: falta o ID do Discord.');
    }
    req.session.discordId = req.query.discordId;
    passport.authenticate('microsoft')(req, res, next);
});

// Callback da Microsoft após login
app.get(
    '/auth/microsoft/callback',
    passport.authenticate('microsoft', { failureRedirect: '/auth/failed' }),
    async (req, res) => {
        const userEmail = req.user.email;
        const discordId = req.session.discordId;

        if (!userEmail) {
            return res.status(400).send(
                '❌ Não foi possível obter o email da tua conta Microsoft.',
            );
        }

        if (!discordId) {
            return res.status(400).send(
                '❌ Sessão inválida: ID do Discord em falta. Clica de novo no link do bot.',
            );
        }

        if (!isCaloiro(userEmail)) {
            return res.status(403).send(
                `❌ Verificação falhou: o email <b>${userEmail}</b> não pertence a um caloiro de 2026 válido.`,
            );
        }

        try {
            const guild = await discordClient.guilds.fetch(
                process.env.DISCORD_GUILD_ID,
            );
            const member = await guild.members.fetch(discordId);
            await member.roles.add(process.env.ROLE_ID);

            console.log(
                `✅ Cargo atribuído ao membro ${discordId} (${userEmail})`,
            );
            return res.send(
                '🎉 Conta verificada com sucesso! Podes fechar esta janela e voltar ao Discord.',
            );
        } catch (error) {
            console.error('Erro ao atribuir cargo:', error);
            return res.status(500).send(
                '⚠️ Ocorreu um erro ao atribuir o cargo no Discord. Contacta um administrador.',
            );
        }
    },
);

// Rota de erro de autenticação
app.get('/auth/failed', (_req, res) => {
    res.status(401).send(
        '❌ Autenticação com a Microsoft falhou. Tenta novamente ou contacta um administrador.',
    );
});

// ─── Eventos do Bot Discord ───────────────────────────────────────────────────

discordClient.once('ready', () => {
    console.log(`🤖 Bot ligado como ${discordClient.user.tag}`);
});

// Comando !verificar — pode ser usado por qualquer membro (gera o link para ele próprio)
// Só administradores podem usar !verificar @utilizador para verificar outra pessoa
discordClient.on('messageCreate', async (message) => {
    // Ignora mensagens de bots
    if (message.author.bot) return;

    if (message.content === '!verificar') {
        const targetId = message.author.id;
        const link = `${BASE_URL}/auth/microsoft?discordId=${targetId}`;

        try {
            // Envia o link em DM para não expor o ID no canal
            await message.author.send(
                `🔗 Clica no link abaixo para verificares o teu estatuto de caloiro com a tua conta institucional da ESTG:\n${link}\n\n⚠️ Este link é pessoal — não o partilhes com ninguém!`,
            );
            await message.reply(
                '📩 Enviei-te um DM com o link de verificação!',
            );
        } catch {
            // Se as DMs estão fechadas, envia no canal (menos seguro)
            await message.reply(
                `🔗 Clica aqui para verificares: ${link}\n⚠️ Este link é pessoal — não o partilhes!`,
            );
        }
    }
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`🌐 Servidor web ativo em ${BASE_URL} (porta ${PORT})`);
});

discordClient.login(process.env.DISCORD_TOKEN);
