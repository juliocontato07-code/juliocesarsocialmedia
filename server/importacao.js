'use strict';

/**
 * Importação de calendário, mesma regra e mesmo formato de sempre.
 *
 * Sempre aditiva: nunca sobrescreve, nunca apaga. Tudo passa por prévia e a
 * gravação inteira acontece numa transação só.
 */

const bd = require('./db');
const { clientes, tags, demandas, chaveDeNome } = require('./repositorio');

const VERSOES_ACEITAS = [1];
const COR_PADRAO_TAG = '#9A9A9A';

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function textoLongo(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/^\s+|\s+$/g, '');
}

function ehDataValida(valor) {
  const limpo = texto(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpo)) return false;
  const p = limpo.split('-').map(Number);
  const teste = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return teste.getUTCFullYear() === p[0] && teste.getUTCMonth() === p[1] - 1 && teste.getUTCDate() === p[2];
}

/* ------------------------------------------------------------------ *
 * Validação de estrutura                                              *
 * ------------------------------------------------------------------ */

function validarEstrutura(bruto) {
  let pacote;
  try {
    pacote = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
  } catch (erro) {
    throw new Error('O arquivo não é um JSON válido: ' + erro.message);
  }

  if (!pacote || typeof pacote !== 'object' || Array.isArray(pacote)) {
    throw new Error('O arquivo precisa ser um objeto JSON com "versao_schema", "clientes" e "demandas".');
  }

  if (pacote.versao_schema === undefined || pacote.versao_schema === null) {
    throw new Error('Falta o campo obrigatório "versao_schema" no arquivo.');
  }

  if (VERSOES_ACEITAS.indexOf(Number(pacote.versao_schema)) === -1) {
    throw new Error('versao_schema ' + pacote.versao_schema + ' é desconhecida. ' +
                    'Este app entende a versão ' + VERSOES_ACEITAS.join(', ') + '.');
  }

  if (!Array.isArray(pacote.clientes)) throw new Error('O campo "clientes" precisa ser uma lista.');
  if (!Array.isArray(pacote.demandas)) throw new Error('O campo "demandas" precisa ser uma lista.');

  pacote.clientes.forEach(function (cliente, i) {
    if (!cliente || typeof cliente !== 'object') throw new Error('clientes[' + i + '] não é um objeto.');
    if (texto(cliente.id_externo) === '') {
      throw new Error('clientes[' + i + '] está sem "id_externo", que é obrigatório.');
    }
    if (texto(cliente.nome) === '') {
      throw new Error('clientes[' + i + '] (' + texto(cliente.id_externo) + ') está sem "nome".');
    }
  });

  pacote.demandas.forEach(function (demanda, i) {
    if (!demanda || typeof demanda !== 'object') throw new Error('demandas[' + i + '] não é um objeto.');
    for (const campo of ['uid', 'cliente', 'data', 'tag']) {
      if (texto(demanda[campo]) === '') {
        throw new Error('demandas[' + i + '] está sem o campo obrigatório "' + campo + '".');
      }
    }
  });

  const uids = new Set();
  for (const demanda of pacote.demandas) {
    const uid = texto(demanda.uid);
    if (uids.has(uid)) {
      throw new Error('O uid "' + uid + '" aparece mais de uma vez no arquivo.');
    }
    uids.add(uid);
  }

  const externos = new Set();
  for (const cliente of pacote.clientes) {
    const id = texto(cliente.id_externo);
    if (externos.has(id)) throw new Error('O id_externo "' + id + '" aparece mais de uma vez no arquivo.');
    externos.add(id);
  }

  return pacote;
}

/* ------------------------------------------------------------------ *
 * Análise                                                             *
 * ------------------------------------------------------------------ */

async function analisar(pacote) {
  const plano = {
    clientesNovos: [],
    clientesDuplicados: [],
    tagsNovas: [],
    demandasNovas: [],
    demandasDuplicadas: [],
    erros: [],
    periodo: { inicio: null, fim: null }
  };

  const noBanco = await clientes.listar({ incluirArquivados: true });
  const porIdExterno = new Map();
  const porNome = new Map();
  for (const c of noBanco) {
    if (c.id_externo) porIdExterno.set(c.id_externo, c);
    porNome.set(chaveDeNome(c.nome), c);
  }

  const doArquivo = new Map();

  for (const cliente of pacote.clientes) {
    const idExterno = texto(cliente.id_externo);
    const jaPorId = porIdExterno.get(idExterno);
    const jaPorNome = porNome.get(chaveDeNome(cliente.nome));

    if (jaPorId) {
      plano.clientesDuplicados.push({
        nome: texto(cliente.nome), id_externo: idExterno,
        motivo: 'já existe cliente com este identificador'
      });
      doArquivo.set(idExterno, { existente: jaPorId });
      continue;
    }

    if (jaPorNome) {
      plano.clientesDuplicados.push({
        nome: texto(cliente.nome), id_externo: idExterno,
        motivo: 'já existe cliente com o mesmo nome (' + jaPorNome.nome + ')'
      });
      doArquivo.set(idExterno, { existente: jaPorNome });
      continue;
    }

    const dados = {
      id_externo: idExterno,
      nome: texto(cliente.nome),
      arroba: texto(cliente.arroba),
      nicho: texto(cliente.nicho),
      tipo_negocio: texto(cliente.tipo_negocio),
      contato: texto(cliente.contato),
      observacoes: textoLongo(cliente.observacoes)
    };

    plano.clientesNovos.push(dados);
    doArquivo.set(idExterno, { novo: dados });
    porNome.set(chaveDeNome(dados.nome), { nome: dados.nome });
  }

  const tagsNoBanco = new Set(
    (await tags.listar({ incluirArquivadas: true })).map(function (t) { return t.nome; })
  );
  const tagsPlanejadas = new Set();

  const uidsNoBanco = new Set(
    (await bd.varias('SELECT uid FROM demandas')).map(function (l) { return l.uid; })
  );

  const conteudoNoBanco = new Set(
    (await bd.varias(
      `SELECT c.nome AS nome, to_char(d.data,'YYYY-MM-DD') AS data, t.nome AS tag,
              COALESCE(d.titulo,'') AS titulo
       FROM demandas d JOIN clientes c ON c.id = d.cliente_id JOIN tags t ON t.id = d.tag_id`
    )).map(function (l) {
      return chaveDeNome(l.nome) + '|' + l.data + '|' + l.tag + '|' + chaveDeNome(l.titulo);
    })
  );

  const conteudoDoArquivo = new Set();

  pacote.demandas.forEach(function (demanda, indice) {
    const uid = texto(demanda.uid);
    const chaveCliente = texto(demanda.cliente);
    const data = texto(demanda.data);
    const tagNome = texto(demanda.tag);
    const titulo = texto(demanda.titulo);

    const referencia = doArquivo.get(chaveCliente) ||
      (porIdExterno.has(chaveCliente) ? { existente: porIdExterno.get(chaveCliente) } : null);

    if (!referencia) {
      plano.erros.push({
        onde: 'demandas[' + indice + ']',
        mensagem: 'cliente não encontrado: "' + chaveCliente + '" não está no arquivo nem no banco'
      });
      return;
    }

    if (!ehDataValida(data)) {
      plano.erros.push({
        onde: 'demandas[' + indice + ']',
        mensagem: 'data inválida: "' + texto(demanda.data) + '" (esperado AAAA-MM-DD)'
      });
      return;
    }

    const nomeCliente = referencia.novo ? referencia.novo.nome : referencia.existente.nome;
    const chaveConteudo = chaveDeNome(nomeCliente) + '|' + data + '|' + tagNome + '|' + chaveDeNome(titulo);

    if (uidsNoBanco.has(uid)) {
      plano.demandasDuplicadas.push({
        cliente: nomeCliente, data: data, tag: tagNome, titulo: titulo,
        motivo: 'já existe demanda com este uid'
      });
      return;
    }

    if (conteudoNoBanco.has(chaveConteudo)) {
      plano.demandasDuplicadas.push({
        cliente: nomeCliente, data: data, tag: tagNome, titulo: titulo,
        motivo: 'já existe demanda com mesmo cliente, data, tag e título'
      });
      return;
    }

    if (conteudoDoArquivo.has(chaveConteudo)) {
      plano.demandasDuplicadas.push({
        cliente: nomeCliente, data: data, tag: tagNome, titulo: titulo,
        motivo: 'repetida dentro do próprio arquivo'
      });
      return;
    }

    conteudoDoArquivo.add(chaveConteudo);

    if (!tagsNoBanco.has(tagNome) && !tagsPlanejadas.has(tagNome)) {
      tagsPlanejadas.add(tagNome);
      plano.tagsNovas.push(tagNome);
    }

    /* O schema do arquivo não mudou: acima de 1 é lido como Concluído. */
    let status = Number(demanda.status);
    if (!Number.isInteger(status) || status < 0) status = 0;
    else if (status > 1) status = 1;

    plano.demandasNovas.push({
      uid: uid,
      clienteChave: chaveCliente,
      clienteNome: nomeCliente,
      tagNome: tagNome,
      data: data,
      titulo: titulo,
      descricao: textoLongo(demanda.descricao),
      link: texto(demanda.link),
      status: status
    });

    if (!plano.periodo.inicio || data < plano.periodo.inicio) plano.periodo.inicio = data;
    if (!plano.periodo.fim || data > plano.periodo.fim) plano.periodo.fim = data;
  });

  return plano;
}

/** Lê, valida e devolve a prévia. Não toca no banco. */
async function previa(bruto, nomeArquivo) {
  const pacote = validarEstrutura(bruto);
  const plano = await analisar(pacote);

  return {
    arquivo: nomeArquivo || null,
    gerado_em: pacote.gerado_em || null,
    clientesNovos: plano.clientesNovos.map(function (c) { return c.nome; }),
    tagsNovas: plano.tagsNovas,
    totalDemandas: plano.demandasNovas.length,
    periodo: plano.periodo,
    duplicados: { clientes: plano.clientesDuplicados, demandas: plano.demandasDuplicadas },
    erros: plano.erros
  };
}

/** Grava só o que é novo, numa transação única. */
async function aplicar(bruto, usuarioId, nomeArquivo) {
  const pacote = validarEstrutura(bruto);
  const plano = await analisar(pacote);

  const resumo = {
    clientes: 0, tags: 0, demandas: 0,
    ignorados: plano.clientesDuplicados.length + plano.demandasDuplicadas.length,
    erros: plano.erros.length,
    periodo: plano.periodo
  };

  await bd.transacao(async function (conexao) {
    const idPorChave = new Map();

    for (const dados of plano.clientesNovos) {
      const criado = await clientes.criar(dados, conexao);
      idPorChave.set(dados.id_externo, criado.id);
      resumo.clientes += 1;
    }

    const idPorTag = new Map();
    for (const nome of plano.tagsNovas) {
      const r = await tags.garantir(nome, COR_PADRAO_TAG, conexao);
      idPorTag.set(nome, r.tag.id);
      if (r.criada) resumo.tags += 1;
    }

    for (const item of plano.demandasNovas) {
      let clienteId = idPorChave.get(item.clienteChave);

      if (!clienteId) {
        const achado = await conexao.query(
          'SELECT id FROM clientes WHERE id_externo = $1', [item.clienteChave]
        );
        if (!achado.rows[0]) {
          throw new Error('Cliente "' + item.clienteChave + '" sumiu no meio da importação.');
        }
        clienteId = achado.rows[0].id;
        idPorChave.set(item.clienteChave, clienteId);
      }

      let tagId = idPorTag.get(item.tagNome);
      if (!tagId) {
        const t = await tags.garantir(item.tagNome, COR_PADRAO_TAG, conexao);
        tagId = t.tag.id;
        idPorTag.set(item.tagNome, tagId);
        if (t.criada) resumo.tags += 1;
      }

      await demandas.criar({
        uid: item.uid,
        cliente_id: clienteId,
        tag_id: tagId,
        data: item.data,
        titulo: item.titulo,
        descricao: item.descricao,
        link: item.link,
        status: item.status
      }, usuarioId, conexao);

      resumo.demandas += 1;
    }

    await conexao.query(
      `INSERT INTO importacoes (usuario_id, arquivo, clientes_criados, demandas_criadas, duplicadas_descartadas)
       VALUES ($1,$2,$3,$4,$5)`,
      [usuarioId, nomeArquivo || null, resumo.clientes, resumo.demandas, resumo.ignorados]
    );
  });

  return resumo;
}

module.exports = { previa, aplicar, validarEstrutura, analisar };
