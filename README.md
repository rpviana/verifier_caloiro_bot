# Discord Caloiros Bot 🎓

Bot para verificar automaticamente o estatuto de caloiro da ESTG·IPP em servidores Discord, via autenticação OAuth2 com a conta Microsoft institucional.

## Como funciona

1. O membro escreve `!verificar` no canal do Discord.
2. O bot envia-lhe um **link privado** (DM) para fazer login com a conta `@estg.ipp.pt`.
3. Após o login, o bot valida o email com a regex `^826\d{4}@estg\.ipp\.pt$`.
4. Se válido, atribui automaticamente o cargo de caloiro no servidor.

## Configuração

### 1. Pré-requisitos

- [Node.js 18+](https://nodejs.org/)
- Uma **aplicação registada no Azure Portal** (ver abaixo)
- Um **Bot do Discord** com as permissões corretas

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar o ficheiro `.env`

Preenche o ficheiro `.env` que já está na raiz do projeto:

| Variável          | Onde obter                                                                 |
|-------------------|----------------------------------------------------------------------------|
| `DISCORD_TOKEN`   | [Discord Developer Portal](https://discord.com/developers/applications)    |
| `DISCORD_GUILD_ID`| Clica com o botão direito no servidor → Copiar ID do servidor             |
| `ROLE_ID`         | Clica no cargo com o botão direito → Copiar ID do cargo                   |
| `MS_CLIENT_ID`    | Azure Portal → App Registrations → Overview → Application (client) ID     |
| `MS_CLIENT_SECRET`| Azure Portal → App Registrations → Certificates & Secrets → New secret   |
| `BASE_URL`        | URL pública do servidor (ex: `https://meubot.fly.dev` em produção)        |
| `SESSION_SECRET`  | String longa e aleatória (qualquer texto secreto)                          |

### 4. Configurar a App no Azure Portal

1. Acede a [portal.azure.com](https://portal.azure.com)
2. Vai a **Azure Active Directory → App Registrations → New registration**
3. Dá um nome (ex: `DiscordCaloirosBot`)
4. Em **Redirect URI**, seleciona **Web** e adiciona:
   ```
   http://localhost:3000/auth/microsoft/callback
   ```
   *(Em produção, substitui pelo teu domínio real)*
5. Em **API permissions**, adiciona `User.Read` (Microsoft Graph, Delegated)
6. Cria um **Client Secret** em *Certificates & Secrets* e copia o valor

### 5. Permissões do Bot Discord

No Discord Developer Portal, em **Bot → Privileged Gateway Intents**, ativa:
- ✅ **Server Members Intent**
- ✅ **Message Content Intent**

O bot precisa dos seguintes **permissões no servidor**:
- Gerir Cargos (Manage Roles)
- Ler Mensagens / Ver Canais
- Enviar Mensagens

### 6. Executar

```bash
node index.js
```

## Comandos

| Comando     | Quem pode usar | Descrição                                      |
|-------------|----------------|------------------------------------------------|
| `!verificar`| Qualquer membro| Recebe por DM o link de verificação pessoal    |

## Deploy em Produção

Quando fizeres deploy, lembra-te de:

1. Mudar `BASE_URL` no `.env` para o teu domínio real (ex: `https://meubot.fly.dev`)
2. Atualizar o **Redirect URI** no Azure Portal para o mesmo URL
3. Usar um `SESSION_SECRET` forte e único
4. Usar um gestor de processos como `pm2`:
   ```bash
   npm install -g pm2
   pm2 start index.js --name caloiros-bot
   pm2 save
   ```
