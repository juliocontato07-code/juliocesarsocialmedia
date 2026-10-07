'use strict';

/**
 * Filtro de seleção múltipla usado na barra das telas.
 * Afeta só a exibição: nada aqui toca no banco.
 *
 * Guarda os itens DESMARCADOS, não os marcados. Assim, item novo (uma tag ou
 * cliente criado depois) já nasce visível, que é o comportamento esperado.
 *
 * Dois modos de partida:
 *
 *  - `chavePref`: o filtro lembra a escolha da pessoa entre sessões. É o modo
 *    do filtro de clientes na Mensal.
 *  - `padrao`: o filtro começa de um conjunto calculado a cada carregamento e
 *    NÃO é persistido. É o modo do filtro de tags na Semanal, que parte do
 *    cargo de quem entrou. Persistir ali brigaria com a regra: a pessoa muda
 *    de cargo, ou a tag muda de cargo, e o filtro gravado continuaria mandando
 *    um padrão velho.
 */
(function () {
  const el = UI.el;

  /**
   * criar({ rotulo, itens, chavePref, padrao, rotuloPadrao, aoMudar })
   *   itens: [{ id, nome }]
   *   padrao: função que devolve os ids que devem ficar MARCADOS, ou null
   *           para marcar todos
   * Devolve { elemento, ocultos:Set, visivel(id), atualizar(itens), restaurarPadrao() }
   */
  function criar(opcoes) {
    const config = opcoes || {};
    let itens = config.itens || [];

    const ocultos = new Set();

    /* Calcula os ocultos a partir do padrão: tudo que não está na lista de
       marcados fica oculto. Padrão vazio ou nulo significa "mostra todos". */
    function aplicarPadrao() {
      ocultos.clear();

      if (typeof config.padrao !== 'function') return;

      const marcados = config.padrao();
      if (!Array.isArray(marcados) || marcados.length === 0) return;

      const conjunto = new Set(marcados.map(Number));
      for (const item of itens) {
        if (!conjunto.has(item.id)) ocultos.add(item.id);
      }
    }

    if (config.chavePref) {
      /* preferência guarda ids desmarcados; id que não existe mais é ignorado */
      const gravados = Estado.pref(config.chavePref, []);
      for (const id of (Array.isArray(gravados) ? gravados : [])) ocultos.add(Number(id));
    } else {
      aplicarPadrao();
    }

    const botao = el('button', { class: 'botao filtro-botao', type: 'button' });
    const caixa = el('span', { class: 'filtro-caixa' }, [botao]);
    let painel = null;

    function gravar() {
      /* sem chavePref o filtro é de sessão: não persiste nada */
      if (!config.chavePref) return;

      const validos = itens
        .map(function (i) { return i.id; })
        .filter(function (id) { return ocultos.has(id); });
      Estado.definirPref(config.chavePref, validos);
    }

    function atualizarBotao() {
      const total = itens.length;
      const ativos = itens.filter(function (i) { return !ocultos.has(i.id); }).length;
      const tudoAtivo = ativos === total;

      UI.limpar(botao);
      botao.appendChild(document.createTextNode(
        config.rotulo + (tudoAtivo ? '' : ' (' + ativos + ' de ' + total + ')')
      ));
      botao.appendChild(el('span', { class: 'filtro-seta', texto: '▾' }));
      botao.classList.toggle('filtro-ativo', !tudoAtivo);
    }

    function fechar() {
      if (!painel) return;
      painel.remove();
      painel = null;
      document.removeEventListener('mousedown', aoClicarFora, true);
    }

    function aoClicarFora(evento) {
      if (!painel) return;
      const alvo = evento.target;
      const dentro = alvo instanceof Node && (painel.contains(alvo) || botao.contains(alvo));
      if (!dentro) fechar();
    }

    function notificar() {
      atualizarBotao();
      gravar();
      if (typeof config.aoMudar === 'function') config.aoMudar();
    }

    function abrir() {
      painel = el('div', { class: 'filtro-painel' });

      const lista = el('div', { class: 'filtro-lista' });

      for (const item of itens) {
        const marca = el('input', { type: 'checkbox' });
        marca.checked = !ocultos.has(item.id);
        marca.addEventListener('change', function () {
          if (marca.checked) ocultos.delete(item.id);
          else ocultos.add(item.id);
          notificar();
        });

        lista.appendChild(el('label', { class: 'filtro-item' }, [
          marca,
          item.cor ? el('i', { class: 'filtro-cor', estilo: { background: item.cor } }) : null,
          el('span', { class: 'filtro-nome', texto: item.nome })
        ]));
      }

      if (itens.length === 0) {
        lista.appendChild(el('div', { class: 'filtro-vazio texto-fraco', texto: 'Nada para filtrar.' }));
      }

      painel.appendChild(lista);
      painel.appendChild(el('div', { class: 'filtro-rodape' }, [
        el('button', {
          class: 'botao botao-pequeno', type: 'button',
          onclick: function () {
            ocultos.clear();
            notificar();
            fechar();
            abrir();
          }
        }, ['Marcar todas']),
        el('button', {
          class: 'botao botao-pequeno', type: 'button',
          onclick: function () {
            for (const item of itens) ocultos.add(item.id);
            notificar();
            fechar();
            abrir();
          }
        }, ['Desmarcar todas']),

        /* Só aparece quando existe um padrão para voltar. */
        typeof config.padrao === 'function' ? el('button', {
          class: 'botao botao-pequeno', type: 'button',
          title: config.dicaPadrao || '',
          onclick: function () {
            aplicarPadrao();
            notificar();
            fechar();
            abrir();
          }
        }, [config.rotuloPadrao || 'Restaurar padrão']) : null
      ]));

      caixa.appendChild(painel);
      document.addEventListener('mousedown', aoClicarFora, true);
    }

    botao.addEventListener('click', function (evento) {
      evento.stopPropagation();
      if (painel) fechar();
      else abrir();
    });

    atualizarBotao();

    return {
      elemento: caixa,
      ocultos: ocultos,
      visivel: function (id) { return !ocultos.has(id); },
      atualizar: function (novosItens) {
        itens = novosItens || [];
        if (painel) { fechar(); abrir(); }
        atualizarBotao();
      },
      /** Desmarca o filtro: tudo visível. É o 'limpar' dos estados vazios. */
      mostrarTodos: function () {
        if (ocultos.size === 0) return false;
        ocultos.clear();
        atualizarBotao();
        gravar();
        if (painel) { fechar(); abrir(); }
        return true;
      },

      /** Volta ao conjunto do padrão. Sem padrão, marca todos. */
      restaurarPadrao: function () {
        aplicarPadrao();
        atualizarBotao();
      },
      fechar: fechar
    };
  }

  /* ------------------------------------------------------------------ *
   * Filtro de status                                                    *
   * ------------------------------------------------------------------ */

  const OPCOES_STATUS = [
    { valor: '', rotulo: 'Todos' },
    { valor: '0', rotulo: 'Pendente' },
    { valor: '1', rotulo: 'Concluído' }
  ];

  /**
   * Escolha única: Todos, Pendente ou Concluído.
   *
   * Não é o `criar` acima com três itens, porque as duas coisas não são o mesmo
   * problema. Lá a pergunta é "quais destes eu quero ver", e desmarcar todos é
   * uma resposta possível; aqui é "qual destes", e não existe estado em que a
   * pessoa queira nem pendente nem concluído — seria a tela vazia por
   * definição.
   *
   * Nunca persiste, e isso é deliberado. Filtro de status guardado entre
   * sessões esconde demanda de um jeito que não se vê: a pessoa abre o app
   * dias depois, a Semanal está em "Concluído" desde a semana passada, e o
   * trabalho pendente simplesmente não está lá. Tag escondida se percebe pelo
   * nome no botão; status escondido parece que o trabalho sumiu.
   */
  function status(opcoes) {
    const config = opcoes || {};
    let valor = '';

    const botao = el('button', { class: 'botao filtro-botao', type: 'button' });
    const caixa = el('span', { class: 'filtro-caixa' }, [botao]);
    let painel = null;

    function rotuloAtual() {
      const achado = OPCOES_STATUS.find(function (o) { return o.valor === valor; });
      return achado ? achado.rotulo : 'Todos';
    }

    function atualizarBotao() {
      UI.limpar(botao);
      botao.appendChild(document.createTextNode(
        'Status' + (valor === '' ? '' : ': ' + rotuloAtual())
      ));
      botao.appendChild(el('span', { class: 'filtro-seta', texto: '▾' }));
      botao.classList.toggle('filtro-ativo', valor !== '');
    }

    function fechar() {
      if (!painel) return;
      painel.remove();
      painel = null;
      document.removeEventListener('mousedown', aoClicarFora, true);
    }

    function aoClicarFora(evento) {
      if (!painel) return;
      const alvo = evento.target;
      const dentro = alvo instanceof Node && (painel.contains(alvo) || botao.contains(alvo));
      if (!dentro) fechar();
    }

    function escolher(novo) {
      valor = novo;
      atualizarBotao();
      fechar();
      if (typeof config.aoMudar === 'function') config.aoMudar();
    }

    function abrir() {
      painel = el('div', { class: 'filtro-painel filtro-painel-status' });

      const lista = el('div', { class: 'filtro-lista' });

      for (const opcao of OPCOES_STATUS) {
        const marca = el('input', { type: 'radio', name: 'filtro-status-' + Math.random() });
        marca.checked = opcao.valor === valor;
        marca.addEventListener('change', function () { escolher(opcao.valor); });

        lista.appendChild(el('label', { class: 'filtro-item' }, [
          marca,
          el('span', { class: 'filtro-nome', texto: opcao.rotulo })
        ]));
      }

      painel.appendChild(lista);
      caixa.appendChild(painel);
      document.addEventListener('mousedown', aoClicarFora, true);
    }

    botao.addEventListener('click', function (evento) {
      evento.stopPropagation();
      if (painel) fechar();
      else abrir();
    });

    atualizarBotao();

    return {
      elemento: caixa,
      /** '' , '0' ou '1' — o mesmo alfabeto que a API já usa. */
      valor: function () { return valor; },
      ativo: function () { return valor !== ''; },
      rotulo: rotuloAtual,
      visivel: function (demanda) {
        if (valor === '') return true;
        return String(demanda.status) === valor;
      },
      limpar: function () { escolher(''); },
      fechar: fechar
    };
  }

  window.Filtro = { criar: criar, status: status };
})();
