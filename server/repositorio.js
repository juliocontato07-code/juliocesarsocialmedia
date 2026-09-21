'use strict';

/**
 * Acesso a clientes, tags e demandas.
 * Recebe opcionalmente um cliente de transação para participar de uma
 * operação maior (a importação usa isso).
 */

const crypto = require('crypto');
const bd = require('./db');
const atribuicao = require('./atribuicao');

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

/** Data opcional: '' e null viram null, o resto passa pela validação. */
function dataOpcional(valor) {
  const limpo = texto(valor);
  return limpo === '' ? null : dataValida(limpo);
}

const PRIORIDADES = ['baixa', 'media', 'alta'];

function prioridadeValida(valor) {
  const limpo = texto(valor) || 'media';
  if (PRIORIDADES.indexOf(limpo) === -1) {
    throw new Error('Prioridade inválida: use baixa, media ou alta.');
  }
  return limpo;
}

/* A validação de responsável mora em atribuicao.definir, que é quem grava, e
   agora olha cargos.somente_leitura em vez do texto antigo de cargo. */

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
    const onde = (opcoes && opcoes.incluirArquivadas) ? '' : 'WHERE t.arquivada = false';
    const r = await exec(conexao).query(
      `SELECT t.*, c.nome AS cargo_nome, c.somente_leitura AS cargo_somente_leitura,
              c.ativo AS cargo_ativo
         FROM tags t LEFT JOIN cargos c ON c.id = t.cargo_id
         ` + onde + ' ORDER BY t.ordem, t.id'
    );
    return r.rows;
  },

  async obter(id) {
    return bd.uma(
      `SELECT t.*, c.nome AS cargo_nome, c.somente_leitura AS cargo_somente_leitura,
              c.ativo AS cargo_ativo
         FROM tags t LEFT JOIN cargos c ON c.id = t.cargo_id
        WHERE t.id = $1`, [id]
    );
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
      'INSERT INTO tags (nome, cor, ordem, cargo_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [nome, corValida(dados.cor), ordem.proxima, cargoOpcional(dados.cargo_id)]
    );
    return tags.obter(r.rows[0].id);
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

    await bd.consultar(
      'UPDATE tags SET nome=$2, cor=$3, cargo_id=$4 WHERE id=$1',
      [id, nome, corValida(dados.cor), cargoOpcional(dados.cargo_id)]
    );
    return tags.obter(id);
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

/** Tag pode não ter cargo: aí a criação não atribui ninguém. */
function cargoOpcional(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Cargo inválido.');
  return id;
}

function corValida(valor) {
  const limpo = texto(valor).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(limpo) ? limpo : '#9A9A9A';
}

/* ------------------------------------------------------------------ *
 * Demandas                                                            *
 * ------------------------------------------------------------------ */

/*
 * O fuso está escrito aqui porque o servidor da hospedagem roda em UTC e a
 * equipe trabalha no Brasil. Sem isso, das 21h à meia-noite o "hoje" do
 * servidor já seria amanhã, e demanda no prazo apareceria como atrasada.
 */
const FUSO = 'America/Sao_Paulo';
const HOJE = "((now() AT TIME ZONE '" + FUSO + "')::date)";

/*
 * O prazo É a data da publicação. Não existe prazo separado.
 *
 * A coluna `prazo` continua no banco por causa da regra de migração aditiva,
 * mas o sistema não a lê mais em lugar nenhum — de propósito, para não haver
 * duas respostas possíveis para "qual é o prazo desta demanda".
 */
const PRAZO = 'd.data';

/** A data civil da conclusão, no fuso de São Paulo. */
const DIA_DA_CONCLUSAO = "((d.concluido_em AT TIME ZONE '" + FUSO + "')::date)";

/*
 * EM DIA: a função única do prazo.
 *
 * Toda comparação de prazo do sistema sai daqui — Lista, Dashboard, cards e
 * tela da demanda. Nenhuma tela tem a sua própria versão, porque duas versões
 * divergem no primeiro caso de borda e ninguém descobre qual está certa.
 *
 * A comparação é entre datas civis em São Paulo, nunca entre timestamp e
 * meia-noite: uma demanda está em dia enquanto estiver dentro das 24 horas do
 * dia da publicação, e "dentro do dia" é uma pergunta sobre o calendário de
 * quem trabalha, não sobre o relógio UTC do servidor.
 *
 *   concluída -> a data da conclusão é menor ou igual à data da publicação
 *   pendente  -> hoje é menor ou igual à data da publicação
 *
 * Concluída sem hora registrada devolve NULL: não é atraso, é falta de
 * medição. Quem lê decide como mostrar, e a tela mostra "Em dia" com a
 * ressalva no title, porque afirmar atraso sem evidência seria acusar de graça.
 */
const EM_DIA = `
  CASE WHEN d.status = 1 THEN
         CASE WHEN d.concluido_em IS NULL THEN NULL
              ELSE ${DIA_DA_CONCLUSAO} <= d.data END
       ELSE ${HOJE} <= d.data
  END`;

/*
 * As derivações são calculadas, nunca gravadas: uma coluna "em atraso"
 * ficaria errada sozinha na virada da meia-noite, sem ninguém ter tocado na
 * demanda.
 */
const DERIVADOS = `
         to_char(d.data,'YYYY-MM-DD') AS prazo_efetivo,
         (${EM_DIA}) AS em_dia,
         (${EM_DIA}) IS FALSE AS atrasada,
         (d.data - ${HOJE}) AS dias_para_entrega,
         to_char(${DIA_DA_CONCLUSAO},'YYYY-MM-DD') AS dia_conclusao`;

/**
 * Expressão do concluido_em em função do status que está sendo gravado.
 *
 * O COALESCE é o detalhe que importa: editar o título de uma demanda já
 * concluída não pode reescrever a hora da conclusão para agora. Só quem ainda
 * não tinha hora recebe uma.
 */
function concluidoEm(parametro) {
  return 'CASE WHEN ' + parametro + ' = 1 THEN COALESCE(concluido_em, now()) ELSE NULL END';
}

/*
 * Os responsáveis vêm como array de objetos numa subconsulta, e não por JOIN
 * com GROUP BY: com JOIN, uma demanda de dois responsáveis viraria duas
 * linhas, e todo contador do sistema passaria a contar dobrado.
 */
const RESPONSAVEIS = `
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id', ru.id,
                    'usuario', ru.usuario,
                    'nome_completo', ru.nome_completo,
                    'cargo', rc.nome,
                    'ativo', ru.ativo
                  ) ORDER BY ru.usuario)
             FROM demanda_responsaveis dr
             JOIN usuarios ru ON ru.id = dr.usuario_id
             LEFT JOIN cargos rc ON rc.id = ru.cargo_id
            WHERE dr.demanda_id = d.id
         ), '[]'::json) AS responsaveis`;

const SELECAO = `
  SELECT d.id, d.uid, d.cliente_id, d.tag_id, to_char(d.data,'YYYY-MM-DD') AS data,
         d.titulo, d.descricao, d.link, d.status, d.ordem,
         d.criado_em, d.atualizado_em, d.atualizado_por,
         d.prioridade, d.extra, d.concluido_em,
         to_char(d.data_solicitacao,'YYYY-MM-DD') AS data_solicitacao,${DERIVADOS},
${RESPONSAVEIS},
         t.nome AS tag_nome, t.cor AS tag_cor, t.arquivada AS tag_arquivada,
         t.cargo_id AS tag_cargo_id,
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

  /**
   * Listagem filtrada, usada pela tela de lista.
   * Todo filtro é opcional; sem nenhum, devolve tudo que não está arquivado.
   */
  async listar(filtros) {
    const f = filtros || {};
    const valores = [];
    const onde = [];

    function por(molde, valor) {
      valores.push(valor);
      onde.push(molde.replace('?', '$' + valores.length));
    }

    if (f.inicio) por('d.data >= ?', dataValida(f.inicio));
    if (f.fim) por('d.data <= ?', dataValida(f.fim));
    if (f.clienteId) por('d.cliente_id = ?', Number(f.clienteId));
    if (f.tagId) por('d.tag_id = ?', Number(f.tagId));
    if (f.prioridade) por('d.prioridade = ?', prioridadeValida(f.prioridade));
    if (f.status !== undefined && f.status !== null && f.status !== '') {
      por('d.status = ?', statusValido(f.status));
    }
    if (f.extra) onde.push('d.extra = true');
    if (!f.incluirArquivados) onde.push('c.arquivado = false');

    /* "sem" é escolha explícita: ver o que ninguém pegou ainda */
    if (f.responsavelId === 'sem') {
      onde.push('NOT EXISTS (SELECT 1 FROM demanda_responsaveis dr WHERE dr.demanda_id = d.id)');
    } else if (f.responsavelId) {
      por('EXISTS (SELECT 1 FROM demanda_responsaveis dr WHERE dr.demanda_id = d.id AND dr.usuario_id = ?)',
        Number(f.responsavelId));
    }

    /* o filtro chama a MESMA expressão do SELECT: se a regra mudar, muda nos
       dois ao mesmo tempo, e não existe filtro discordando da coluna */
    if (f.somenteAtrasadas) onde.push('(' + EM_DIA + ') IS FALSE');

    const sql = SELECAO +
      (onde.length ? ' WHERE ' + onde.join(' AND ') : '') +
      ' ORDER BY ' + PRAZO + ', d.data, d.id';

    return bd.varias(sql, valores);
  },

  async criar(dados, usuarioId, conexao) {
    const data = dataValida(dados.data);

    const ordem = await exec(conexao).query(
      'SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM demandas WHERE cliente_id = $1 AND data = $2',
      [dados.cliente_id, data]
    );

    const r = await exec(conexao).query(
      `INSERT INTO demandas (uid, cliente_id, tag_id, data, titulo, descricao, link, status, ordem,
                             atualizado_por, prioridade, data_solicitacao, extra, concluido_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               CASE WHEN $8 = 1 THEN now() ELSE NULL END) RETURNING id`,
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
        usuarioId || null,
        prioridadeValida(dados.prioridade),
        dataOpcional(dados.data_solicitacao),
        Boolean(dados.extra)
      ]
    );

    const id = r.rows[0].id;

    /*
     * Atribuição.
     *
     * Lista explícita vinda do formulário manda; sem lista, a regra da tag
     * resolve. É por isso que o admin consegue mudar os responsáveis
     * pré-preenchidos sem que a regra escreva por cima depois.
     */
    if (Array.isArray(dados.responsaveis)) {
      await atribuicao.definir(id, dados.responsaveis, conexao);
    } else {
      await atribuicao.automatica(id, dados.tag_id, conexao);
    }

    return demandas.obter(id, conexao);
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

    /* status pode vir ou não; quando vem, concluido_em acompanha */
    const status = dados.status === undefined ? atual.status : statusValido(dados.status);

    /*
     * A data de conclusão é editável pelo admin, para corrigir quando alguém
     * esqueceu de marcar no dia. Três casos, e a ordem importa:
     *
     *   status virou 0          -> limpa, custe o que vier no corpo
     *   veio data no corpo      -> grava o que o admin escreveu
     *   não veio nada no corpo  -> preserva o que já estava
     *
     * O horário é meio-dia em São Paulo, e não meia-noite: meia-noite em SP é
     * 03:00 UTC do mesmo dia, e qualquer arredondamento para trás jogaria a
     * data civil para o dia anterior. Meio-dia não tem essa borda.
     */
    let conclusao;
    if (status === 0) {
      conclusao = { sql: 'NULL', valor: null };
    } else if (dados.concluido_em !== undefined) {
      const dia = dataOpcional(dados.concluido_em);
      conclusao = dia === null
        ? { sql: 'NULL', valor: null }
        : { sql: "(($V)::date + time '12:00') AT TIME ZONE '" + FUSO + "'", valor: dia };
    } else {
      conclusao = { sql: 'COALESCE(concluido_em, now())', valor: null };
    }

    const valores = [
      id, dados.cliente_id, dados.tag_id, data,
      texto(dados.titulo),
      dados.descricao === undefined ? atual.descricao : textoLongo(dados.descricao),
      texto(dados.link), ordem, usuarioId || null,
      dados.prioridade === undefined ? atual.prioridade : prioridadeValida(dados.prioridade),
      dados.data_solicitacao === undefined ? atual.data_solicitacao : dataOpcional(dados.data_solicitacao),
      dados.extra === undefined ? atual.extra : Boolean(dados.extra),
      status
    ];

    let sqlConclusao = conclusao.sql;
    if (conclusao.valor !== null) {
      valores.push(conclusao.valor);
      sqlConclusao = conclusao.sql.replace('$V', '$' + valores.length);
    }

    await bd.consultar(
      `UPDATE demandas SET cliente_id=$2, tag_id=$3, data=$4, titulo=$5, descricao=$6,
       link=$7, ordem=$8, atualizado_em=now(), atualizado_por=$9,
       prioridade=$10, data_solicitacao=$11, extra=$12,
       status=$13, concluido_em=` + sqlConclusao + ' WHERE id=$1',
      valores
    );

    /* Lista ausente significa "não mexi nos responsáveis", não "tire todos". */
    if (Array.isArray(dados.responsaveis)) {
      await atribuicao.definir(id, dados.responsaveis);
    }

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
      /* concluído carimba a hora; voltar para pendente limpa o carimbo */
      partes.push('concluido_em = ' + concluidoEm('$' + valores.length));
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
       concluido_em = CASE WHEN status = 0 THEN now() ELSE NULL END,
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
      status: 0,
      /* a cópia herda a distribuição do trabalho e a prioridade; a data do
         pedido não, que é do original. Os responsáveis vão explícitos para a
         cópia sair com os mesmos nomes, e não com quem a regra da tag diria
         hoje — a cópia é do trabalho de alguém. */
      responsaveis: (original.responsaveis || []).map(function (r) { return r.id; }),
      prioridade: original.prioridade,
      extra: original.extra
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
  chaveDeNome, novoUid, novoIdExterno, dataValida, dataOpcional, statusValido,
  prioridadeValida, texto, textoLongo,
  PRIORIDADES, FUSO, HOJE, PRAZO, EM_DIA
};
