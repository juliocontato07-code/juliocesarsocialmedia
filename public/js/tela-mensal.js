'use strict';

(function () {
  const el = UI.el;

  let mesReferencia = Datas.primeiroDiaDoMes(Datas.hoje());
  let dias = [];
  let demandasDoMes = [];

  let refGrade = null;
  let refPeriodo = null;
  let refRolagem = null;
  let desinscrever = [];
  let modalDoDia = null;
  let filtroClientes = null;
  let observador = null;   /* ResizeObserver da grade, recriado a cada desenho */

  /* ------------------------------------------------------------------ *
   * Dados                                                               *
   * ------------------------------------------------------------------ */

  /** Semanas inteiras, de domingo a sábado, cobrindo o mês todo. */
  function montarDias() {
    const primeiro = Datas.primeiroDiaDoMes(mesReferencia);
    const ultimo = Datas.ultimoDiaDoMes(mesReferencia);

    const inicio = Datas.inicioSemana(primeiro);
    const fimSemana = Datas.somarDias(Datas.inicioSemana(ultimo), 6);

    const lista = [];
    let atual = inicio;
    while (atual <= fimSemana) {
      lista.push(atual);
      atual = Datas.somarDias(atual, 1);
    }
    return lista;
  }

  async function carregar() {
    dias = montarDias();
    try {
      demandasDoMes = await window.api.demandas.listarPeriodo(dias[0], dias[dias.length - 1], {});
    } catch (erro) {
      demandasDoMes = [];
      UI.aviso(erro.message, 'erro');
    }
    desenhar();
    if (modalDoDia) modalDoDia.atualizar();
  }

  function demandasDoDia(data) {
    return demandasDoMes.filter(function (demanda) {
      if (demanda.data !== data) return false;
      /* o filtro vale para os cards do mês e para o modal do dia */
      return !filtroClientes || filtroClientes.visivel(demanda.cliente_id);
    });
  }

  /* ------------------------------------------------------------------ *
   * Modal do dia                                                        *
   * ------------------------------------------------------------------ */

  function abrirDia(data) {
    const corpo = el('div', { class: 'dia-lista' });

    function desenharDia() {
      UI.limpar(corpo);
      const lista = demandasDoDia(data);

      if (lista.length === 0) {
        corpo.appendChild(UI.vazio('Nenhuma demanda neste dia.',
          'Use "Nova demanda" aqui embaixo para criar a primeira.'));
        return;
      }

      for (const demanda of lista) {
        corpo.appendChild(Cartao.criar(demanda, {
          mostrarCliente: true,
          aoMudar: carregar,
          origem: 'mensal'
        }));
      }
    }

    desenharDia();

    const controle = UI.abrirModal({
      titulo: Datas.comDiaDaSemana(data) + ' de ' + Datas.ano(data),
      largura: '560px',
      corpo: corpo,
      aoFechar: function () { modalDoDia = null; },
      rodape: Estado.ehAdmin() ? [
        el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () {
            Cartao.abrirEditor({ data: data, aoSalvar: carregar });
          }
        }, ['+ Nova demanda'])
      ] : null
    });

    modalDoDia = { controle: controle, atualizar: desenharDia };
    return controle;
  }

  /* ------------------------------------------------------------------ *
   * Corte por altura: mostra o que cabe e resume o resto em "+N"         *
   * ------------------------------------------------------------------ */

  /**
   * Mostra o que cabe na célula e resume o resto em "+N".
   *
   * `refazer` redesenha a lista a partir dos dados antes de cortar, e é o que
   * torna esta função repetível. Antes ela só removia nós do DOM: chamar duas
   * vezes ia apagando mais itens a cada passagem, então ela só podia rodar uma
   * vez — e como rodava antes de o navegador medir a grade, muitas vezes não
   * fazia nada. O sintoma era o pior possível: em 1920×1000 eu encontrei 18
   * células cortadas e nenhuma com o "+N", ou seja, demanda sumindo da tela
   * sem aviso nenhum.
   */
  function ajustarTransbordo(lista, contador, total, refazer) {
    if (typeof refazer === 'function') refazer();

    contador.style.display = 'none';
    contador.textContent = '';

    /* no celular a célula já é um resumo: não há lista para cortar */
    if (Dispositivo.ehMobile()) return;

    if (lista.scrollHeight <= lista.clientHeight) return;

    const itens = Array.from(lista.children);
    if (itens.length === 0) return;

    const alturaItem = itens[0].offsetHeight + 2; /* 2px do gap */
    const alturaContador = 15;
    let cabem = Math.floor((lista.clientHeight - alturaContador) / alturaItem);
    if (cabem < 1) cabem = 1;
    if (cabem >= itens.length) cabem = itens.length - 1;

    for (let i = cabem; i < itens.length; i += 1) itens[i].remove();

    contador.textContent = '+' + (total - cabem);
    contador.style.display = '';
  }

  /* ------------------------------------------------------------------ *
   * Desenho                                                             *
   * ------------------------------------------------------------------ */

  function itemCompacto(demanda) {
    const cor = demanda.tag_cor || '#9A9A9A';
    const item = el('div', {
      class: 'vm-item',
      dados: { id: String(demanda.id) },
      title: demanda.tag_nome + ' — ' + demanda.cliente_nome + (demanda.titulo ? ' — ' + demanda.titulo : '')
    }, [
      el('i', { class: 'vm-ponto', estilo: { background: cor } }),
      el('span', { class: 'vm-item-tag', texto: demanda.tag_nome }),
      el('span', { class: 'vm-item-cliente', texto: demanda.cliente_nome })
    ]);

    if (Estado.ehAdmin() && !Dispositivo.ehToque()) Arrastar.tornarArrastavel(item, demanda);
    return item;
  }

  /** Na visão mensal o card muda de dia, mas continua com o mesmo cliente. */
  async function soltarNoDia(id, clienteId, data) {
    try {
      await window.api.demandas.mover(id, clienteId, data, null);
      await carregar();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  /**
   * A célula do celular: o número de demandas e um ponto por tag.
   *
   * Em 375px cada célula tem ~48px de largura. Nome de cliente ali vira uma
   * fatia de letra ilegível, então some o texto e fica o que se lê de relance:
   * quantas, e de que tipo. A lista completa abre no toque.
   *
   * Os pontos são únicos por tag e no máximo quatro: quinze pontos iguais não
   * informam mais que quatro, só enchem a célula.
   */
  function pontosDasTags(lista) {
    const cores = [];
    for (const demanda of lista) {
      const cor = demanda.tag_cor || '#9A9A9A';
      if (cores.indexOf(cor) === -1) cores.push(cor);
    }

    const caixa = el('div', { class: 'vm-pontos' });
    for (const cor of cores.slice(0, 4)) {
      caixa.appendChild(el('i', { class: 'vm-ponto-tag', estilo: { background: cor } }));
    }
    if (cores.length > 4) caixa.appendChild(el('i', { class: 'vm-ponto-tag vm-ponto-mais' }));

    return caixa;
  }

  function celulaDia(data) {
    const doMes = Datas.mes(data) === Datas.mes(mesReferencia);

    const classes = ['vm-dia'];
    if (!doMes) classes.push('vm-fora');
    if (Datas.ehHoje(data)) classes.push('vm-hoje');
    if (Datas.ehFimDeSemana(data)) classes.push('vm-fds');

    const lista = el('div', { class: 'vm-dia-lista' });
    const contador = el('div', { class: 'vm-mais', estilo: { display: 'none' } });

    const doDia = demandasDoDia(data);

    /* Redesenha a lista do zero a partir dos dados. Chamada uma vez agora e de
       novo a cada reajuste, para o corte sempre partir da lista inteira. */
    function preencher() {
      UI.limpar(lista);

      if (Dispositivo.ehMobile()) {
        if (doDia.length > 0) lista.appendChild(pontosDasTags(doDia));
        return;
      }

      for (const demanda of doDia) lista.appendChild(itemCompacto(demanda));
    }

    preencher();

    const celula = el('div', {
      class: classes.join(' '),
      dados: { data: data },
      onclick: function () { abrirDia(data); }
    }, [
      el('div', { class: 'vm-dia-topo' }, [
        el('span', { class: 'vm-dia-numero', texto: String(Datas.diaDoMes(data)) }),
        doDia.length > 0
          ? el('span', { class: 'vm-dia-total', texto: String(doDia.length) })
          : null
      ]),
      lista,
      contador
    ]);

    /* arrastar e soltar não existe no toque: o equivalente é o botão Mover,
       na tela da demanda */
    if (Estado.ehAdmin() && !Dispositivo.ehToque()) Arrastar.tornarAlvo(celula, {
      clienteId: null,
      data: data,
      aoSoltar: soltarNoDia
    });

    celula.ajustar = function () {
      ajustarTransbordo(lista, contador, doDia.length, preencher);
    };
    return celula;
  }

  function desenhar() {
    if (!refGrade) return;

    refPeriodo.textContent = Datas.nomeMes(Datas.mes(mesReferencia)) + ' de ' + Datas.ano(mesReferencia);
    UI.limpar(refGrade);

    const celulas = [];

    for (const nome of Datas.DIAS_CURTOS) {
      refGrade.appendChild(el('div', { class: 'vm-cabeca', texto: nome }));
    }

    for (const data of dias) {
      const celula = celulaDia(data);
      celulas.push(celula);
      refGrade.appendChild(celula);
    }

    refGrade.style.gridTemplateRows = 'auto repeat(' + (dias.length / 7) + ', minmax(92px, 1fr))';

    /*
     * O corte só pode ser calculado depois que o navegador mediu a grade.
     *
     * Dois quadros, e não um: no primeiro a grade ainda não tem a altura
     * final, então a célula parece caber e o corte não acontece. Era esse o
     * bug — o ajuste rodava cedo demais e ia embora sem fazer nada.
     */
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(ajustarTodas);
    });

    /*
     * E de novo quando a grade muda de tamanho: janela redimensionada, barra
     * lateral aberta, zoom. Sem isso o corte ficaria calculado para uma altura
     * que não existe mais — e como agora o ajuste redesenha antes de cortar,
     * repetir é seguro.
     */
    if (observador) observador.disconnect();
    if (window.ResizeObserver) {
      observador = new ResizeObserver(function () { ajustarTodas(); });
      observador.observe(refGrade);
    }

    function ajustarTodas() {
      for (const celula of celulas) {
        if (celula.isConnected) celula.ajustar();
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function irPara(novoMes) {
    mesReferencia = Datas.primeiroDiaDoMes(novoMes);
    carregar();
  }

  function montar(container) {
    filtroClientes = Filtro.criar({
      rotulo: 'Clientes',
      chavePref: 'mensal.clientesOcultos',
      itens: Estado.dados.clientes.map(function (c) { return { id: c.id, nome: c.nome }; }),
      aoMudar: function () { desenhar(); if (modalDoDia) modalDoDia.atualizar(); }
    });

    refPeriodo = el('span', { class: 'barra-periodo' });
    refGrade = el('div', { class: 'vm-grade' });
    refRolagem = el('div', { class: 'vm-rolagem' }, [refGrade]);

    const barra = el('div', { class: 'barra' }, [
      el('div', { class: 'barra-esquerda' }, [
        el('button', {
          class: 'botao', type: 'button', title: 'Mês anterior',
          onclick: function () { irPara(Datas.somarMeses(mesReferencia, -1)); }
        }, ['‹']),
        el('button', {
          class: 'botao', type: 'button',
          onclick: function () { irPara(Datas.hoje()); }
        }, ['Hoje']),
        el('button', {
          class: 'botao', type: 'button', title: 'Próximo mês',
          onclick: function () { irPara(Datas.somarMeses(mesReferencia, 1)); }
        }, ['›']),
        refPeriodo
      ]),
      el('div', { class: 'barra-direita' }, [
        el('span', { class: 'texto-fraco barra-dica', texto: 'Clique no dia para ver e editar' }),
        filtroClientes.elemento,
        Estado.ehAdmin() && el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () { Cartao.abrirEditor({ data: Datas.hoje(), aoSalvar: carregar }); }
        }, ['+ Nova demanda'])
      ])
    ]);

    container.appendChild(el('div', { class: 'tela-cheia' }, [barra, refRolagem]));

    const aoRedimensionar = function () { desenhar(); };
    window.addEventListener('resize', aoRedimensionar);

    desinscrever = [
      Estado.aoMudar(function () {
        filtroClientes.atualizar(Estado.dados.clientes.map(function (c) {
          return { id: c.id, nome: c.nome };
        }));
        desenhar();
      }),
      Estado.aoMudarDemandas(carregar),
      function () { window.removeEventListener('resize', aoRedimensionar); }
    ];

    carregar();
  }

  function desmontar() {
    if (observador) observador.disconnect();
    observador = null;
    for (const cancelar of desinscrever) cancelar();
    desinscrever = [];
    refGrade = null;
    refPeriodo = null;
    refRolagem = null;
    modalDoDia = null;
    filtroClientes = null;
  }

  window.TelaMensal = {
    montar: montar,
    desmontar: desmontar,
    irParaData: function (data) {
      mesReferencia = Datas.primeiroDiaDoMes(data);
      if (refGrade) carregar();
    }
  };
})();
