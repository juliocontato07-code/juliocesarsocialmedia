'use strict';

/**
 * Controles compartilhados dos campos da demanda, e a leitura do prazo.
 *
 * Existem aqui, e não duplicados, porque os mesmos campos aparecem em três
 * lugares — modal de criação, tela da demanda e filtros da lista — e
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
   * Escolha de responsáveis                                             *
   * ------------------------------------------------------------------ */

  /**
   * Seleção de várias pessoas, em caixas de marcar.
   *
   * Não é um <select multiple> porque select múltiplo obriga a segurar Ctrl
   * para marcar o segundo nome, e todo mundo que não sabe disso acaba
   * desmarcando o primeiro sem perceber.
   *
   * `seguirTag` traz quem a regra da tag atribuiria. Ele para de agir no
   * momento em que a pessoa marca ou desmarca alguém à mão: a sugestão é um
   * ponto de partida, não uma correia.
   */
  function escolhaResponsaveis(selecionados, opcoes) {
    const config = opcoes || {};
    const marcados = new Set((selecionados || []).map(Number));
    let mexidoAMao = false;

    const aviso = el('div', { class: 'campo-dica escolha-aviso' });
    const lista = el('div', { class: 'escolha-pessoas' });

    function desenhar() {
      UI.limpar(lista);

      const pessoas = Estado.dados.atribuiveis;

      if (pessoas.length === 0) {
        lista.appendChild(el('span', {
          class: 'texto-fraco',
          texto: 'Ninguém disponível: todos os cargos ativos estão como somente leitura.'
        }));
        return;
      }

      for (const pessoa of pessoas) {
        const caixa = el('input', { type: 'checkbox' });
        caixa.checked = marcados.has(pessoa.id);
        caixa.disabled = Boolean(config.somenteLeitura);

        caixa.addEventListener('change', function () {
          mexidoAMao = true;
          if (caixa.checked) marcados.add(pessoa.id);
          else marcados.delete(pessoa.id);
          if (typeof config.aoMudar === 'function') config.aoMudar();
          atualizarAviso('');
        });

        lista.appendChild(el('label', {
          class: 'escolha-pessoa' + (config.somenteLeitura ? ' somente-leitura' : ''),
          title: Cartao.nomeDe(pessoa) + (pessoa.cargo ? ' — ' + pessoa.cargo : '')
        }, [
          caixa,
          Cartao.avatar(pessoa, { pequeno: true }),
          el('span', { class: 'escolha-nome', texto: Cartao.nomeDe(pessoa) }),
          pessoa.cargo ? el('span', { class: 'escolha-cargo texto-fraco', texto: pessoa.cargo }) : null
        ]));
      }

      /* Quem já era responsável mas saiu da lista (desativado, ou o cargo
         virou somente leitura) continua marcado e visível, senão salvar a
         demanda apagaria a atribuição sem ninguém pedir. */
      for (const id of marcados) {
        if (pessoas.some(function (p) { return p.id === id; })) continue;
        const fora = (config.fora || []).find(function (p) { return p.id === id; });
        lista.appendChild(el('label', { class: 'escolha-pessoa escolha-fora' }, [
          el('input', { type: 'checkbox', checked: true, disabled: true }),
          el('span', {
            class: 'texto-fraco',
            texto: (fora ? Cartao.nomeDe(fora) : 'usuário ' + id) + ' (fora da lista)'
          })
        ]));
      }
    }

    function atualizarAviso(texto) {
      aviso.textContent = texto || '';
      aviso.classList.toggle('escolha-aviso-visivel', Boolean(texto));
    }

    async function seguirTag(tagId) {
      if (mexidoAMao || config.somenteLeitura) return;

      if (!tagId) {
        marcados.clear();
        desenhar();
        atualizarAviso('Escolha uma tag para o sistema sugerir os responsáveis.');
        return;
      }

      try {
        const pessoas = await window.api.tags.pessoas(tagId);
        if (mexidoAMao) return;   /* a pessoa mexeu enquanto a rede respondia */

        marcados.clear();
        for (const p of pessoas) marcados.add(p.id);
        desenhar();

        atualizarAviso(pessoas.length === 0
          ? 'Esta tag não tem cargo configurado, ou o cargo não tem ninguém ativo. A demanda nasce sem responsável.'
          : 'Sugeridos pelo cargo da tag: ' + pessoas.map(Cartao.nomeDe).join(', ') + '.');
      } catch (erro) {
        atualizarAviso('Não deu para buscar a sugestão: ' + erro.message);
      }
    }

    desenhar();

    return {
      elemento: el('div', { class: 'escolha-caixa' }, [lista, aviso]),
      ler: function () { return Array.from(marcados); },
      definir: function (ids) {
        marcados.clear();
        for (const id of (ids || [])) marcados.add(Number(id));
        desenhar();
      },
      seguirTag: seguirTag,
      /** true quando a pessoa mexeu à mão: a tela da demanda usa para saber
          se precisa mandar a lista no salvar. */
      mexido: function () { return mexidoAMao; }
    };
  }

  /* ------------------------------------------------------------------ *
   * Leitura do prazo                                                    *
   * ------------------------------------------------------------------ */

  /**
   * Como o prazo se lê na tela.
   *
   * O cálculo NÃO acontece aqui: `em_dia` vem do servidor, de uma expressão
   * única compartilhada por Lista, Dashboard e cards. Esta função só escolhe
   * palavra e cor. Se ela calculasse, existiriam duas regras no sistema, e
   * mais cedo ou mais tarde uma discordaria da outra.
   *
   * O prazo é a data da publicação: em dia é entregar dentro daquele dia.
   */
  function prazoSituacao(demanda) {
    const dias = Number(demanda.dias_para_entrega);

    /* concluída sem hora registrada: não há o que medir. Fica em dia, com a
       ressalva no title — acusar atraso sem evidência seria acusar de graça */
    if (demanda.status === 1 && demanda.em_dia === null) {
      return {
        tom: 'neutro', texto: 'Em dia', curto: 'em dia',
        detalhe: 'Concluída, mas sem data de conclusão registrada. ' +
                 'Um administrador pode preencher na tela da demanda.'
      };
    }

    if (demanda.em_dia === false) {
      if (demanda.status === 1) {
        return {
          tom: 'atraso', texto: 'Em atraso', curto: 'atrasada',
          detalhe: 'Concluída em ' + (demanda.dia_conclusao ? Datas.curta(demanda.dia_conclusao) : '?') +
                   ', depois da publicação em ' + Datas.curta(demanda.data) + '.'
        };
      }

      const quanto = Number.isFinite(dias) && dias < 0
        ? (dias === -1 ? 'há 1 dia' : 'há ' + Math.abs(dias) + ' dias')
        : '';
      return {
        tom: 'atraso', texto: 'Em atraso',
        curto: quanto ? 'atrasada ' + quanto.replace('há ', '') : 'atrasada',
        detalhe: ('Pendente, e a publicação era ' + Datas.curta(demanda.data) + ' ' + quanto).trim()
      };
    }

    /* em dia */
    if (demanda.status === 1) {
      return {
        tom: 'ok', texto: 'Em dia', curto: 'em dia',
        detalhe: 'Concluída em ' + (demanda.dia_conclusao ? Datas.curta(demanda.dia_conclusao) : '?') +
                 ', dentro do dia da publicação.'
      };
    }

    /* pendente e em dia: mostra quanto falta */
    if (!Number.isFinite(dias)) {
      return { tom: 'ok', texto: 'Em dia', curto: 'em dia', detalhe: '' };
    }

    const falta = dias === 0 ? 'hoje'
      : dias === 1 ? 'falta 1 dia'
      : 'faltam ' + dias + ' dias';

    return {
      tom: dias <= 1 ? 'hoje' : 'ok',
      texto: 'Em dia',
      restante: falta,
      curto: falta,
      detalhe: 'Publicação em ' + Datas.curta(demanda.data) + ' — ' + falta + '.'
    };
  }

  /**
   * O indicador como elemento, para a tabela da lista.
   * Pendente e em dia mostra também quantos dias faltam, ao lado.
   */
  function selo(demanda) {
    const s = prazoSituacao(demanda);

    return el('span', { class: 'selo-prazo-caixa', title: s.detalhe }, [
      el('span', { class: 'selo-prazo selo-prazo-' + s.tom, texto: s.texto }),
      s.restante ? el('span', { class: 'selo-prazo-resta texto-fraco', texto: s.restante }) : null
    ]);
  }

  window.Campos = {
    PRIORIDADES: PRIORIDADES,
    nomePrioridade: nomePrioridade,
    seletorPrioridade: seletorPrioridade,
    marcaExtra: marcaExtra,
    escolhaResponsaveis: escolhaResponsaveis,
    prazoSituacao: prazoSituacao,
    selo: selo
  };
})();
