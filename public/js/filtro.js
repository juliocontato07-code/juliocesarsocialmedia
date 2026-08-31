'use strict';

/**
 * Filtro de seleção múltipla usado na barra das telas.
 * Afeta só a exibição: nada aqui toca no banco.
 *
 * Guarda os itens DESMARCADOS, não os marcados. Assim, item novo (uma tag ou
 * cliente criado depois) já nasce visível, que é o comportamento esperado.
 */
(function () {
  const el = UI.el;

  /**
   * criar({ rotulo, itens, chavePref, aoMudar })
   *   itens: [{ id, nome }]
   * Devolve { elemento, ocultos:Set, visivel(id), atualizar(itens) }
   */
  function criar(opcoes) {
    const config = opcoes || {};
    let itens = config.itens || [];

    /* preferência guarda ids desmarcados; id que não existe mais é ignorado */
    const gravados = Estado.pref(config.chavePref, []);
    const ocultos = new Set(Array.isArray(gravados) ? gravados.map(Number) : []);

    const botao = el('button', { class: 'botao filtro-botao', type: 'button' });
    const caixa = el('span', { class: 'filtro-caixa' }, [botao]);
    let painel = null;

    function gravar() {
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
        }, ['Desmarcar todas'])
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
      fechar: fechar
    };
  }

  window.Filtro = { criar: criar };
})();
