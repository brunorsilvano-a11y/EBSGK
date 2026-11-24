const express = require("express");
const crypto = require("crypto");
const path = require("path");
const session = require("express-session");
const axios = require("axios");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10kb" }));

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET não configurada no .env");
}

app.use(session({
    name: "portaleb.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 3 * 24 * 60 * 60 * 1000
    }
}));

function validarChave(recebida, correta) {
    if (!recebida || !correta) return false;

    const a = Buffer.from(recebida);
    const b = Buffer.from(correta);

    return a.length === b.length &&
        crypto.timingSafeEqual(a, b);
}

// STATUS
app.get("/", (req, res) => {
    res.json({
        sistema: "Portal EB",
        integracao: "Roblox → Discord",
        status: "Online"
    });
});

// INICIAR LOGIN DISCORD
app.get("/auth/discord", (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return res.status(503).send("OAuth2 não configurado.");
    }

    const state = crypto.randomBytes(32).toString("hex");

    req.session.oauthState = state;

    const parametros = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "identify",
        state
    });

    res.redirect(
        `https://discord.com/oauth2/authorize?${parametros}`
    );
});

// RETORNO DO DISCORD
app.get("/auth/discord/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (
            !code ||
            !state ||
            !req.session.oauthState ||
            state !== req.session.oauthState
        ) {
            return res.status(400).send("Autorização inválida.");
        }

        delete req.session.oauthState;

        const parametros = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI
        });

        const tokenResposta = await axios.post(
            "https://discord.com/api/v10/oauth2/token",
            parametros,
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );

        const accessToken = tokenResposta.data.access_token;

        const usuarioResposta = await axios.get(
            "https://discord.com/api/v10/users/@me",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const usuario = usuarioResposta.data;

        req.session.regenerate((erro) => {
            if (erro) {
                console.error(erro);
                return res.status(500).send("Erro ao criar sessão.");
            }

            req.session.discordUser = {
                id: usuario.id,
                username: usuario.username,
                globalName: usuario.global_name,
                avatar: usuario.avatar
            };

            req.session.save((erro) => {
                if (erro) {
                    console.error(erro);
                    return res.status(500).send("Erro ao salvar sessão.");
                }

                console.log(
                    `Login Discord realizado: ${usuario.username}`
                );

                res.redirect("/promocoes.html");
            });
        });

    } catch (erro) {
        console.error(
            "Erro no OAuth2:",
            erro.response?.data || erro.message
        );

        res.status(500).send(
            "Não foi possível realizar o login com Discord."
        );
    }
});

// CONSULTAR USUÁRIO CONECTADO
app.get("/api/me", (req, res) => {
    if (!req.session.discordUser) {
        return res.status(401).json({
            autenticado: false
        });
    }

    res.json({
        autenticado: true,
        usuario: req.session.discordUser
    });
});

// SAIR DA CONTA
app.post("/auth/logout", (req, res) => {
    req.session.destroy((erro) => {
        if (erro) {
            return res.status(500).json({
                erro: "Não foi possível encerrar a sessão."
            });
        }

        res.clearCookie("portaleb.sid");

        res.json({
            sucesso: true,
            mensagem: "Sessão encerrada."
        });
    });
});

// EVENTOS DO ROBLOX
app.post("/api/roblox/evento", async (req, res) => {
    try {
        const chave = req.headers["x-eb-secret"];

        if (!validarChave(
            chave,
            process.env.ROBLOX_API_SECRET
        )) {
            return res.status(401).json({
                erro: "Acesso não autorizado."
            });
        }

        const { tipo, username, userId } = req.body;

        if (!["entrada", "saida"].includes(tipo)) {
            return res.status(400).json({
                erro: "Tipo de evento inválido."
            });
        }

        if (
            typeof username !== "string" ||
            username.length < 1 ||
            username.length > 20 ||
            !Number.isSafeInteger(userId) ||
            userId <= 0
        ) {
            return res.status(400).json({
                erro: "Dados do jogador inválidos."
            });
        }

        const webhook = process.env.DISCORD_WEBHOOK_URL;

        if (!webhook) {
            return res.status(503).json({
                erro: "Webhook não configurado."
            });
        }

        const entrou = tipo === "entrada";

        const resposta = await fetch(webhook, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                embeds: [{
                    title: entrou
                        ? "🟢 Jogador entrou no EB"
                        : "🔴 Jogador saiu do EB",

                    color: entrou ? 0x2ecc71 : 0xe74c3c,

                    fields: [
                        {
                            name: "Jogador",
                            value: username,
                            inline: true
                        },
                        {
                            name: "Roblox ID",
                            value: String(userId),
                            inline: true
                        }
                    ],

                    timestamp: new Date().toISOString(),

                    footer: {
                        text: "Portal EB | Sistema de integração"
                    }
                }]
            })
        });

        if (!resposta.ok) {
            throw new Error("Falha ao enviar evento.");
        }

        res.json({
            sucesso: true,
            mensagem: "Evento enviado ao Discord."
        });

    } catch (erro) {
        console.error("Erro na integração:", erro.message);

        res.status(500).json({
            erro: "Não foi possível processar o evento."
        });
    }
});

// DISPONIBILIZAR ARQUIVOS DO SITE LOCALMENTE
app.use(express.static(path.join(__dirname, "..")));

app.listen(PORT, "0.0.0.0", () => {
    console.log("--------------------------------");
    console.log(`PORTAL EB ONLINE NA PORTA ${PORT}`);
    console.log("--------------------------------");
});