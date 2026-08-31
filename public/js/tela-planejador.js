'use strict';

/**
 * Planejador em lote de um cliente.
 * É um rascunho: nada existe no banco até apertar Salvar, e salvar sempre
 * ADICIONA ao que já está no período, nunca sobrescreve.
 */
(function () {
  const el = UI.el;

  const SEMANAS_INICIAIS = 5;

  let cliente = null;
  let semanas = [];          /* domingos, em ordem */
  let cartoes = [];          /* { id, data, tagId, titulo } */
  let existentes = {};       /* data -> quantas demandas já estão no banco */
  let proximoId = 1;
  let salvo = false;

  let refCorpo = null;
  let refTotal = null;
  let refSalvar = null;
  let refInicial = null;
  const refSemanas = new Map();   /* domingo -> { elemento, contador, dias: Map(data -> lista) } */

  /* ------------------------------------------------------------------ *
   * Modelo                                                              *
   * ------------------------------------------------------------------ */

  function diasDaSemana(domingo) {
    return Datas.semana(domingo);
  }

  function cartoesDoDia(data) {
    return cartoes.filter(function (cartao) { return cartao.data === data; });
  }

  function totalDeCartoes() {
    return cartoes.length;
  }

  function totalDaSemana(domingo) {
    const dias = diasDaSemana(domingo);
    return cartoes.filter(function (cartao) { return dias.indexOf(cartao.data) > -1; }).length;
  }

  async function carregarExistentes() {
    existentes = {};
    if (semanas.length === 0) return;

    const inicio = semanas[0];
    const fim = Datas.somarDias(semanas[semanas.length - 1], 6);

    try {
      const lista = await window.api.demandas.listarPeriodo(inicio, fim, { clienteId: cliente.id });
      for (const demanda of lista) {
        existentes[demanda.data] = (existentes[demanda.data] || 0) + 1;
      }
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  /* ------------------------------------------------------------------ *
   * Totais                                                              *
   * ------------------------------------------------------------------ */

  function atualizarTotais() {
    const total = totalDeCartoes();

    refTotal.textContent = total === 0
      ? 'Nenhum card no rascunho'
      : total + (total === 1 ? ' card no rascunho' : ' cards no rascunho');

    refSalvar.disabled = total === 0;

    for (const [domingo, referencia] of refSemanas) {
      const daSemana = totalDaSemana(domingo);
      referencia.contador.textContent = daSemana === 0 ? '' : String(daSemana);
      referencia.contador.style.display = daSemana === 0 ? 'none' : '';
    }
  }

  /* ------------------------------------------------------------------ *
   * Card do rascunho                                                    *
   * ------------------------------------------------------------------ */

  function montarCartao(cartao, lista) {
    const tags = Estado.dados.tags;

    const seletor = el('select', { class: 'entrada pl-select' },
      tags.map(function (tag) {
        return el('option', {
          value: String(tag.id),
          selected: tag.id === cartao.tagId,
          texto: tag.nome
        });
      }));

    seletor.addEventListener('change', function () {
      cartao.tagId = Number(seletor.value);
      pintarPonto();
    });

    const ponto = el('i', { class: 'pl-ponto' });
    function pintarPonto() {
      const tag = Estado.tag(cartao.tagId);
      ponto.style.background = (tag && tag.cor) || '#9A9A9A';
    }
    pintarPonto();

    const titulo = el('textarea', {
      class: 'entrada pl-titulo',
      rows: 2,
      placeholder: 'Título (opcional)',
      value: cartao.titulo || ''
    });

    titulo.addEventListener('input', function () { cartao.titulo = titulo.value; });

    const caixa = el('div', { class: 'pl-cartao', dados: { id: String(cartao.id) } }, [
      el('div', { class: 'pl-cartao-topo' }, [
        ponto,
        seletor,
        el('button', {
          class: 'botao-icone botao-icone-perigo',
          type: 'button',
          title: 'Tirar do rascunho',
          onclick: function (evento) {
            evento.stopPropagation();
            cartoes = cartoes.filter(function (item) { return item.id !== cartao.id; });
            caixa.remove();
            atualizarTotais();
          }
        }, ['✕'])
      ]),
      titulo
    ]);

    lista.appendChild(caixa);
    return { caixa: caixa, titulo: titulo };
  }

  function adicionarCartao(data, lista, focar) {
    if (Estado.dados.tags.length === 0) {
      UI.aviso('Cadastre ao menos uma tag antes de planejar.', 'erro');
      return;
    }

    const cartao = {
      id: proximoId,
      data: data,
      tagId: Estado.dados.tags[0].id,
      titulo: ''
    };
    proximoId += 1;
    cartoes.push(cartao);

    const criado = montarCartao(cartao, lista);
    atualizarTotais();
    if (focar) criado.titulo.focus();
  }

  /* ------------------------------------------------------------------ *
   * Dia                                                                 *
   * ------------------------------------------------------------------ */

  function montarDia(data) {
    const lista = el('div', { class: 'pl-dia-lista' });

    for (const cartao of cartoesDoDia(data)) montarCartao(cartao, lista);

    const jaTem = existentes[data] || 0;

    const celula = el('div', {
      class: 'pl-dia' + (Datas.ehFimDeSemana(data) ? ' pl-fds' : '') +
             (Datas.ehHoje(data) ? ' pl-hoje' : ''),
      dados: { data: data }
    }, [
      el('div', { class: 'pl-dia-topo' }, [
        el('span', { class: 'pl-dia-nome', texto: Datas.nomeDiaCurto(data) }),
        el('span', { class: 'pl-dia-numero', texto: String(Datas.diaDoMes(data)) }),
        el('span', { class: 'pl-dia-mes', texto: '/' + Datas.nomeMesCurto(Datas.mes(data)) }),
        jaTem > 0
          ? el('span', {
              class: 'pl-ja-tem',
              texto: jaTem + ' já',
              title: jaTem + ' demanda(s) já no calendário deste dia. O rascunho soma, não substitui.'
            })
          : null
      ]),
      lista,
      el('button', {
        class: 'pl-adicionar',
        type: 'button',
        title: 'Adicionar card neste dia',
        onclick: function (evento) {
          evento.stopPropagation();
          adicionarCartao(data, lista, true);
        }
      }, ['+'])
    ]);

    /* clicar no vazio do dia também adiciona */
    celula.addEventListener('click', function (evento) {
      if (evento.target !== celula) return;
      adicionarCartao(data, lista, true);
    });

    return celula;
  }

  /* ------------------------------------------------------------------ *
   * Semana                                                              *
   * ------------------------------------------------------------------ */

  function montarSemana(domingo, indice) {
    const dias = diasDaSemana(domingo);
    const contador = el('span', { class: 'contador', estilo: { display: 'none' } });

    const grade = el('div', { class: 'pl-grade' }, dias.map(montarDia));

    const bloco = el('section', { class: 'pl-semana' }, [
      el('div', { class: 'pl-semana-topo' }, [
        el('span', { class: 'pl-semana-rotulo', texto: 'Semana ' + (indice + 1) }),
        el('span', {
          class: 'pl-semana-datas',
          texto: Datas.intervaloPorExtenso(dias[0], dias[6])
        }),
        contador,
        el('button', {
          class: 'botao-icone pl-remover',
          type: 'button',
          title: 'Remover esta semana do rascunho',
          onclick: function () { removerSemana(domingo); }
        }, ['✕'])
      ]),
      grade
    ]);

    refSemanas.set(domingo, { elemento: bloco, contador: contador });
    return bloco;
  }

  async function removerSemana(domingo) {
    const perdidos = totalDaSemana(domingo);

    if (perdidos > 0) {
      const certeza = await UI.confirmar({
        titulo: 'Remover semana',
        texto: 'Esta semana tem ' + perdidos + ' card(s) no rascunho. Remover a semana descarta ' +
               'esses cards. Nada que já está salvo no calendário é afetado.',
        rotuloOk: 'Remover',
        perigo: true
      });
      if (!certeza) return;
    }

    const dias = diasDaSemana(domingo);
    cartoes = cartoes.filter(function (cartao) { return dias.indexOf(cartao.data) === -1; });
    semanas = semanas.filter(function (item) { return item !== domingo; });

    const referencia = refSemanas.get(domingo);
    if (referencia) referencia.elemento.remove();
    refSemanas.delete(domingo);

    renumerarSemanas();
    atualizarTotais();

    if (semanas.length === 0) desenhar();
  }

  function renumerarSemanas() {
    semanas.forEach(function (domingo, indice) {
      const referencia = refSemanas.get(domingo);
      if (referencia) {
        referencia.elemento.querySelector('.pl-semana-rotulo').textContent = 'Semana ' + (indice + 1);
      }
    });
  }

  function adicionarSemana() {
    const ultimo = semanas.length > 0
      ? semanas[semanas.length - 1]
      : Datas.inicioSemana(refInicial.value || Datas.hoje());

    const nova = semanas.length > 0 ? Datas.somarDias(ultimo, 7) : ultimo;
    semanas.push(nova);

    carregarExistentes().then(function () {
      if (semanas.length === 1) {
        desenhar();
      } else {
        refCorpo.appendChild(montarSemana(nova, semanas.length - 1));
        atualizarTotais();
      }
      const referencia = refSemanas.get(nova);
      if (referencia) referencia.elemento.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  /* ------------------------------------------------------------------ *
   * Semana inicial                                                      *
   * ------------------------------------------------------------------ */

  async function trocarSemanaInicial(dataEscolhida) {
    const novoDomingo = Datas.inicioSemana(dataEscolhida);
    if (semanas.length > 0 && novoDomingo === semanas[0]) return;

    const quantas = Math.max(semanas.length, 1);
    const novasSemanas = [];
    for (let i = 0; i < quantas; i += 1) novasSemanas.push(Datas.somarDias(novoDomingo, i * 7));

    const diasNovos = novasSemanas.reduce(function (acumulado, domingo) {
      return acumulado.concat(diasDaSemana(domingo));
    }, []);

    const perdidos = cartoes.filter(function (cartao) {
      return diasNovos.indexOf(cartao.data) === -1;
    }).length;

    if (perdidos > 0) {
      const certeza = await UI.confirmar({
        titulo: 'Mudar a semana inicial',
        texto: perdidos + ' card(s) do rascunho ficam fora do novo período e serão descartados.',
        rotuloOk: 'Mudar mesmo assim',
        perigo: true
      });
      if (!certeza) {
        refInicial.value = semanas[0];
        return;
      }
      cartoes = cartoes.filter(function (cartao) { return diasNovos.indexOf(cartao.data) > -1; });
    }

    semanas = novasSemanas;
    refInicial.value = semanas[0];
    await carregarExistentes();
    desenhar();
  }

  /* ------------------------------------------------------------------ *
   * Salvar                                                              *
   * ------------------------------------------------------------------ */

  async function salvar() {
    if (cartoes.length === 0) return;

    const diasVisiveis = semanas.reduce(function (acumulado, domingo) {
      return acumulado.concat(diasDaSemana(domingo));
    }, []);

    const lote = cartoes
      .filter(function (cartao) { return diasVisiveis.indexOf(cartao.data) > -1; })
      .map(function (cartao) {
        return {
          cliente_id: cliente.id,
          tag_id: cartao.tagId,
          data: cartao.data,
          titulo: cartao.titulo,
          link: '',
          status: 0
        };
      });

    if (lote.length === 0) return;

    refSalvar.disabled = true;
    try {
      const criadas = await window.api.demandas.criarVarias(lote);
      salvo = true;
      cartoes = [];

      const primeira = criadas.reduce(function (menor, demanda) {
        return demanda.data < menor ? demanda.data : menor;
      }, criadas[0].data);

      UI.aviso(criadas.length + ' demanda(s) criadas para ' + cliente.nome + '.');
      Estado.demandasMudaram();

      TelaSemanal.irParaData(primeira);
      App.ir('semanal');
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
      refSalvar.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Desenho                                                             *
   * ------------------------------------------------------------------ */

  function desenhar() {
    UI.limpar(refCorpo);
    refSemanas.clear();

    if (semanas.length === 0) {
      refCorpo.appendChild(UI.vazio('Nenhuma semana no rascunho.',
        'Use "Adicionar semana" para começar de novo.'));
      atualizarTotais();
      return;
    }

    semanas.forEach(function (domingo, indice) {
      refCorpo.appendChild(montarSemana(domingo, indice));
    });

    atualizarTotais();
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function montar(container, argumentos) {
    cliente = Estado.cliente(argumentos.clienteId);
    cartoes = [];
    proximoId = 1;
    salvo = false;
    refSemanas.clear();

    if (!cliente) {
      container.appendChild(el('div', { class: 'tela-simples' }, [
        el('div', { class: 'painel' }, [UI.vazio('Cliente não encontrado.')])
      ]));
      return;
    }

    const domingoInicial = Datas.inicioSemana(Datas.hoje());
    semanas = [];
    for (let i = 0; i < SEMANAS_INICIAIS; i += 1) {
      semanas.push(Datas.somarDias(domingoInicial, i * 7));
    }

    refInicial = el('input', {
      class: 'entrada pl-inicial',
      type: 'date',
      value: domingoInicial,
      title: 'Escolha qualquer data: o rascunho começa na semana dela'
    });
    refInicial.addEventListener('change', function () {
      if (refInicial.value) trocarSemanaInicial(refInicial.value);
    });

    refTotal = el('span', { class: 'texto-fraco pl-total' });
    refSalvar = el('button', {
      class: 'botao botao-principal', type: 'button', disabled: true,
      onclick: salvar
    }, ['Salvar no calendário']);

    refCorpo = el('div', { class: 'pl-corpo' });

    const barra = el('div', { class: 'barra' }, [
      el('div', { class: 'barra-esquerda' }, [
        el('button', {
          class: 'botao', type: 'button', title: 'Voltar para o cliente',
          onclick: function () { App.ir('clientes'); }
        }, ['‹ Voltar']),
        el('span', { class: 'barra-periodo', texto: 'Elaborar calendário — ' + cliente.nome }),
        cliente.arroba ? el('span', { class: 'texto-fraco', texto: cliente.arroba }) : null
      ]),
      el('div', { class: 'barra-direita' }, [
        el('label', { class: 'pl-campo-inicial' }, [
          el('span', { class: 'texto-fraco', texto: 'Semana inicial' }),
          refInicial
        ]),
        refTotal,
        refSalvar
      ])
    ]);

    const aviso = el('div', { class: 'pl-aviso' }, [
      'Isto é um rascunho. Nada vai para o calendário até você salvar, e salvar ',
      el('strong', { texto: 'soma' }),
      ' ao que já existe no período — nunca substitui.'
    ]);

    const rodape = el('div', { class: 'pl-rodape' }, [
      el('button', {
        class: 'botao', type: 'button', onclick: adicionarSemana
      }, ['+ Adicionar semana'])
    ]);

    const rolagem = el('div', { class: 'pl-rolagem' }, [aviso, refCorpo, rodape]);

    container.appendChild(el('div', { class: 'tela-cheia' }, [barra, rolagem]));

    carregarExistentes().then(desenhar);
  }

  /** O roteador pergunta antes de trocar de tela. */
  async function podeSair() {
    if (salvo || cartoes.length === 0) return true;

    return UI.confirmar({
      titulo: 'Sair sem salvar',
      texto: 'O rascunho tem ' + cartoes.length + ' card(s) que ainda não foram para o calendário. ' +
             'Sair agora descarta tudo.',
      rotuloOk: 'Descartar rascunho',
      perigo: true
    });
  }

  function desmontar() {
    cartoes = [];
    semanas = [];
    refSemanas.clear();
    refCorpo = null;
    refTotal = null;
    refSalvar = null;
    refInicial = null;
    cliente = null;
  }

  window.TelaPlanejador = {
    montar: montar,
    desmontar: desmontar,
    podeSair: podeSair
  };
})();
