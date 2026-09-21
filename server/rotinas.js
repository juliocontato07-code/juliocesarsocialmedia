'use strict';

/**
 * Rotinas: trabalho recorrente do time.
 *
 * Rotina não é demanda. Não existe função aqui que crie demanda, nem no
 * repositório de demandas que crie rotina. São dois assuntos separados, sem
 * referência de um para o outro, e é de propósito.
 */

const bd = require('./db');

/* Siglas dos dias, na ordem que o Postgres usa em EXTRACT(DOW): domingo = 0. */
const SIGLAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

const FREQUENCIAS = ['diaria', 'semanal', 'mensal'];

function texto(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function dataValida(valor) {
  const limpo = texto(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpo)) {
    throw new Error('Data inválida. Use o formato AAAA-MM-DD.');
  }
  return limpo;
}

/** 'HH:MM' ou null. O banco guarda TIME, que aceita 'HH:MM'. */
function horarioValido(valor) {
  const limpo = texto(valor);
  if (limpo === '') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(limpo)) {
    throw new Error('Horário inválido. Use HH:MM, de 00:00 a 23:59.');
  }
  return limpo;
}

/**
 * Valida os campos que dependem da frequência.
 *
 * Semanal sem dia nenhum e mensal sem dia do mês nunca apareceriam na tela: a
 * rotina existiria no banco e não seria cobrada de ninguém. Melhor recusar na
 * entrada do que deixar virar tarefa invisível.
 */
function recorrencia(dados) {
  const frequencia = texto(dados.frequencia);
  if (FREQUENCIAS.indexOf(frequencia) === -1) {
    throw new Error('Frequência inválida: use diaria, semanal ou mensal.');
  }

  if (frequencia === 'semanal') {
    const dias = texto(dados.dias_semana).toUpperCase().split(',')
      .map(function (d) { return d.trim(); })
      .filter(function (d) { return d !== ''; });

    const invalido = dias.find(function (d) { return SIGLAS.indexOf(d) === -1; });
    if (invalido) throw new Error('Dia da semana inválido: ' + invalido + '.');
    if (dias.length === 0) throw new Error('Rotina semanal precisa de ao menos um dia da semana.');

    /* grava na ordem da semana, não na ordem em que a pessoa clicou */
    const ordenados = SIGLAS.filter(function (s) { return dias.indexOf(s) > -1; });
    return { frequencia: frequencia, dias_semana: ordenados.join(','), dia_mes: null };
  }

  if (frequencia === 'mensal') {
    const dia = Number(dados.dia_mes);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      throw new Error('Rotina mensal precisa de um dia do mês, de 1 a 31.');
    }
    return { frequencia: frequencia, dias_semana: null, dia_mes: dia };
  }

  return { frequencia: frequencia, dias_semana: null, dia_mes: null };
}

const SELECAO = `
  SELECT r.id, r.usuario_id, r.tarefa, to_char(r.horario,'HH24:MI') AS horario,
         r.frequencia, r.dias_semana, r.dia_mes, r.ativa, r.criado_em,
         u.usuario AS usuario_nome, u.cargo AS usuario_cargo, u.ativo AS usuario_ativo
  FROM rotinas r
  JOIN usuarios u ON u.id = r.usuario_id
`;

/* Horário vazio vai para o fim da lista, não para o começo. */
const ORDEM = ' ORDER BY r.horario NULLS LAST, r.id';

/* ------------------------------------------------------------------ *
 * Cadastro                                                            *
 * ------------------------------------------------------------------ */

const rotinas = {
  /** Lista. Sem usuarioId, lista do time inteiro (só admin chega assim). */
  async listar(opcoes) {
    const o = opcoes || {};
    const onde = [];
    const valores = [];

    if (o.usuarioId) {
      valores.push(Number(o.usuarioId));
      onde.push('r.usuario_id = $' + valores.length);
    }
    if (!o.incluirInativas) onde.push('r.ativa = true');

    return bd.varias(
      SELECAO + (onde.length ? ' WHERE ' + onde.join(' AND ') : '') + ORDEM,
      valores
    );
  },

  async obter(id) {
    return bd.uma(SELECAO + ' WHERE r.id = $1', [id]);
  },

  async criar(dados) {
    const tarefa = texto(dados.tarefa);
    if (tarefa === '') throw new Error('Descreva a tarefa da rotina.');
    if (tarefa.length > 200) throw new Error('A tarefa passou de 200 caracteres.');

    const dono = Number(dados.usuario_id);
    const pessoa = await bd.uma('SELECT id, ativo FROM usuarios WHERE id = $1', [dono]);
    if (!pessoa) throw new Error('Esse usuário não existe.');
    if (!pessoa.ativo) throw new Error('Esse acesso está desativado e não pode receber rotina.');

    const r = recorrencia(dados);

    const criada = await bd.uma(
      `INSERT INTO rotinas (usuario_id, tarefa, horario, frequencia, dias_semana, dia_mes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [dono, tarefa, horarioValido(dados.horario), r.frequencia, r.dias_semana, r.dia_mes]
    );

    return rotinas.obter(criada.id);
  },

  async atualizar(id, dados) {
    const atual = await rotinas.obter(id);
    if (!atual) throw new Error('Rotina não encontrada.');

    const tarefa = texto(dados.tarefa);
    if (tarefa === '') throw new Error('Descreva a tarefa da rotina.');

    const dono = dados.usuario_id === undefined ? atual.usuario_id : Number(dados.usuario_id);
    const pessoa = await bd.uma('SELECT id, ativo FROM usuarios WHERE id = $1', [dono]);
    if (!pessoa) throw new Error('Esse usuário não existe.');

    const r = recorrencia(dados);

    await bd.consultar(
      `UPDATE rotinas SET usuario_id=$2, tarefa=$3, horario=$4, frequencia=$5,
       dias_semana=$6, dia_mes=$7 WHERE id=$1`,
      [id, dono, tarefa, horarioValido(dados.horario), r.frequencia, r.dias_semana, r.dia_mes]
    );

    return rotinas.obter(id);
  },

  /* Desativar em vez de apagar: os checks já marcados continuam valendo como
     histórico, e apagar a rotina levaria as referências com ela. */
  async definirAtiva(id, ativa) {
    const r = await bd.consultar(
      'UPDATE rotinas SET ativa = $2 WHERE id = $1 RETURNING id', [id, Boolean(ativa)]
    );
    if (r.rowCount === 0) throw new Error('Rotina não encontrada.');
    return rotinas.obter(id);
  }
};

/* ------------------------------------------------------------------ *
 * O dia                                                               *
 * ------------------------------------------------------------------ */

/**
 * Rotinas que valem numa data, já com o check daquele dia.
 *
 * O filtro de recorrência é montado com o dia da semana e o dia do mês
 * calculados aqui, em JavaScript, em vez de EXTRACT dentro do SQL: fica menos
 * SQL para ler e permite tratar o caso do dia 31.
 */
async function doDia(data, opcoes) {
  const o = opcoes || {};
  const dia = dataValida(data);

  const objeto = new Date(dia + 'T12:00:00');   /* meio-dia evita virada de fuso */
  const sigla = SIGLAS[objeto.getDay()];
  const diaDoMes = objeto.getDate();
  const ultimoDoMes = new Date(objeto.getFullYear(), objeto.getMonth() + 1, 0).getDate();

  const valores = [dia, sigla, diaDoMes, ultimoDoMes];
  const onde = [
    'r.ativa = true',
    'u.ativo = true',
    `(
      r.frequencia = 'diaria'
      OR (r.frequencia = 'semanal' AND $2 = ANY(string_to_array(COALESCE(r.dias_semana,''), ',')))
      OR (r.frequencia = 'mensal' AND (
            r.dia_mes = $3
            /* dia 31 em mês de 30: cai no último dia, senão a tarefa nunca
               apareceria nesses meses */
            OR (r.dia_mes > $4 AND $3 = $4)
          ))
    )`
  ];

  if (o.usuarioId) {
    valores.push(Number(o.usuarioId));
    onde.push('r.usuario_id = $' + valores.length);
  }

  return bd.varias(
    `SELECT r.id, r.usuario_id, r.tarefa, to_char(r.horario,'HH24:MI') AS horario,
            r.frequencia, r.dias_semana, r.dia_mes,
            u.usuario AS usuario_nome, u.cargo AS usuario_cargo,
            COALESCE(k.concluida, false) AS concluida,
            k.marcado_em
       FROM rotinas r
       JOIN usuarios u ON u.id = r.usuario_id
       LEFT JOIN rotina_checks k ON k.rotina_id = r.id AND k.data = $1
      WHERE ${onde.join(' AND ')}
      ORDER BY r.horario NULLS LAST, u.usuario, r.id`,
    valores
  );
}

/**
 * Marca ou desmarca o check de uma data.
 *
 * O UNIQUE (rotina_id, data) faz o ON CONFLICT resolver os dois casos com um
 * comando só, sem precisar consultar antes se o check já existe.
 */
async function marcar(rotinaId, data, concluida) {
  const dia = dataValida(data);
  const valor = Boolean(concluida);

  const r = await bd.uma(
    `INSERT INTO rotina_checks (rotina_id, data, concluida, marcado_em)
     VALUES ($1,$2,$3, CASE WHEN $3 THEN now() ELSE NULL END)
     ON CONFLICT (rotina_id, data) DO UPDATE
        SET concluida = EXCLUDED.concluida, marcado_em = EXCLUDED.marcado_em
     RETURNING rotina_id, to_char(data,'YYYY-MM-DD') AS data, concluida, marcado_em`,
    [Number(rotinaId), dia, valor]
  );

  return r;
}

/* ------------------------------------------------------------------ *
 * Consolidado do time (admin)                                         *
 * ------------------------------------------------------------------ */

/**
 * Por pessoa: quantas tarefas do dia foram marcadas, e o cumprimento nos
 * últimos 7 e 30 dias.
 *
 * O denominador dos períodos é o número de ocorrências que a rotina realmente
 * teve nos dias corridos, não rotina × dias: uma tarefa de segunda-feira
 * aparece 1 vez em 7 dias, não 7. generate_series percorre os dias e a mesma
 * regra de recorrência do doDia decide se aquele dia contava.
 */
async function consolidado(data) {
  const dia = dataValida(data);

  /* Sigla do dia a partir do DOW do Postgres (domingo = 0). Escrito como
     array indexado, e não com to_char(d,'DY'), porque to_char devolve a
     abreviação em inglês e depende do lc_time do servidor. */
  const SIGLA_DO_DIA =
    "(ARRAY['DOM','SEG','TER','QUA','QUI','SEX','SAB'])[EXTRACT(DOW FROM dias.d)::int + 1]";

  const ULTIMO_DO_MES =
    "EXTRACT(DAY FROM (date_trunc('month', dias.d) + interval '1 month - 1 day'))";

  return bd.varias(
    `WITH dias AS (
       SELECT gs::date AS d
         FROM generate_series($1::date - 29, $1::date, interval '1 day') AS gs
     ),
     ocorrencias AS (
       SELECT r.id AS rotina_id, r.usuario_id, dias.d
         FROM rotinas r
         CROSS JOIN dias
        WHERE r.ativa = true
          AND (
               r.frequencia = 'diaria'
            OR (r.frequencia = 'semanal'
                AND ${SIGLA_DO_DIA} = ANY(string_to_array(COALESCE(r.dias_semana,''), ',')))
            OR (r.frequencia = 'mensal' AND (
                  r.dia_mes = EXTRACT(DAY FROM dias.d)
                  OR (r.dia_mes > ${ULTIMO_DO_MES} AND EXTRACT(DAY FROM dias.d) = ${ULTIMO_DO_MES})
               ))
          )
     ),
     marcadas AS (
       SELECT o.usuario_id, o.rotina_id, o.d, COALESCE(k.concluida, false) AS feita
         FROM ocorrencias o
         LEFT JOIN rotina_checks k ON k.rotina_id = o.rotina_id AND k.data = o.d
     )
     SELECT u.id AS usuario_id, u.usuario AS nome, u.cargo,
            COUNT(*) FILTER (WHERE m.d = $1::date)::int AS hoje_total,
            COUNT(*) FILTER (WHERE m.d = $1::date AND m.feita)::int AS hoje_feitas,
            COUNT(*) FILTER (WHERE m.d >= $1::date - 6)::int AS sete_total,
            COUNT(*) FILTER (WHERE m.d >= $1::date - 6 AND m.feita)::int AS sete_feitas,
            COUNT(*)::int AS trinta_total,
            COUNT(*) FILTER (WHERE m.feita)::int AS trinta_feitas
       FROM marcadas m
       JOIN usuarios u ON u.id = m.usuario_id
      WHERE u.ativo = true
      GROUP BY u.id, u.usuario, u.cargo
      ORDER BY u.usuario`,
    [dia]
  );
}

module.exports = {
  rotinas, doDia, marcar, consolidado,
  SIGLAS, FREQUENCIAS, dataValida
};
