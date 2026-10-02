'use strict';

/**
 * Cargos e a atribuição automática de responsáveis.
 *
 * A cadeia é: tag -> cargo -> profissionais ativos daquele cargo.
 *
 * A atribuição é resolvida no momento em que a demanda é criada e gravada em
 * demanda_responsaveis. Não é uma consulta viva: se amanhã alguém trocar de
 * cargo ou entrar no time, as demandas antigas continuam com quem as recebeu.
 * Isso é de propósito — um histórico que se reescreve sozinho não serve para
 * medir produtividade de ninguém.
 */

const bd = require('./db');

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function exec(conexao) {
  return conexao || bd;
}

/* ------------------------------------------------------------------ *
 * Cargos                                                             *
 * ------------------------------------------------------------------ */

const SELECAO_CARGO = `
  SELECT c.id, c.nome, c.somente_leitura, c.acessa_credenciais, c.ordem, c.ativo,
         (SELECT COUNT(*)::int FROM usuarios u WHERE u.cargo_id = c.id AND u.ativo = true) AS pessoas,
         (SELECT COUNT(*)::int FROM tags t WHERE t.cargo_id = c.id AND t.arquivada = false) AS tags
  FROM cargos c
`;

/**
 * Somente leitura cancela o acesso ao cofre, aqui na gravação e não só na
 * checagem.
 *
 * A tela deixa marcar as duas, e a combinação "só pode ler, mas pode criar e
 * apagar senha de cliente" não é uma permissão que alguém queira: é um
 * descuido de quem clicou. Normalizar no momento de gravar evita que a
 * contradição fique guardada no banco esperando alguém desmarcar o somente
 * leitura e descobrir um acesso ao cofre que nunca pretendeu conceder.
 */
function credenciaisDe(dados) {
  if (Boolean(dados.somente_leitura)) return false;
  return Boolean(dados.acessa_credenciais);
}

const cargos = {
  async listar(opcoes) {
    const o = opcoes || {};
    const onde = o.incluirInativos ? '' : ' WHERE c.ativo = true';
    return bd.varias(SELECAO_CARGO + onde + ' ORDER BY c.ordem, c.nome');
  },

  async obter(id, conexao) {
    const r = await exec(conexao).query(SELECAO_CARGO + ' WHERE c.id = $1', [id]);
    return r.rows[0] || null;
  },

  async criar(dados) {
    const nome = texto(dados.nome);
    if (nome === '') throw new Error('O nome do cargo é obrigatório.');
    if (nome.length > 60) throw new Error('O nome do cargo passou de 60 caracteres.');

    const existente = await bd.uma('SELECT id, ativo FROM cargos WHERE lower(nome) = lower($1)', [nome]);
    if (existente) {
      throw new Error(existente.ativo
        ? 'Já existe um cargo com esse nome.'
        : 'Existe um cargo desativado com esse nome. Reative em vez de criar outro.');
    }

    const ordem = await bd.uma('SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM cargos');
    const criado = await bd.uma(
      'INSERT INTO cargos (nome, somente_leitura, acessa_credenciais, ordem) ' +
      'VALUES ($1,$2,$3,$4) RETURNING id',
      [nome, Boolean(dados.somente_leitura), credenciaisDe(dados), ordem.proxima]
    );

    return cargos.obter(criado.id);
  },

  async atualizar(id, dados) {
    const nome = texto(dados.nome);
    if (nome === '') throw new Error('O nome do cargo é obrigatório.');

    const conflito = await bd.uma(
      'SELECT id FROM cargos WHERE lower(nome) = lower($1) AND id <> $2', [nome, id]
    );
    if (conflito) throw new Error('Já existe outro cargo com esse nome.');

    const somenteLeitura = Boolean(dados.somente_leitura);
    const credenciais = credenciaisDe(dados);

    /* Marcar um cargo como somente leitura tira do trabalho todo mundo que
       está nele. Solta as atribuições na mesma transação, senão ficariam
       demandas apontando para quem não pode executar. */
    return bd.transacao(async function (cx) {
      await cx.query(
        'UPDATE cargos SET nome = $2, somente_leitura = $3, acessa_credenciais = $4 WHERE id = $1',
        [id, nome, somenteLeitura, credenciais]);

      let liberadas = 0;
      if (somenteLeitura) {
        const r = await cx.query(
          `DELETE FROM demanda_responsaveis
            WHERE usuario_id IN (SELECT id FROM usuarios WHERE cargo_id = $1)`,
          [id]
        );
        liberadas = r.rowCount;
      }

      const atualizado = await cargos.obter(id, cx);
      atualizado.atribuicoes_liberadas = liberadas;
      return atualizado;
    });
  },

  /* Cargo não se exclui, só desativa: excluir levaria a referência dos
     usuários e das tags que apontam para ele. */
  async definirAtivo(id, ativo) {
    if (!ativo) {
      const uso = await bd.uma(
        'SELECT (SELECT COUNT(*)::int FROM usuarios WHERE cargo_id = $1 AND ativo = true) pessoas,' +
        ' (SELECT COUNT(*)::int FROM tags WHERE cargo_id = $1 AND arquivada = false) tags', [id]
      );
      if (uso.pessoas > 0) {
        throw new Error('Há ' + uso.pessoas + ' pessoa(s) ativa(s) neste cargo. Mude o cargo delas primeiro.');
      }
      if (uso.tags > 0) {
        throw new Error('Há ' + uso.tags + ' tag(s) apontando para este cargo. Troque o cargo delas primeiro.');
      }
    }

    const r = await bd.consultar('UPDATE cargos SET ativo = $2 WHERE id = $1 RETURNING id',
      [id, Boolean(ativo)]);
    if (r.rowCount === 0) throw new Error('Cargo não encontrado.');

    return cargos.obter(id);
  },

  async reordenar(ids) {
    await bd.transacao(async function (cx) {
      for (let i = 0; i < ids.length; i += 1) {
        await cx.query('UPDATE cargos SET ordem = $1 WHERE id = $2', [i, ids[i]]);
      }
    });
    return cargos.listar({ incluirInativos: true });
  }
};

/* ------------------------------------------------------------------ *
 * Quem a regra atribui                                               *
 * ------------------------------------------------------------------ */

/**
 * Os profissionais que a regra atribuiria a uma tag agora.
 *
 * Cargo somente_leitura fica fora mesmo se alguém apontar uma tag para ele:
 * quem não altera nada também não executa.
 */
async function pessoasDaTag(tagId, conexao) {
  if (!tagId) return [];

  const r = await exec(conexao).query(
    `SELECT u.id, u.usuario, u.nome_completo, c.nome AS cargo
       FROM tags t
       JOIN cargos c ON c.id = t.cargo_id
       JOIN usuarios u ON u.cargo_id = c.id
      WHERE t.id = $1
        AND c.ativo = true
        AND c.somente_leitura = false
        AND u.ativo = true
      ORDER BY u.usuario`,
    [tagId]
  );

  return r.rows;
}

/** O mesmo, para várias tags de uma vez: a prévia da importação usa isto. */
async function pessoasPorTag(tagIds, conexao) {
  const mapa = {};
  if (!tagIds || tagIds.length === 0) return mapa;

  const r = await exec(conexao).query(
    `SELECT t.id AS tag_id, u.id, u.usuario, u.nome_completo, c.nome AS cargo
       FROM tags t
       JOIN cargos c ON c.id = t.cargo_id
       JOIN usuarios u ON u.cargo_id = c.id
      WHERE t.id = ANY($1)
        AND c.ativo = true
        AND c.somente_leitura = false
        AND u.ativo = true
      ORDER BY t.id, u.usuario`,
    [tagIds]
  );

  for (const linha of r.rows) {
    if (!mapa[linha.tag_id]) mapa[linha.tag_id] = [];
    mapa[linha.tag_id].push({
      id: linha.id, usuario: linha.usuario,
      nome_completo: linha.nome_completo, cargo: linha.cargo
    });
  }

  return mapa;
}

/** Tags sem cargo configurado, para a prévia avisar. */
async function tagsSemCargo(tagIds, conexao) {
  if (!tagIds || tagIds.length === 0) return [];
  const r = await exec(conexao).query(
    'SELECT id, nome FROM tags WHERE id = ANY($1) AND cargo_id IS NULL ORDER BY nome',
    [tagIds]
  );
  return r.rows;
}

/* ------------------------------------------------------------------ *
 * Gravar a atribuição                                                *
 * ------------------------------------------------------------------ */

/**
 * Define os responsáveis de uma demanda, trocando o conjunto inteiro.
 *
 * Recusa quem está inativo e quem tem cargo somente leitura, mesmo que o id
 * venha do front: a regra vale no servidor.
 */
async function definir(demandaId, usuarioIds, conexao) {
  const cx = exec(conexao);
  const ids = Array.from(new Set((usuarioIds || []).map(Number).filter(function (n) {
    return Number.isInteger(n) && n > 0;
  })));

  if (ids.length > 0) {
    const validos = await cx.query(
      `SELECT u.id, u.usuario, u.ativo, COALESCE(c.somente_leitura, false) AS somente_leitura
         FROM usuarios u LEFT JOIN cargos c ON c.id = u.cargo_id
        WHERE u.id = ANY($1)`,
      [ids]
    );

    if (validos.rows.length !== ids.length) throw new Error('Responsável inexistente na lista.');

    for (const pessoa of validos.rows) {
      if (!pessoa.ativo) {
        throw new Error(pessoa.usuario + ' está com o acesso desativado e não pode receber demanda.');
      }
      if (pessoa.somente_leitura) {
        throw new Error(pessoa.usuario + ' tem cargo somente leitura e não pode ser responsável.');
      }
    }
  }

  await cx.query('DELETE FROM demanda_responsaveis WHERE demanda_id = $1', [demandaId]);

  for (const id of ids) {
    await cx.query(
      'INSERT INTO demanda_responsaveis (demanda_id, usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [demandaId, id]
    );
  }

  return ids;
}

/**
 * Atribuição automática de uma demanda nova.
 *
 * Só é chamada na criação. Tag sem cargo, ou cargo sem ninguém ativo, deixa a
 * demanda sem responsável — que é estado legítimo, e a tela mostra isso.
 */
async function automatica(demandaId, tagId, conexao) {
  const pessoas = await pessoasDaTag(tagId, conexao);
  if (pessoas.length === 0) return [];

  const cx = exec(conexao);
  for (const pessoa of pessoas) {
    await cx.query(
      'INSERT INTO demanda_responsaveis (demanda_id, usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [demandaId, pessoa.id]
    );
  }

  return pessoas.map(function (p) { return p.id; });
}

/* ------------------------------------------------------------------ *
 * Mutirão nas demandas antigas                                       *
 * ------------------------------------------------------------------ */

/**
 * Quantas demandas estão sem ninguém, quantas a regra resolve, e o motivo das
 * que ela não resolve.
 *
 * O motivo importa porque cada um se conserta num lugar diferente: tag sem
 * cargo se ajusta no bloco de Tags, cargo sem ninguém ativo se ajusta no de
 * Profissionais. Dizer só "23 ficaram de fora" manda a pessoa procurar.
 */
async function previaDoMutirao() {
  const linhas = await bd.varias(
    `WITH sem AS (
       SELECT d.id, t.nome AS tag, t.cargo_id, cg.nome AS cargo,
              cg.ativo AS cargo_ativo, cg.somente_leitura,
              (SELECT COUNT(*)::int FROM usuarios u
                WHERE u.cargo_id = t.cargo_id AND u.ativo = true) AS pessoas
         FROM demandas d
         JOIN clientes c ON c.id = d.cliente_id
         JOIN tags t ON t.id = d.tag_id
         LEFT JOIN cargos cg ON cg.id = t.cargo_id
        WHERE c.arquivado = false
          AND NOT EXISTS (SELECT 1 FROM demanda_responsaveis dr WHERE dr.demanda_id = d.id)
     )
     SELECT tag, COALESCE(cargo, '') AS cargo, pessoas,
            CASE
              WHEN cargo_id IS NULL      THEN 'tag_sem_cargo'
              WHEN cargo_ativo = false   THEN 'cargo_desativado'
              WHEN somente_leitura       THEN 'cargo_somente_leitura'
              WHEN pessoas = 0           THEN 'cargo_sem_ninguem'
              ELSE 'resolvida'
            END AS motivo,
            COUNT(*)::int AS demandas
       FROM sem
      GROUP BY tag, cargo, pessoas, cargo_id, cargo_ativo, somente_leitura
      ORDER BY demandas DESC`
  );

  const resumo = { sem_responsavel: 0, com_solucao: 0, sem_solucao: 0, motivos: [], destinos: [] };

  for (const linha of linhas) {
    resumo.sem_responsavel += linha.demandas;

    if (linha.motivo === 'resolvida') {
      resumo.com_solucao += linha.demandas;
      resumo.destinos.push({ tag: linha.tag, cargo: linha.cargo, demandas: linha.demandas });
    } else {
      resumo.sem_solucao += linha.demandas;
      resumo.motivos.push({
        tag: linha.tag, cargo: linha.cargo, motivo: linha.motivo, demandas: linha.demandas
      });
    }
  }

  return resumo;
}

/**
 * Aplica a regra às demandas que ainda não têm ninguém.
 *
 * Não toca em demanda que já tenha responsável — o NOT EXISTS é o que garante
 * isso, e é a diferença entre completar o que falta e reescrever o histórico.
 */
async function mutirao() {
  return bd.transacao(async function (cx) {
    const r = await cx.query(
      `INSERT INTO demanda_responsaveis (demanda_id, usuario_id)
       SELECT d.id, u.id
         FROM demandas d
         JOIN clientes c ON c.id = d.cliente_id
         JOIN tags t ON t.id = d.tag_id
         JOIN cargos cg ON cg.id = t.cargo_id
         JOIN usuarios u ON u.cargo_id = cg.id
        WHERE c.arquivado = false
          AND cg.ativo = true
          AND cg.somente_leitura = false
          AND u.ativo = true
          AND NOT EXISTS (SELECT 1 FROM demanda_responsaveis dr WHERE dr.demanda_id = d.id)
       ON CONFLICT DO NOTHING
       RETURNING demanda_id`
    );

    const demandas = new Set(r.rows.map(function (l) { return l.demanda_id; }));

    return { atribuicoes: r.rowCount, demandas: demandas.size };
  });
}

module.exports = {
  cargos, pessoasDaTag, pessoasPorTag, tagsSemCargo,
  definir, automatica, previaDoMutirao, mutirao
};
