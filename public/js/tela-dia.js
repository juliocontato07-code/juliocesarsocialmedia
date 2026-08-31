'use strict';

/**
 * Aba Dia: a tela de trabalho do dia.
 * Tudo do dia, agrupado por cliente, com contador de pendentes e concluídas.
 */
(function () {
  const el = UI.el;

  let data = Datas.hoje();
  let demandasDoDia = [];

  let refCorpo = null;
  let refTitulo = null;
  let refContador = null;
  let desinscrever = [];

  /* ------------------------------------------------------------------ *
   * Dados                                                               *
   * ------------------------------------------------------------------ */

  async function carregar() {
    try {
      demandasDoDia = await window.api.demandas.listarPeriodo(data, data, {});
    } catch (erro) {
      demandasDoDia = [];
      UI.aviso(erro.message, 'erro');
    }
    desenhar();
  }

  function irPara(novaData) {
    data = novaData;
    carregar();
  }

  /* ------------------------------------------------------------------ *
   * Desenho                                                             *
   * ------------------------------------------------------------------ */

  function grupoDoCliente(nome, lista) {
    const grupo = el('section', { class: 'dia-grupo' });

    grupo.appendChild(el('div', { class: 'dia-grupo-topo' }, [
      el('h3', { class: 'dia-grupo-nome', texto: nome }),
      el('span', {
        class: 'texto-fraco dia-grupo-total',
        texto: lista.length === 1 ? '1 demanda' : lista.length + ' demandas'
      })
    ]));

    const itens = el('div', { class: 'dia-itens' });

    for (const demanda of lista) {
      const linha = el('article', {
        class: 'dia-linha',
        dados: { id: String(demanda.id) },
        onclick: function (evento) {
          if (evento.target.closest('.chip-status, .botao-link')) return;
          App.ir('demanda', { id: demanda.id, origem: 'dia' });
        }
      });

      const temLink = Boolean(demanda.link && demanda.link.trim() !== '');

      linha.appendChild(Cartao.chipStatus(demanda, { aoMudar: carregar }));
      linha.appendChild(Cartao.pilulaTag(demanda.tag_nome, demanda.tag_cor));
      linha.appendChild(el('span', {
        class: 'dia-titulo' + (demanda.titulo ? '' : ' cartao-titulo-vazio'),
        texto: demanda.titulo || 'sem título'
      }));

      linha.appendChild(temLink
        ? el('button', {
            class: 'botao-link',
            type: 'button',
            title: 'Abrir no navegador padrão',
            onclick: async function (evento) {
              evento.stopPropagation();
              try {
                await window.api.abrirLink(demanda.link);
              } catch (erro) {
                UI.aviso(erro.message, 'erro');
              }
            }
          }, ['Abrir link'])
        : el('span', { class: 'dia-sem-link texto-fraco', texto: 'sem link' }));

      itens.appendChild(linha);
    }

    grupo.appendChild(itens);
    return grupo;
  }

  function desenhar() {
    if (!refCorpo) return;

    const ehHoje = Datas.ehHoje(data);
    refTitulo.textContent = Datas.comDiaDaSemana(data) + ' de ' + Datas.ano(data);
    refTitulo.classList.toggle('dia-hoje', ehHoje);

    const pendentes = demandasDoDia.filter(function (d) { return d.status === 0; }).length;
    const concluidas = demandasDoDia.length - pendentes;

    UI.limpar(refContador);
    if (demandasDoDia.length > 0) {
      refContador.appendChild(el('span', { class: 'dia-contador dia-contador-pendente' }, [
        el('strong', { texto: String(pendentes) }),
        el('span', { texto: pendentes === 1 ? 'pendente' : 'pendentes' })
      ]));
      refContador.appendChild(el('span', { class: 'dia-contador dia-contador-concluida' }, [
        el('strong', { texto: String(concluidas) }),
        el('span', { texto: concluidas === 1 ? 'concluída' : 'concluídas' })
      ]));
    }

    UI.limpar(refCorpo);

    if (demandasDoDia.length === 0) {
      refCorpo.appendChild(UI.vazio(
        ehHoje ? 'Nada marcado para hoje.' : 'Nada marcado para este dia.',
        Estado.ehAdmin()
          ? 'Use "Nova demanda" para criar a primeira, ou navegue para outro dia.'
          : 'Navegue para outro dia com as setas aqui em cima.'
      ));
      return;
    }

    /* agrupa por cliente preservando a ordem que veio do banco */
    const ordem = [];
    const porCliente = new Map();
    for (const demanda of demandasDoDia) {
      if (!porCliente.has(demanda.cliente_nome)) {
        porCliente.set(demanda.cliente_nome, []);
        ordem.push(demanda.cliente_nome);
      }
      porCliente.get(demanda.cliente_nome).push(demanda);
    }

    for (const nome of ordem) {
      refCorpo.appendChild(grupoDoCliente(nome, porCliente.get(nome)));
    }
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function montar(container, argumentos) {
    if (argumentos && argumentos.data) data = argumentos.data;

    refTitulo = el('span', { class: 'barra-periodo dia-titulo-topo' });
    refContador = el('span', { class: 'dia-contadores' });
    refCorpo = el('div', { class: 'dia-corpo' });

    const barra = el('div', { class: 'barra' }, [
      el('div', { class: 'barra-esquerda' }, [
        el('button', {
          class: 'botao', type: 'button', title: 'Dia anterior',
          onclick: function () { irPara(Datas.somarDias(data, -1)); }
        }, ['‹']),
        el('button', {
          class: 'botao', type: 'button',
          onclick: function () { irPara(Datas.hoje()); }
        }, ['Hoje']),
        el('button', {
          class: 'botao', type: 'button', title: 'Próximo dia',
          onclick: function () { irPara(Datas.somarDias(data, 1)); }
        }, ['›']),
        refTitulo,
        refContador
      ]),
      el('div', { class: 'barra-direita' }, [
        Estado.ehAdmin() && el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () {
            Cartao.abrirEditor({ data: data, aoSalvar: carregar });
          }
        }, ['+ Nova demanda'])
      ])
    ]);

    container.appendChild(el('div', { class: 'tela-cheia' }, [
      barra,
      el('div', { class: 'dia-rolagem' }, [refCorpo])
    ]));

    desinscrever = [
      Estado.aoMudar(desenhar),
      Estado.aoMudarDemandas(carregar)
    ];

    carregar();
  }

  function desmontar() {
    for (const cancelar of desinscrever) cancelar();
    desinscrever = [];
    refCorpo = null;
    refTitulo = null;
    refContador = null;
  }

  window.TelaDia = {
    montar: montar,
    desmontar: desmontar,
    irParaData: function (novaData) {
      data = novaData;
      if (refCorpo) carregar();
    }
  };
})();
