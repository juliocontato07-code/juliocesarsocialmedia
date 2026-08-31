'use strict';

const { Pool } = require('pg');

let pool = null;

/** Tira sslmode e channel_binding da URL; quem manda em SSL é o objeto ssl. */
function semParametrosDeSsl(url) {
  try {
    const endereco = new URL(url);
    endereco.searchParams.delete('sslmode');
    endereco.searchParams.delete('channel_binding');
    return endereco.toString();
  } catch (erro) {
    return url;
  }
}

function iniciar() {
  if (pool) return pool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL não está definida. Copie .env.example para .env e preencha.');
  }

  pool = new Pool({
    /* O SSL é configurado aqui embaixo, explicitamente. Os parâmetros de SSL
       que vêm na string do Neon são removidos para não brigarem com essa
       configuração nem gerarem aviso de depreciação do pg. */
    connectionString: semParametrosDeSsl(url),
    /* O Neon exige SSL e apresenta certificado de cadeia própria. */
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  });

  pool.on('error', function (erro) {
    console.error('[banco] erro em conexão ociosa:', erro.message);
  });

  return pool;
}

function obter() {
  if (!pool) throw new Error('Pool não iniciado.');
  return pool;
}

function consultar(texto, valores) {
  return obter().query(texto, valores);
}

/** Uma linha ou null. */
async function uma(texto, valores) {
  const resultado = await consultar(texto, valores);
  return resultado.rows[0] || null;
}

async function varias(texto, valores) {
  const resultado = await consultar(texto, valores);
  return resultado.rows;
}

/**
 * Roda a função dentro de uma transação. Qualquer exceção desfaz tudo.
 * A função recebe o cliente e deve usá-lo para todas as consultas.
 */
async function transacao(funcao) {
  const cliente = await obter().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await funcao(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    try { await cliente.query('ROLLBACK'); } catch (falha) { /* já perdido */ }
    throw erro;
  } finally {
    cliente.release();
  }
}

async function fechar() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/* query é alias de consultar: deixa o módulo ter a mesma forma de um cliente
   do pg, para o repositório poder receber um ou outro sem saber a diferença. */
module.exports = { iniciar, obter, consultar, query: consultar, uma, varias, transacao, fechar };
