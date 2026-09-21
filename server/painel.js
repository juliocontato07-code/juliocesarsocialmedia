'use strict';

/**
 * Números do dashboard.
 *
 * Tudo é contado no banco, a cada pedido. Não existe tabela de resumo nem
 * rotina que recalcula: marcar Concluído já muda o resultado da próxima
 * consulta, porque não há nada em cache para ficar velho.
 *
 * Só leitura. Nenhuma função daqui escreve.
 */

const bd = require('./db');
const { HOJE, PRAZO } = require('./repositorio');

/* Recorte do mês, repetido em toda seção. */
const NO_PERIODO = 'd.data BETWEEN $1 AND $2 AND c.arquivado = false';

const ATRASADA = 'd.status = 0 AND ' + PRAZO + ' < ' + HOJE;

/* Conclusão dentro do dia do prazo. NULL quando não há como medir. */
const NO_PRAZO =
  "d.status = 1 AND d.concluido_em IS NOT NULL AND d.concluido_em < ((" +
  PRAZO + " + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')";

const JUNCAO = 'FROM demandas d JOIN clientes c ON c.id = d.cliente_id';

/**
 * Meses que têm alguma demanda, do mais recente para o mais antigo.
 *
 * Vem do banco em vez de um intervalo gerado, para o seletor não oferecer mês
 * vazio: mês sem demanda no dashboard só mostraria zeros.
 */
async function meses() {
  return bd.varias(
    `SELECT EXTRACT(YEAR FROM d.data)::int AS ano,
            EXTRACT(MONTH FROM d.data)::int AS mes,
            COUNT(*)::int AS total
       ${JUNCAO}
      WHERE c.arquivado = false
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2 DESC`
  );
}

/* ------------------------------------------------------------------ *
 * 4.1 Visão geral                                                     *
 * ------------------------------------------------------------------ */

async function visaoGeral(inicio, fim) {
  return bd.uma(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE d.status = 1)::int AS concluidas,
            COUNT(*) FILTER (WHERE d.status = 0)::int AS abertas,
            COUNT(*) FILTER (WHERE ${ATRASADA})::int AS atrasadas,
            /* denominador do indicador de prazo: só o que tem como medir.
               Concluída sem concluido_em não conta como fora do prazo, conta
               como não medida, senão o número mentiria para baixo. */
            COUNT(*) FILTER (WHERE d.status = 1 AND d.concluido_em IS NOT NULL)::int AS mensuraveis,
            COUNT(*) FILTER (WHERE ${NO_PRAZO})::int AS no_prazo,
            COUNT(*) FILTER (WHERE d.extra)::int AS extras
       ${JUNCAO}
      WHERE ${NO_PERIODO}`,
    [inicio, fim]
  );
}

/* ------------------------------------------------------------------ *
 * 4.2 Produtividade por colaborador                                   *
 * ------------------------------------------------------------------ */

/**
 * Uma linha por pessoa com atribuição no período, mais uma linha juntando o
 * que não tem responsável.
 *
 * O total do mês vai em cada linha (janela sem PARTITION) para a participação
 * ser calculada sem uma segunda consulta e sem risco de os dois números
 * saírem de recortes diferentes.
 */
async function porColaborador(inicio, fim) {
  return bd.varias(
    `SELECT d.responsavel_id AS usuario_id,
            COALESCE(u.usuario, 'sem atribuição') AS nome,
            u.cargo,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE d.status = 1)::int AS concluidas,
            COUNT(*) FILTER (WHERE d.status = 0)::int AS abertas,
            COUNT(*) FILTER (WHERE ${ATRASADA})::int AS atrasadas,
            COUNT(*) FILTER (WHERE d.status = 1 AND d.concluido_em IS NOT NULL)::int AS mensuraveis,
            COUNT(*) FILTER (WHERE ${NO_PRAZO})::int AS no_prazo,
            SUM(COUNT(*)) OVER ()::int AS total_do_mes
       ${JUNCAO}
       LEFT JOIN usuarios u ON u.id = d.responsavel_id
      WHERE ${NO_PERIODO}
      GROUP BY d.responsavel_id, u.usuario, u.cargo
      ORDER BY total DESC, nome`,
    [inicio, fim]
  );
}

/* ------------------------------------------------------------------ *
 * 4.3 Solicitações extras por cliente                                 *
 * ------------------------------------------------------------------ */

async function extrasPorCliente(inicio, fim) {
  return bd.varias(
    `SELECT c.id AS cliente_id, c.nome,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE d.status = 1)::int AS concluidas,
            COUNT(*) FILTER (WHERE d.status = 0)::int AS abertas
       ${JUNCAO}
      WHERE ${NO_PERIODO} AND d.extra = true
      GROUP BY c.id, c.nome
      ORDER BY total DESC, c.nome`,
    [inicio, fim]
  );
}

/* ------------------------------------------------------------------ *
 * 4.4 Demandas por tipo                                               *
 * ------------------------------------------------------------------ */

/* Sai das tags cadastradas, quaisquer que sejam: nada de lista fixa aqui. */
async function porTag(inicio, fim) {
  return bd.varias(
    `SELECT t.id AS tag_id, t.nome, t.cor,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE d.status = 1)::int AS concluidas
       ${JUNCAO}
       JOIN tags t ON t.id = d.tag_id
      WHERE ${NO_PERIODO}
      GROUP BY t.id, t.nome, t.cor
      ORDER BY total DESC, t.nome`,
    [inicio, fim]
  );
}

/* ------------------------------------------------------------------ *
 * 4.5 Clientes com mais demandas                                      *
 * ------------------------------------------------------------------ */

async function porCliente(inicio, fim) {
  return bd.varias(
    `SELECT c.id AS cliente_id, c.nome, c.arroba,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE d.status = 1)::int AS concluidas,
            COUNT(*) FILTER (WHERE d.status = 0)::int AS abertas,
            COUNT(*) FILTER (WHERE ${ATRASADA})::int AS atrasadas
       ${JUNCAO}
      WHERE ${NO_PERIODO}
      GROUP BY c.id, c.nome, c.arroba
      ORDER BY total DESC, c.nome`,
    [inicio, fim]
  );
}

/* ------------------------------------------------------------------ *
 * Tudo de uma vez                                                     *
 * ------------------------------------------------------------------ */

/**
 * O dashboard é uma página só, então busca as cinco seções numa ida.
 * Em paralelo: são consultas independentes e o pool aguenta.
 */
async function tudo(inicio, fim) {
  const [geral, colaboradores, extras, tipos, clientes] = await Promise.all([
    visaoGeral(inicio, fim),
    porColaborador(inicio, fim),
    extrasPorCliente(inicio, fim),
    porTag(inicio, fim),
    porCliente(inicio, fim)
  ]);

  return {
    periodo: { inicio: inicio, fim: fim },
    geral: geral,
    colaboradores: colaboradores,
    extras: extras,
    tipos: tipos,
    clientes: clientes
  };
}

module.exports = {
  meses, visaoGeral, porColaborador, extrasPorCliente, porTag, porCliente, tudo
};
