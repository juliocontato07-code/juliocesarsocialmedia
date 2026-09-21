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

/*
 * Estado da inicialização.
 *
 * O servidor passa a abrir a porta ANTES de falar com o banco, e este objeto é
 * o que o /saude consulta para responder a verdade enquanto o resto acontece.
 *
 * O motivo é concreto: antes, conectar ao banco, aplicar migração e conferir o
 * admin acontecia tudo antes do listen, então durante esses segundos a porta
 * estava fechada e quem batesse no /saude levava conexão recusada. Com o
 * Postgres do Neon suspenso por inatividade, a primeira conexão sozinha leva
 * de 5 a 15 segundos — mais que a paciência do monitor da hospedagem. O build
 * passava, o processo estava vivo, e o deploy morria em "health check timeout"
 * sem nenhum erro no log para explicar.
 */
const estado = {
  fase: 'iniciando',   /* iniciando | pronto | falhou */
  desde: Date.now(),
  detalhe: 'subindo'
};

function marcar(fase, detalhe) {
  estado.fase = fase;
  estado.detalhe = detalhe;
  estado.desde = Date.now();
}

/**
 * Uma frase legível a partir de um erro.
 *
 * Nem todo erro tem `message`: quando o Node tenta vários endereços e falha em
 * todos, vem um AggregateError de mensagem vazia, e foi o que aconteceu aqui
 * no teste com banco inalcançável — a resposta do /saude saiu com o motivo em
 * branco, que é o contrário do que ela existe para fazer. Então a mensagem é
 * montada do que houver: texto, código, causas.
 */
function descrever(erro) {
  if (!erro) return 'erro desconhecido';

  const partes = [];
  if (erro.message) partes.push(erro.message);
  if (erro.code) partes.push('código ' + erro.code);

  /* AggregateError: a mensagem útil está nas causas individuais */
  if (Array.isArray(erro.errors)) {
    const causas = erro.errors
      .map(function (e) { return e && (e.message || e.code); })
      .filter(Boolean);
    if (causas.length > 0) partes.push(causas.slice(0, 3).join('; '));
  }

  if (erro.cause) partes.push(descrever(erro.cause));

  return partes.length > 0 ? partes.join(' — ') : String(erro);
}

/**
 * O trabalho que depende do banco. Roda depois que a porta já está aberta.
 *
 * Erro aqui não derruba o processo de propósito: derrubar devolveria porta
 * fechada de novo, e a hospedagem só saberia dizer "timeout". Vivo e
 * respondendo 503 com o motivo, o erro aparece no log E na resposta do
 * monitor — e a instância continua sem atender ninguém, que é o que importa
 * quando uma migração falha.
 */
async function prepararBanco() {
  try {
    marcar('iniciando', 'conectando no banco');
    const relogio = await bd.uma('SELECT now() AS agora');
    console.log('[banco] conectado, hora do servidor: ' + relogio.agora.toISOString());

    marcar('iniciando', 'aplicando migrações');
    await migracoes.aplicar();

    marcar('iniciando', 'conferindo o administrador inicial');
    const admin = await auth.garantirAdminInicial();
    if (!admin.criado) console.log('[auth] admin inicial não criado: ' + admin.motivo);

    marcar('pronto', 'atendendo');
    console.log('[servidor] pronto para atender');
  } catch (erro) {
    const motivo = descrever(erro);
    marcar('falhou', motivo);
    console.error('[inicialização] falhou: ' + motivo);
    console.error('[inicialização] a porta segue aberta e /saude responde 503 com o motivo; ' +
                  'nenhuma requisição da API é atendida enquanto isto não for resolvido.');
  }
}

async function iniciar() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET não está definida. Copie .env.example para .env e preencha.');
  }

  /* Só constrói o pool do pg, que é preguiçoso: nenhuma conexão é aberta
     aqui, então esta linha não trava mesmo com o banco fora do ar. */
  bd.iniciar();

  const app = express();

  /* Atrás do proxy do Render, para o cookie secure e o IP do rate limit
     enxergarem a requisição original. */
  if (PRODUCAO) app.set('trust proxy', 1);

  app.use(express.json({ limit: '25mb' }));

  /*
   * Vem antes da sessão de propósito: o monitor da hospedagem bate aqui a cada
   * poucos segundos e não deve abrir sessão nenhuma.
   *
   * Três respostas, e a diferença entre elas é o que faz o deploy ser
   * diagnosticável:
   *   200  pronto e com banco
   *   503  ainda subindo, dizendo em que passo está
   *   503  falhou, dizendo o motivo
   */
  app.get('/saude', async function (req, res) {
    const segundos = Math.round((Date.now() - estado.desde) / 1000);

    if (estado.fase === 'falhou') {
      return res.status(503).json({
        estado: 'falhou', detalhe: estado.detalhe, versao: PACOTE.version
      });
    }

    if (estado.fase === 'iniciando') {
      return res.status(503).json({
        estado: 'iniciando', passo: estado.detalhe, ha_segundos: segundos, versao: PACOTE.version
      });
    }

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

  /*
   * A API só abre depois que as migrações passaram.
   *
   * Sem esta guarda, a porta aberta cedo deixaria alguém consultar um banco
   * ainda não migrado durante a janela de inicialização — e o ganho de
   * responder rápido ao monitor viraria erro de coluna inexistente na cara de
   * quem estivesse usando o app.
   */
  app.use('/api', function (req, res, proximo) {
    if (estado.fase === 'pronto') return proximo();

    res.status(503).json({
      erro: estado.fase === 'falhou'
        ? 'O servidor não conseguiu iniciar: ' + estado.detalhe
        : 'O servidor ainda está iniciando (' + estado.detalhe + '). Tente de novo em instantes.'
    });
  });

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

  /*
   * 0.0.0.0 explícito.
   *
   * Sem host, o Node escuta em `::`, o curinga de IPv6. No Windows e no Linux
   * de mesa isso também aceita IPv4 por dual-stack, e é por isso que em
   * localhost funciona. No contêiner da hospedagem, que alcança o serviço por
   * IPv4, um socket preso a `::` pode simplesmente não receber a conexão — e o
   * sintoma é exatamente este: build verde, processo vivo, health check em
   * timeout e nenhum erro no log.
   */
  const servidor = app.listen(PORTA, '0.0.0.0', function () {
    const onde = servidor.address();
    console.log(PRODUCAO
      ? '[servidor] ouvindo em ' + onde.address + ':' + onde.port + ' (produção)'
      : '[servidor] ouvindo em http://localhost:' + PORTA);

    /* Só agora o banco entra em cena. A porta já está aberta, então o monitor
       recebe 503 "iniciando" em vez de conexão recusada. */
    prepararBanco();
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
