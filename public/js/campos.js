'use strict';

/**
 * Controles compartilhados dos campos novos da demanda.
 *
 * Existem aqui, e não duplicados, porque os mesmos cinco campos aparecem em
 * três lugares — modal de criação, tela da demanda e filtros da lista — e
 * "prioridade" com opções diferentes em cada lugar seria um bug esperando
 * acontecer.
 */
(function () {
  const el = UI.el;

  const PRIORIDADES = [
    { id: 'baixa', nome: 'Baixa' },
    { id: 'media', nome: 'Média' },
    { id: 'alta', nome: 'Alta' }
  ];

  function nomePrioridade(id) {
    const achada = PRIORIDADES.find(function (p) { return p.id === id; });
    return achada ? achada.nome : 'Média';
  }

  /**
   * Seletor de responsável. A opção vazia é "sem responsável", que é estado
   * legítimo: demanda que ainda não foi distribuída.
   *
   * Espectador não entra na lista — o servidor também recusa, mas oferecer o
   * nome aqui seria prometer o que vai dar erro.
   */
  function seletorResponsavel(selecionadoId, opcoes) {
    const config = opcoes || {};
    const pessoas = Estado.dados.atribuiveis;

    const itens = [
      el('option', {
        value: '',
        selected: !selecionadoId,
        texto: config.rotuloVazio || 'Sem responsável'
      })
    ];

    for (const pessoa of pessoas) {
      itens.push(el('option', {
        value: String(pessoa.id),
        selected: pessoa.id === Number(selecionadoId),
        texto: pessoa.usuario + ' — ' + Estado.nomeCargo(pessoa.cargo)
      }));
    }

    /* Quem já é responsável mas saiu da lista (desativado, ou virou
       espectador) continua aparecendo, senão abrir a demanda apagaria a
       atribuição sem ninguém pedir. */
    const conhecido = pessoas.some(function (p) { return p.id === Number(selecionadoId); });
    if (selecionadoId && !conhecido) {
      itens.push(el('option', {
        value: String(selecionadoId),
        selected: true,
        texto: (config.nomeAtual || 'responsável atual') + ' (fora da lista)'
      }));
    }

    return el('select', { class: 'entrada' }, itens);
  }

  function seletorPrioridade(selecionada) {
    return el('select', { class: 'entrada' }, PRIORIDADES.map(function (p) {
      return el('option', {
        value: p.id,
        selected: p.id === (selecionada || 'media'),
        texto: p.nome
      });
    }));
  }

  /**
   * Caixa de "solicitação extra".
   * Devolve { elemento, marcado(), definir(valor), caixa } para quem precisa
   * ligar o evento de alteração.
   */
  function marcaExtra(valor) {
    const caixa = el('input', { type: 'checkbox' });
    caixa.checked = Boolean(valor);

    const elemento = el('label', { class: 'campo-marca' }, [
      caixa,
      el('span', {}, [
        el('span', { class: 'campo-marca-titulo', texto: 'Solicitação extra' }),
        el('span', {
          class: 'campo-dica',
          texto: 'Fora do escopo contratado. Entra no relatório de extras por cliente.'
        })
      ])
    ]);

    return {
      elemento: elemento,
      caixa: caixa,
      marcado: function () { return caixa.checked; },
      definir: function (v) { caixa.checked = Boolean(v); }
    };
  }

  /* ------------------------------------------------------------------ *
   * Indicador de prazo                                                  *
   * ------------------------------------------------------------------ */

  /**
   * Texto e tom do indicador, a partir das derivações que vêm do servidor.
   *
   * A leitura é sempre a mesma, em card, lista e tela: concluída dentro do
   * prazo é OK, concluída depois ou pendente vencida é atraso, e pendente em
   * dia mostra quanto falta.
   */
  function prazoSituacao(demanda) {
    const dias = Number(demanda.dias_para_entrega);

    if (demanda.status === 1) {
      if (demanda.no_prazo === true) return { tom: 'ok', texto: 'OK', detalhe: 'Concluída dentro do prazo' };
      if (demanda.no_prazo === false) return { tom: 'atraso', texto: 'Em atraso', detalhe: 'Concluída depois do prazo' };
      /* concluída antes de existir registro de conclusão: não há o que medir,
         e chamar de atraso seria inventar um dado que não existe */
      return { tom: 'neutro', texto: '—', detalhe: 'Concluída sem hora registrada' };
    }

    if (demanda.atrasada) {
      const quanto = Number.isFinite(dias) && dias < 0
        ? (dias === -1 ? 'há 1 dia' : 'há ' + Math.abs(dias) + ' dias')
        : '';
      return { tom: 'atraso', texto: 'Em atraso', detalhe: ('Prazo vencido ' + quanto).trim() };
    }

    if (!Number.isFinite(dias)) return { tom: 'neutro', texto: '—', detalhe: '' };
    if (dias === 0) return { tom: 'hoje', texto: 'hoje', detalhe: 'O prazo é hoje' };
    if (dias === 1) return { tom: 'perto', texto: '1 dia', detalhe: 'Falta 1 dia' };
    if (dias <= 3) return { tom: 'perto', texto: dias + ' dias', detalhe: 'Faltam ' + dias + ' dias' };
    return { tom: 'neutro', texto: dias + ' dias', detalhe: 'Faltam ' + dias + ' dias' };
  }

  /** O indicador como elemento, para a tabela da lista. */
  function selo(demanda) {
    const s = prazoSituacao(demanda);
    return el('span', {
      class: 'selo-prazo selo-prazo-' + s.tom,
      title: s.detalhe,
      texto: s.texto
    });
  }

  window.Campos = {
    PRIORIDADES: PRIORIDADES,
    nomePrioridade: nomePrioridade,
    seletorResponsavel: seletorResponsavel,
    seletorPrioridade: seletorPrioridade,
    marcaExtra: marcaExtra,
    prazoSituacao: prazoSituacao,
    selo: selo
  };
})();
