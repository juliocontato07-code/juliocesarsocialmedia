'use strict';

/**
 * Aplicador de migrações.
 *
 * Regras, sem exceção:
 *   - só aplica o que ainda não foi aplicado;
 *   - tudo roda dentro de uma transação;
 *   - falhou, desfaz e aborta a inicialização com erro visível;
 *   - nunca apaga, nunca recria o banco para aplicar mudança de estrutura.
 */

const fs = require('fs');
const path = require('path');

const bd = require('./db');

const PASTA = path.join(__dirname, '..', 'migrations');

/* Número arbitrário; só precisa ser sempre o mesmo, é o nome da trava. */
const TRAVA = 8125473;

function registrar(mensagem) {
  console.log('[migracoes] ' + mensagem);
}

function arquivos() {
  if (!fs.existsSync(PASTA)) return [];

  return fs.readdirSync(PASTA)
    .filter(function (nome) { return /^\d+.*\.sql$/i.test(nome); })
    .sort()
    .map(function (nome) {
      return { numero: parseInt(nome, 10), nome: nome, caminho: path.join(PASTA, nome) };
    });
}

async function garantirMeta(conexao) {
  /* meta é criada fora das migrações porque é ela que guarda a versão. */
  await conexao.query('CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT)');
}

async function lerVersao(conexao) {
  const r = await conexao.query("SELECT valor FROM meta WHERE chave = 'schema_version'");
  return r.rows[0] ? Number(r.rows[0].valor) : 0;
}

/** Versão atual, para quem só quer consultar. */
async function versaoAplicada() {
  await garantirMeta(bd);
  return lerVersao(bd);
}

/**
 * Aplica o que estiver pendente.
 *
 * Tudo acontece numa transação só, e a primeira coisa que ela faz é pegar uma
 * trava consultiva. O motivo é a hospedagem: um deploy novo sobe antes do
 * antigo cair, então dois processos podem inicializar ao mesmo tempo. Sem
 * trava, os dois leem "versão 0" no mesmo instante e os dois tentam aplicar a
 * mesma migração; o segundo quebra num CREATE TABLE que já existe. Com trava,
 * o segundo espera, relê a versão e vê que não há nada pendente.
 *
 * A trava é de transação, não de sessão, e isso é obrigatório aqui: a conexão
 * com o Neon passa por um pooler em modo transação, onde cada consulta pode
 * cair num backend diferente. Trava de sessão (pg_advisory_lock) simplesmente
 * não segura nada nesse arranjo — dois processos pegam a mesma trava e seguem
 * em frente. A de transação segura porque a transação inteira fica presa a um
 * backend só, e ela se solta sozinha no commit ou no rollback.
 */
async function aplicar() {
  const lista = arquivos();

  if (lista.length === 0) {
    registrar('nenhum arquivo de migração encontrado');
    return { de: 0, para: 0, aplicadas: [] };
  }

  await garantirMeta(bd);

  let falhou = null;

  try {
    return await bd.transacao(async function (cx) {
      await cx.query('SELECT pg_advisory_xact_lock($1)', [TRAVA]);

      /* a versão só é lida com a trava na mão, senão a leitura corre junto
         com a escrita de outro processo e a trava não protege nada */
      const atual = await lerVersao(cx);
      const pendentes = lista.filter(function (m) { return m.numero > atual; });

      if (pendentes.length === 0) {
        registrar('estrutura já na versão ' + atual + ', nada a aplicar');
        return { de: atual, para: atual, aplicadas: [] };
      }

      registrar('versão atual ' + atual + ', pendentes: ' +
                pendentes.map(function (m) { return m.nome; }).join(', '));

      const aplicadas = [];

      for (const migracao of pendentes) {
        falhou = migracao.nome;
        await cx.query(fs.readFileSync(migracao.caminho, 'utf8'));
        await cx.query(
          "INSERT INTO meta (chave, valor) VALUES ('schema_version', $1) " +
          'ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor',
          [String(migracao.numero)]
        );
        falhou = null;
        registrar('aplicada ' + migracao.nome);
        aplicadas.push(migracao.nome);
      }

      const nova = pendentes[pendentes.length - 1].numero;
      registrar('estrutura agora na versão ' + nova);
      return { de: atual, para: nova, aplicadas: aplicadas };
    });
  } catch (erro) {
    /* transação já desfeita: o banco continua exatamente como estava */
    throw new Error('Migração ' + (falhou || '(desconhecida)') + ' falhou e foi desfeita. ' +
                    'Nenhum dado foi alterado. Detalhe: ' + erro.message);
  }
}

module.exports = { aplicar, versaoAplicada };
