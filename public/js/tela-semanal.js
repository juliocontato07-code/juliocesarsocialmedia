'use strict';

(function () {
  const el = UI.el;

  let domingo = Datas.inicioSemana(Datas.hoje());
  let dias = Datas.semana(domingo);
  let demandasDaSemana = [];

  let refRolagem = null;
  let refGrade = null;
  let refPeriodo = null;
  let desinscrever = [];
  let filtroTags = null;

  /* ------------------------------------------------------------------ *
   * Dados                                                               *
   * ------------------------------------------------------------------ */

  async function carregar() {
    dias = Datas.semana(domingo);
    try {
      demandasDaSemana = await window.api.demandas.listarPeriodo(dias[0], dias[6], {});
    } catch (erro) {
      demandasDaSemana = [];
      UI.aviso(erro.message, 'erro');
    }
    desenhar();
  }

  function demandasDaCelula(clienteId, data) {
    return demandasDaSemana.filter(function (demanda) {
      if (demanda.cliente_id !== clienteId || demanda.data !== data) return false;
      /* o filtro esconde, nunca apaga: o dado continua no banco */
      return !filtroTags || filtroTags.visivel(demanda.tag_id);
    });
  }

  /* ------------------------------------------------------------------ *
   * Navegação                                                           *
   * ------------------------------------------------------------------ */

  function irPara(novoDomingo) {
    domingo = Datas.inicioSemana(novoDomingo);
    carregar();
  }

  /* ------------------------------------------------------------------ *
   * Desenho                                                             *
   * ------------------------------------------------------------------ */

  function cabecalhoDia(data) {
    const classes = ['gs-celula', 'gs-cabeca', 'gs-dia'];
    if (Datas.ehHoje(data)) classes.push('gs-hoje');
    if (Datas.ehFimDeSemana(data)) classes.push('gs-fds');

    return el('div', { class: classes.join(' ') }, [
      el('span', { class: 'gs-dia-nome', texto: Datas.nomeDiaCurto(data) }),
      el('span', { class: 'gs-dia-numero', texto: String(Datas.diaDoMes(data)) }),
      el('span', { class: 'gs-dia-mes', texto: Datas.nomeMesCurto(Datas.mes(data)) })
    ]);
  }

  function celulaCliente(cliente) {
    const total = demandasDaSemana.filter(function (d) {
      return d.cliente_id === cliente.id && (!filtroTags || filtroTags.visivel(d.tag_id));
    }).length;

    return el('div', { class: 'gs-celula gs-cliente' }, [
      el('div', { class: 'gs-cliente-nome', texto: cliente.nome, title: cliente.nome }),
      cliente.arroba ? el('div', { class: 'gs-cliente-arroba', texto: cliente.arroba }) : null,
      el('div', { class: 'gs-cliente-total', texto: total === 0 ? 'nenhuma na semana' : total + ' na semana' })
    ]);
  }

  async function soltarNaCelula(id, clienteId, data, posicao) {
    try {
      await window.api.demandas.mover(id, clienteId, data, posicao);
      await carregar();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  function celulaDia(cliente, data) {
    const classes = ['gs-celula', 'gs-caixa'];
    if (Datas.ehHoje(data)) classes.push('gs-hoje');
    if (Datas.ehFimDeSemana(data)) classes.push('gs-fds');

    const caixa = el('div', {
      class: classes.join(' '),
      dados: { cliente: String(cliente.id), data: data }
    });

    const lista = demandasDaCelula(cliente.id, data);
    for (const demanda of lista) {
      caixa.appendChild(Cartao.criar(demanda, {
        aoMudar: carregar, arrastavel: true, origem: 'semanal'
      }));
    }

    if (Estado.ehAdmin()) Arrastar.tornarAlvo(caixa, {
      clienteId: cliente.id,
      data: data,
      seletorCartoes: '.cartao-demanda',
      aoSoltar: soltarNaCelula
    });

    if (Estado.ehAdmin()) caixa.appendChild(el('button', {
      class: 'gs-adicionar',
      type: 'button',
      title: 'Nova demanda para ' + cliente.nome + ' em ' + Datas.curta(data),
      onclick: function (evento) {
        evento.stopPropagation();
        Cartao.abrirEditor({ clienteId: cliente.id, data: data, aoSalvar: carregar });
      }
    }, ['+']));

    /* clicar no vazio da célula também cria */
    caixa.addEventListener('click', function (evento) {
      if (evento.target !== caixa || !Estado.ehAdmin()) return;
      Cartao.abrirEditor({ clienteId: cliente.id, data: data, aoSalvar: carregar });
    });

    return caixa;
  }

  function desenhar() {
    if (!refGrade) return;

    const rolagemAnterior = refRolagem
      ? { topo: refRolagem.scrollTop, lado: refRolagem.scrollLeft }
      : { topo: 0, lado: 0 };

    refPeriodo.textContent = Datas.intervaloPorExtenso(dias[0], dias[6]);
    UI.limpar(refGrade);

    const clientes = Estado.dados.clientes;

    if (clientes.length === 0) {
      refGrade.classList.add('gs-sem-grade');
      refGrade.appendChild(UI.vazio('Nenhum cliente ativo.',
        'Cadastre um cliente na aba Clientes para a grade da semana aparecer aqui.'));
      return;
    }

    refGrade.classList.remove('gs-sem-grade');

    /* linha de cabeçalho */
    refGrade.appendChild(el('div', { class: 'gs-celula gs-cabeca gs-canto', texto: 'Cliente' }));
    for (const data of dias) refGrade.appendChild(cabecalhoDia(data));

    /* uma linha por cliente */
    for (const cliente of clientes) {
      refGrade.appendChild(celulaCliente(cliente));
      for (const data of dias) refGrade.appendChild(celulaDia(cliente, data));
    }

    refRolagem.scrollTop = rolagemAnterior.topo;
    refRolagem.scrollLeft = rolagemAnterior.lado;
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function montar(container) {
    filtroTags = Filtro.criar({
      rotulo: 'Tags',
      chavePref: 'semanal.tagsOcultas',
      itens: Estado.dados.tags.map(function (t) {
        return { id: t.id, nome: t.nome, cor: t.cor };
      }),
      aoMudar: desenhar
    });

    refPeriodo = el('span', { class: 'barra-periodo' });
    refGrade = el('div', { class: 'gs-grade' });
    refRolagem = el('div', { class: 'gs-rolagem' }, [refGrade]);

    const barra = el('div', { class: 'barra' }, [
      el('div', { class: 'barra-esquerda' }, [
        el('button', {
          class: 'botao', type: 'button', title: 'Semana anterior',
          onclick: function () { irPara(Datas.somarDias(domingo, -7)); }
        }, ['‹']),
        el('button', {
          class: 'botao', type: 'button',
          onclick: function () { irPara(Datas.hoje()); }
        }, ['Hoje']),
        el('button', {
          class: 'botao', type: 'button', title: 'Próxima semana',
          onclick: function () { irPara(Datas.somarDias(domingo, 7)); }
        }, ['›']),
        refPeriodo
      ]),
      el('div', { class: 'barra-direita' }, [
        filtroTags.elemento,
        Estado.ehAdmin() && el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () {
            Cartao.abrirEditor({
              data: Datas.ehHoje(Datas.hoje()) && dias.indexOf(Datas.hoje()) > -1 ? Datas.hoje() : dias[0],
              aoSalvar: carregar
            });
          }
        }, ['+ Nova demanda'])
      ])
    ]);

    container.appendChild(el('div', { class: 'tela-cheia' }, [barra, refRolagem]));

    desinscrever = [
      Estado.aoMudar(function () {
        filtroTags.atualizar(Estado.dados.tags.map(function (t) {
          return { id: t.id, nome: t.nome, cor: t.cor };
        }));
        desenhar();
      }),
      Estado.aoMudarDemandas(carregar)
    ];

    carregar();
  }

  function desmontar() {
    for (const cancelar of desinscrever) cancelar();
    desinscrever = [];
    refRolagem = null;
    refGrade = null;
    refPeriodo = null;
    filtroTags = null;
  }

  window.TelaSemanal = {
    montar: montar,
    desmontar: desmontar,
    irParaData: function (data) {
      domingo = Datas.inicioSemana(data);
      if (refGrade) carregar();
    }
  };
})();
