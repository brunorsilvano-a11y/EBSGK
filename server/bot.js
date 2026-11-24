require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Events,
    REST,
    Routes
} = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// COMANDOS DO BOT
const comandos = [
    {
        name: "teste",
        description: "Testa o funcionamento do Portal EB."
    },
    {
        name: "cargos",
        description: "Mostra todos os cargos e seus IDs."
    }
];

// QUANDO O BOT INICIAR
client.once(Events.ClientReady, async (bot) => {
    console.log("================================");
    console.log(`BOT ONLINE: ${bot.user.tag}`);
    console.log("================================");

    const rest = new REST({ version: "10" })
        .setToken(process.env.DISCORD_TOKEN);

    for (const guild of bot.guilds.cache.values()) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(bot.user.id, guild.id),
                { body: comandos }
            );

            console.log(`Comandos registrados: ${guild.name}`);
        } catch (error) {
            console.error("Erro ao registrar comandos:", error);
        }
    }
});

// INTERAÇÕES
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // COMANDO TESTE
    if (interaction.commandName === "teste") {
        return interaction.reply({
            content: "✅ Portal EB está funcionando!",
            ephemeral: true
        });
    }

    // COMANDO CARGOS
    if (interaction.commandName === "cargos") {
        await interaction.deferReply({ ephemeral: true });

        try {
            const cargos = await interaction.guild.roles.fetch();

            const lista = cargos
                .filter(cargo => cargo.id !== interaction.guild.id)
                .sort((a, b) => b.position - a.position)
                .map(cargo => {
                    return `**${cargo.name}** — \`${cargo.id}\``;
                });

            if (lista.length === 0) {
                return interaction.editReply("Nenhum cargo encontrado.");
            }

            const resposta = lista.join("\n");

            // DIVIDIR EM MENSAGENS SE NECESSÁRIO
            const partes = [];
            let mensagem = "";

            for (const linha of lista) {
                if ((mensagem + linha + "\n").length > 1900) {
                    partes.push(mensagem);
                    mensagem = "";
                }

                mensagem += linha + "\n";
            }

            if (mensagem) {
                partes.push(mensagem);
            }

            await interaction.editReply(partes[0]);

            for (let i = 1; i < partes.length; i++) {
                await interaction.followUp({
                    content: partes[i],
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error("Erro ao buscar cargos:", error);

            await interaction.editReply(
                "❌ Não foi possível carregar os cargos."
            );
        }
    }
});

// CONECTAR BOT
client.login(process.env.DISCORD_TOKEN);