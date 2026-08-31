'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const ConnectPgSimple = require('connect-pg-simple');

const PACOTE = require('../package.json');
const bd = require('./db');
const migracoes = require('./migracoes');
const auth = require('./autenticacao');
const rotas = require('./rotas');

const PORTA = Number(process.env.PORT) || 3000;
const PRODUCAO = process.env.NODE_ENV === 'production';
const PUBLICO = path.join(__dirname, '..', 'public');

async function iniciar() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET não está definida. Copie .env.example para .env e preencha.');
  }

  bd.iniciar();

  const relogio = await bd.uma('SELECT now() AS agora');
  console.log('[banco] conectado, hora do servidor: ' + relogio.agora.toISOString());

  await migracoes.aplicar();

  const admin = await auth.garantirAdminInicial();
  if (!admin.criado) console.log('[auth] admin inicial não criado: ' + admin.motivo);

  const app = express();

  /* Atrás do proxy do Render, para o cookie secure e o IP do rate limit
     enxergarem a requisição original. */
  if (PRODUCAO) app.set('trust proxy', 1);

  app.use(express.json({ limit: '25mb' }));

  /* Vem antes da sessão de propósito: o monitor da hospedagem bate aqui a cada
     poucos segundos e não deve abrir sessão nenhuma. Responde 200 com o banco
     de pé e 503 sem ele, que é o sinal que o monitor sabe ler. */
  app.get('/saude', async function (req, res) {
    try {
      await bd.uma('SELECT 1 AS ok');
      res.json({ estado: 'ok', versao: PACOTE.version, hora: new Date().toISOString() });
    } catch (erro) {
      res.status(503).json({ estado: 'sem banco', detalhe: erro.message });
    }
  });

  const Loja = ConnectPgSimple(session);

  app.use(session({
    name: 'sid',
    store: new Loja({
      pool: bd.obter(),
      tableName: 'sessoes',
      createTableIfMissing: false   /* a tabela vem da migração */
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: PRODUCAO,
      maxAge: 1000 * 60 * 60 * 24 * 30
    }
  }));

  app.use('/api', rotas);

  /* Estáticos por último, para nunca capturarem uma rota da API. */
  app.use(express.static(PUBLICO, { index: false }));

  app.get('/login', function (req, res) {
    res.sendFile(path.join(PUBLICO, 'login.html'));
  });

  app.get('/', function (req, res) {
    if (!req.session || !req.session.usuarioId) return res.redirect('/login');
    res.sendFile(path.join(PUBLICO, 'index.html'));
  });

  app.use('/api', function (req, res) {
    res.status(404).json({ erro: 'Rota não encontrada: ' + req.method + ' ' + req.originalUrl });
  });

  /* Erro sempre em JSON, para o front conseguir mostrar a mensagem. */
  app.use(function (erro, req, res, proximo) {
    console.error('[erro] ' + req.method + ' ' + req.originalUrl + ': ' + erro.message);
    const codigo = erro.codigo || 400;
    res.status(codigo).json({ erro: erro.message || 'Falha inesperada no servidor.' });
  });

  const servidor = app.listen(PORTA, function () {
    console.log(PRODUCAO
      ? '[servidor] ouvindo na porta ' + PORTA + ' (produção)'
      : '[servidor] ouvindo em http://localhost:' + PORTA);
  });

  let encerrando = false;
  const encerrar = function () {
    if (encerrando) return;          /* dois sinais seguidos não atropelam */
    encerrando = true;
    console.log('[servidor] encerrando');

    /* rede de segurança: conexão pendurada não pode impedir a saída */
    const forcar = setTimeout(function () {
      console.error('[servidor] conexões não fecharam a tempo, saindo assim mesmo');
      process.exit(1);
    }, 10000);
    forcar.unref();

    servidor.close(async function () {
      try { await bd.fechar(); } catch (erro) { /* já indo embora */ }
      process.exit(0);
    });
  };

  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

iniciar().catch(function (erro) {
  console.error('[inicialização] ' + erro.message);
  process.exit(1);
});
