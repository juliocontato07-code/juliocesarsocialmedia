'use strict';

/**
 * Acesso a clientes, tags e demandas.
 * Recebe opcionalmente um cliente de transação para participar de uma
 * operação maior (a importação usa isso).
 */

const crypto = require('crypto');
const bd = require('./db');

function exec(conexao) {
  return conexao || bd;
}

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

/** A descrição preserva quebras de linha: só apara as pontas. */
function textoLongo(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/^\s+|\s+$/g, '');
}

function novoUid() {
  return crypto.randomUUID();
}

function novoIdExterno(nome) {
  const base = String(nome || 'cliente')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'cliente';

  return base + '-' + crypto.randomBytes(3).toString('hex');
}

/** Comparação de nome da deduplicação: sem maiúsculas, sem acentos, sem pontas. */
function chaveDeNome(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function dataValida(valor) {
  const limpo = texto(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpo)) {
    throw new Error('Data inválida. Use o formato AAAA-MM-DD.');
  }
  const partes = limpo.split('-').map(Number);
  const teste = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2]));
  if (teste.getUTCFullYear() !== partes[0] ||
      teste.getUTCMonth() !== partes[1] - 1 ||
      teste.getUTCDate() !== partes[2]) {
    throw new Error('Essa data não existe no calendário.');
  }
  return limpo;
}

function statusValido(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0 || numero > 1) {
    throw new Error('Status inválido: use 0 (Pendente) ou 1 (Concluído).');
  }
  return numero;
}

/* ------------------------------------------------------------------ *
 * Clientes                                                            *
 * ------------------------------------------------------------------ */

const clientes = {
  async listar(opcoes, conexao) {
    const config = opcoes || {};
    let onde = 'WHERE arquivado = false';
    if (config.somenteArquivados) onde = 'WHERE arquivado = true';
    else if (config.incluirArquivados) onde = '';

    const r = await exec(conexao).query(
      'SELECT * FROM clientes ' + onde + ' ORDER BY ordem, nome'
    );
    return r.rows;
  },

  async obter(id, conexao) {
    const r = await exec(conexao).query('SELECT * FROM clientes WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  async porIdExterno(idExterno, conexao) {
    const limpo = texto(idExterno);
    if (limpo === '') return null;
    const r = await exec(conexao).query('SELECT * FROM clientes WHERE id_externo = $1', [limpo]);
    return r.rows[0] || null;
  },

  async criar(dados, conexao) {
    const nome = texto(dados.nome);
    if (nome === '') throw new Error('O nome do cliente é obrigatório.');
    if (nome.length > 120) throw new Error('O nome do cliente passou de 120 caracteres.');

    const arroba = texto(dados.arroba).replace(/^@+/, '');
    const ordem = await exec(conexao).query(
      'SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM clientes WHERE arquivado = false'
    );

    const r = await exec(conexao).query(
      `INSERT INTO clientes (id_externo, nome, arroba, nicho, tipo_negocio, contato, observacoes, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        texto(dados.id_externo) || novoIdExterno(nome),
        nome,
        arroba === '' ? '' : '@' + arroba,
        texto(dados.nicho),
        texto(dados.tipo_negocio),
        texto(dados.contato),
        textoLongo(dados.observacoes),
        ordem.rows[0].proxima
      ]
    );
    return r.rows[0];
  },

  async atualizar(id, dados, conexao) {
    const nome = texto(dados.nome);
    if (nome === '') throw new Error('O nome do cliente é obrigatório.');

    const arroba = texto(dados.arroba).replace(/^@+/, '');

    const r = await exec(conexao).query(
      `UPDATE clientes SET nome=$2, arroba=$3, nicho=$4, tipo_negocio=$5,
       contato=$6, observacoes=$7 WHERE id=$1 RETURNING *`,
      [id, nome, arroba === '' ? '' : '@' + arroba, texto(dados.nicho),
       texto(dados.tipo_negocio), texto(dados.contato), textoLongo(dados.observacoes)]
    );
    return r.rows[0] || null;
  },

  async arquivar(id) {
    const r = await bd.consultar(
      'UPDATE clientes SET arquivado = true WHERE id = $1 RETURNING *', [id]
    );
    return r.rows[0] || null;
  },

  async desarquivar(id) {
    const ordem = await bd.uma(
      'SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM clientes WHERE arquivado = false'
    );
    const r = await bd.consultar(
      'UPDATE clientes SET arquivado = false, ordem = $2 WHERE id = $1 RETURNING *',
      [id, ordem.proxima]
    );
    return r.rows[0] || null;
  },

  async resumo(id) {
    return bd.uma(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 1)::int AS concluidas,
              MIN(data)::text AS primeira, MAX(data)::text AS ultima
       FROM demandas WHERE cliente_id = $1`, [id]
    );
  }
};

/* ------------------------------------------------------------------ *
 * Tags                                                                *
 * ------------------------------------------------------------------ */

const tags = {
  async listar(opcoes, conexao) {
    const onde = (opcoes && opcoes.incluirArquivadas) ? '' : 'WHERE arquivada = false';
    const r = await exec(conexao).query('SELECT * FROM tags ' + onde + ' ORDER BY ordem, id');
    return r.rows;
  },

  async obter(id) {
    return bd.uma('SELECT * FROM tags WHERE id = $1', [id]);
  },

  async criar(dados) {
    const nome = texto(dados.nome);
    if (nome === '') throw new Error('O nome da tag é obrigatório.');

    const existente = await bd.uma('SELECT id, arquivada FROM tags WHERE lower(nome) = lower($1)', [nome]);
    if (existente) {
      throw new Error(existente.arquivada
        ? 'Já existe uma tag arquivada com esse nome. Desarquive em vez de criar outra.'
        : 'Já existe uma tag com esse nome.');
    }

    const ordem = await bd.uma('SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM tags');
    const r = await bd.consultar(
      'INSERT INTO tags (nome, cor, ordem) VALUES ($1,$2,$3) RETURNING *',
      [nome, corValida(dados.cor), ordem.proxima]
    );
    return r.rows[0];
  },

  /** Usada pela importação: cria sem reclamar se já existir. */
  async garantir(nome, cor, conexao) {
    const limpo = texto(nome);
    const achada = await exec(conexao).query('SELECT * FROM tags WHERE nome = $1', [limpo]);
    if (achada.rows[0]) return { tag: achada.rows[0], criada: false };

    const ordem = await exec(conexao).query('SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM tags');
    const r = await exec(conexao).query(
      'INSERT INTO tags (nome, cor, ordem) VALUES ($1,$2,$3) RETURNING *',
      [limpo, corValida(cor), ordem.rows[0].proxima]
    );
    return { tag: r.rows[0], criada: true };
  },

  async atualizar(id, dados) {
    const nome = texto(dados.nome);
    if (nome === '') throw new Error('O nome da tag é obrigatório.');

    const conflito = await bd.uma(
      'SELECT id FROM tags WHERE lower(nome) = lower($1) AND id <> $2', [nome, id]
    );
    if (conflito) throw new Error('Já existe outra tag com esse nome.');

    const r = await bd.consultar(
      'UPDATE tags SET nome=$2, cor=$3 WHERE id=$1 RETURNING *',
      [id, nome, corValida(dados.cor)]
    );
    return r.rows[0] || null;
  },

  async arquivar(id) {
    const ativas = await bd.uma('SELECT COUNT(*)::int AS n FROM tags WHERE arquivada = false');
    if (ativas.n <= 1) throw new Error('É preciso manter pelo menos uma tag ativa.');

    const r = await bd.consultar('UPDATE tags SET arquivada = true WHERE id = $1 RETURNING *', [id]);
    return r.rows[0] || null;
  },

  async desarquivar(id) {
    const r = await bd.consultar('UPDATE tags SET arquivada = false WHERE id = $1 RETURNING *', [id]);
    return r.rows[0] || null;
  },

  async reordenar(ids) {
    await bd.transacao(async function (cliente) {
      for (let i = 0; i < ids.length; i += 1) {
        await cliente.query('UPDATE tags SET ordem = $1 WHERE id = $2', [i, ids[i]]);
      }
    });
    return tags.listar({ incluirArquivadas: true });
  },

  async emUso(id) {
    const r = await bd.uma('SELECT COUNT(*)::int AS n FROM demandas WHERE tag_id = $1', [id]);
    return r.n;
  }
};

function corValida(valor) {
  const limpo = texto(valor).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(limpo) ? limpo : '#9A9A9A';
}

/* ------------------------------------------------------------------ *
 * Demandas                                                            *
 * ------------------------------------------------------------------ */

const SELECAO = `
  SELECT d.id, d.uid, d.cliente_id, d.tag_id, to_char(d.data,'YYYY-MM-DD') AS data,
         d.titulo, d.descricao, d.link, d.status, d.ordem,
         d.criado_em, d.atualizado_em, d.atualizado_por,
         t.nome AS tag_nome, t.cor AS tag_cor, t.arquivada AS tag_arquivada,
         c.nome AS cliente_nome, c.arroba AS cliente_arroba, c.arquivado AS cliente_arquivado,
         u.usuario AS atualizado_por_nome
  FROM demandas d
  JOIN tags t ON t.id = d.tag_id
  JOIN clientes c ON c.id = d.cliente_id
  LEFT JOIN usuarios u ON u.id = d.atualizado_por
`;

const ORDENACAO = ' ORDER BY d.data, c.ordem, c.nome, d.ordem, d.id';

const demandas = {
  async obter(id, conexao) {
    const r = await exec(conexao).query(SELECAO + ' WHERE d.id = $1', [id]);
    return r.rows[0] || null;
  },

  async listarPeriodo(inicio, fim, opcoes) {
    const config = opcoes || {};
    const valores = [dataValida(inicio), dataValida(fim)];

    let sql = SELECAO + ' WHERE d.data BETWEEN $1 AND $2';
    if (!config.incluirArquivados) sql += ' AND c.arquivado = false';
    if (config.clienteId) {
      valores.push(config.clienteId);
      sql += ' AND d.cliente_id = $' + valores.length;
    }

    return bd.varias(sql + ORDENACAO, valores);
  },

  async criar(dados, usuarioId, conexao) {
    const data = dataValida(dados.data);

    const ordem = await exec(conexao).query(
      'SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM demandas WHERE cliente_id = $1 AND data = $2',
      [dados.cliente_id, data]
    );

    const r = await exec(conexao).query(
      `INSERT INTO demandas (uid, cliente_id, tag_id, data, titulo, descricao, link, status, ordem, atualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        texto(dados.uid) || novoUid(),
        dados.cliente_id,
        dados.tag_id,
        data,
        texto(dados.titulo),
        textoLongo(dados.descricao),
        texto(dados.link),
        dados.status === undefined ? 0 : statusValido(dados.status),
        dados.ordem === undefined ? ordem.rows[0].proxima : Number(dados.ordem),
        usuarioId || null
      ]
    );

    return demandas.obter(r.rows[0].id, conexao);
  },

  /** Edição completa: só o admin chega aqui. */
  async atualizar(id, dados, usuarioId) {
    const atual = await demandas.obter(id);
    if (!atual) throw new Error('Demanda não encontrada.');

    const data = dataValida(dados.data);
    const mudouCelula = Number(dados.cliente_id) !== atual.cliente_id || data !== atual.data;

    let ordem = atual.ordem;
    if (mudouCelula) {
      const proxima = await bd.uma(
        'SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM demandas WHERE cliente_id = $1 AND data = $2',
        [dados.cliente_id, data]
      );
      ordem = proxima.proxima;
    }

    await bd.consultar(
      `UPDATE demandas SET cliente_id=$2, tag_id=$3, data=$4, titulo=$5, descricao=$6,
       link=$7, ordem=$8, atualizado_em=now(), atualizado_por=$9 WHERE id=$1`,
      [
        id, dados.cliente_id, dados.tag_id, data,
        texto(dados.titulo),
        dados.descricao === undefined ? atual.descricao : textoLongo(dados.descricao),
        texto(dados.link), ordem, usuarioId || null
      ]
    );

    return demandas.obter(id);
  },

  /** O que o papel "usuario" pode mexer: status e link, nada mais. */
  async atualizarLimitado(id, dados, usuarioId) {
    const atual = await demandas.obter(id);
    if (!atual) throw new Error('Demanda não encontrada.');

    const partes = [];
    const valores = [id];

    if (dados.status !== undefined) {
      valores.push(statusValido(dados.status));
      partes.push('status = $' + valores.length);
    }
    if (dados.link !== undefined) {
      valores.push(texto(dados.link));
      partes.push('link = $' + valores.length);
    }

    if (partes.length === 0) return atual;

    valores.push(usuarioId || null);
    partes.push('atualizado_por = $' + valores.length);

    await bd.consultar(
      'UPDATE demandas SET ' + partes.join(', ') + ', atualizado_em = now() WHERE id = $1',
      valores
    );

    return demandas.obter(id);
  },

  async alternarStatus(id, usuarioId) {
    const r = await bd.consultar(
      `UPDATE demandas SET status = CASE WHEN status = 0 THEN 1 ELSE 0 END,
       atualizado_em = now(), atualizado_por = $2 WHERE id = $1 RETURNING id`,
      [id, usuarioId || null]
    );
    if (r.rows.length === 0) throw new Error('Demanda não encontrada.');
    return demandas.obter(id);
  },

  async excluir(id) {
    const r = await bd.consultar('DELETE FROM demandas WHERE id = $1', [id]);
    return r.rowCount > 0;
  },

  async duplicar(id, novaData, usuarioId) {
    const original = await demandas.obter(id);
    if (!original) throw new Error('Demanda não encontrada.');

    return demandas.criar({
      cliente_id: original.cliente_id,
      tag_id: original.tag_id,
      data: novaData || original.data,
      titulo: original.titulo,
      descricao: original.descricao,
      link: '',
      status: 0
    }, usuarioId);
  },

  async mover(id, clienteId, data, posicao, usuarioId) {
    const destinoData = dataValida(data);

    return bd.transacao(async function (cliente) {
      const irmas = await cliente.query(
        'SELECT id FROM demandas WHERE cliente_id = $1 AND data = $2 AND id <> $3 ORDER BY ordem, id',
        [clienteId, destinoData, id]
      );

      const ids = irmas.rows.map(function (l) { return l.id; });
      const indice = (posicao === null || posicao === undefined || posicao < 0)
        ? ids.length
        : Math.min(posicao, ids.length);
      ids.splice(indice, 0, Number(id));

      for (let i = 0; i < ids.length; i += 1) {
        await cliente.query(
          'UPDATE demandas SET cliente_id=$1, data=$2, ordem=$3, atualizado_em=now(), atualizado_por=$4 WHERE id=$5',
          [clienteId, destinoData, i, usuarioId || null, ids[i]]
        );
      }

      const r = await cliente.query(SELECAO + ' WHERE d.id = $1', [id]);
      return r.rows[0] || null;
    });
  }
};

module.exports = {
  clientes, tags, demandas,
  chaveDeNome, novoUid, novoIdExterno, dataValida, statusValido, texto, textoLongo
};
