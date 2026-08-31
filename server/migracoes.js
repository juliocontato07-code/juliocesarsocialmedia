'use strict';

/**
 * Aplicador de migrações.
 *
 * Regras, sem exceção:
 *   - só aplica o que ainda não foi aplicado;
 *   - cada migração roda dentro de uma transação;
 *   - falhou, desfaz e aborta a inicialização com erro visível;
 *   - nunca apaga, nunca recria o banco para aplicar mudança de estrutura.
 */

const fs = require('fs');
const path = require('path');

const bd = require('./db');

const PASTA = path.join(__dirname, '..', 'migrations');

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

async function versaoAplicada() {
  /* meta é criada fora das migrações porque é ela que guarda a versão. */
  await bd.consultar('CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT)');

  const linha = await bd.uma("SELECT valor FROM meta WHERE chave = 'schema_version'");
  return linha ? Number(linha.valor) : 0;
}

async function aplicar() {
  const atual = await versaoAplicada();
  const lista = arquivos();

  if (lista.length === 0) {
    registrar('nenhum arquivo de migração encontrado');
    return { de: atual, para: atual, aplicadas: [] };
  }

  const pendentes = lista.filter(function (m) { return m.numero > atual; });

  if (pendentes.length === 0) {
    registrar('estrutura já na versão ' + atual + ', nada a aplicar');
    return { de: atual, para: atual, aplicadas: [] };
  }

  registrar('versão atual ' + atual + ', pendentes: ' + pendentes.map(function (m) { return m.nome; }).join(', '));

  const aplicadas = [];

  for (const migracao of pendentes) {
    const sql = fs.readFileSync(migracao.caminho, 'utf8');

    try {
      await bd.transacao(async function (cliente) {
        await cliente.query(sql);
        await cliente.query(
          "INSERT INTO meta (chave, valor) VALUES ('schema_version', $1) " +
          'ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor',
          [String(migracao.numero)]
        );
      });
    } catch (erro) {
      /* transação já desfeita: o banco continua exatamente como estava */
      throw new Error('Migração ' + migracao.nome + ' falhou e foi desfeita. ' +
                      'Nenhum dado foi alterado. Detalhe: ' + erro.message);
    }

    registrar('aplicada ' + migracao.nome);
    aplicadas.push(migracao.nome);
  }

  const nova = pendentes[pendentes.length - 1].numero;
  registrar('estrutura agora na versão ' + nova);

  return { de: atual, para: nova, aplicadas: aplicadas };
}

module.exports = { aplicar, versaoAplicada };
