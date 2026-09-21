'use strict';

(function () {
  const el = UI.el;

  let domingo = Datas.inicioSemana(Datas.hoje());
  let dias = Datas.semana(domingo);
  let demandasDaSemana = [];

  /* só o celular usa: qual dos sete dias está aberto na faixa */
  let diaSelecionado = Datas.hoje();

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

  /** Quantas demandas do cliente estão visíveis nesta semana, com este filtro. */
  function visiveisDoCliente(clienteId) {
    return demandasDaSemana.filter(function (d) {
      return d.cliente_id === clienteId && (!filtroTags || filtroTags.visivel(d.tag_id));
    }).length;
  }

  /* ------------------------------------------------------------------ *
   * Padrão do filtro pelo cargo                                         *
   * ------------------------------------------------------------------ */

  /**
   * As tags que o cargo de quem está logado é responsável por executar.
   *
   * Devolve lista vazia quando o cargo não é responsável por tag nenhuma —
   * head, social media, gestor de tráfego, ou qualquer cargo novo sem tag. Aí
   * o filtro mostra tudo, que é o certo: esconder todas as tags de quem
   * coordena deixaria a tela em branco.
   */
  function tagsDoMeuCargo() {
    const usuario = Estado.dados.usuario;
    if (!usuario || !usuario.cargo_id) return [];

    return Estado.dados.tags
      .filter(function (t) { return t.cargo_id === usuario.cargo_id; })
      .map(function (t) { return t.id; });
  }

  function dicaDoPadrao() {
    const usuario = Estado.dados.usuario;
    const doCargo = tagsDoMeuCargo();

    if (doCargo.length === 0) {
      return 'Seu cargo não é responsável por nenhuma tag: o padrão mostra todas.';
    }

    const nomes = Estado.dados.tags
      .filter(function (t) { return doCargo.indexOf(t.id) > -1; })
      .map(function (t) { return t.nome; });

    return 'Padrão de ' + (usuario.cargo_nome || 'seu cargo') + ': ' + nomes.join(', ') + '.';
  }

  /* ------------------------------------------------------------------ *
   * Navegação                                                           *
   * ------------------------------------------------------------------ */

  function irPara(novoDomingo) {
    domingo = Datas.inicioSemana(novoDomingo);

    /* Ao mudar de semana no celular, abre no dia de hoje se ele estiver nela,
       senão no domingo. Manter o índice do dia anterior levaria alguém de
       quarta a quarta sem perceber que a semana mudou. */
    const novos = Datas.semana(domingo);
    const hoje = Datas.hoje();
    diaSelecionado = novos.indexOf(hoje) > -1 ? hoje : novos[0];

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
    /* O contador conta o que está visível, não o que existe: com o filtro de
       tags ligado, "5 na semana" ao lado de uma linha vazia seria mentira. */
    const total = visiveisDoCliente(cliente.id);

    return el('div', {
      class: 'gs-celula gs-cliente' + (total === 0 ? ' gs-cliente-vazio' : '')
    }, [
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

  /* ------------------------------------------------------------------ *
   * Desenho do celular: faixa de dias + lista do dia escolhido           *
   * ------------------------------------------------------------------ */

  /**
   * A grade de 7 colunas × 11 clientes não cabe em 375px — seriam 77 células
   * de 50px. No celular ela vira uma faixa com os sete dias e, abaixo, só o
   * dia escolhido, agrupado por cliente.
   *
   * O filtro de tags e a ordenação de clientes são os mesmos: só a forma muda.
   */
  function desenharMobile() {
    refPeriodo.textContent = Datas.intervaloPorExtenso(dias[0], dias[6]);
    UI.limpar(refGrade);

    /* ---- faixa dos sete dias ---- */
    const faixa = el('div', { class: 'sm-faixa' });

    for (const data of dias) {
      const quantas = demandasDaSemana.filter(function (d) {
        return d.data === data && (!filtroTags || filtroTags.visivel(d.tag_id));
      }).length;

      const classes = ['sm-dia'];
      if (data === diaSelecionado) classes.push('sm-dia-ativo');
      if (Datas.ehHoje(data)) classes.push('sm-dia-hoje');

      faixa.appendChild(el('button', {
        class: classes.join(' '),
        type: 'button',
        'aria-pressed': data === diaSelecionado ? 'true' : 'false',
        'aria-label': Datas.comDiaDaSemana(data) + ', ' + quantas + ' demandas',
        onclick: function () {
          diaSelecionado = data;
          desenharMobile();
        }
      }, [
        el('span', { class: 'sm-dia-nome', texto: Datas.nomeDiaCurto(data).toUpperCase() }),
        el('span', { class: 'sm-dia-numero', texto: String(Datas.diaDoMes(data)) }),
        /* o ponto conta o que está visível pelo filtro, não o que existe */
        quantas > 0
          ? el('span', { class: 'sm-dia-contador', texto: String(quantas) })
          : el('span', { class: 'sm-dia-contador sm-dia-contador-vazio', 'aria-hidden': 'true' })
      ]));
    }

    refGrade.appendChild(faixa);

    /* ---- demandas do dia escolhido, por cliente ---- */
    const corpo = el('div', { class: 'sm-corpo' });

    const comTrabalho = [];
    for (const cliente of Estado.dados.clientes) {
      const lista = demandasDaCelula(cliente.id, diaSelecionado);
      if (lista.length > 0) comTrabalho.push({ cliente: cliente, lista: lista });
    }

    if (comTrabalho.length === 0) {
      corpo.appendChild(UI.vazio(
        'Nada em ' + Datas.comDiaDaSemana(diaSelecionado) + '.',
        filtroTags && filtroTags.ocultos.size > 0
          ? 'Há tags escondidas pelo filtro. Toque em Tags para ver as outras.'
          : 'Toque em outro dia da faixa acima.'
      ));
    }

    for (const grupo of comTrabalho) {
      const itens = el('div', { class: 'sm-itens' });

      for (const demanda of grupo.lista) {
        itens.appendChild(Cartao.criar(demanda, {
          aoMudar: carregar,
          arrastavel: false,     /* não há arrastar no toque */
          origem: 'semanal'
        }));
      }

      corpo.appendChild(el('section', { class: 'sm-grupo' }, [
        el('div', { class: 'sm-grupo-topo' }, [
          el('h3', { class: 'sm-grupo-nome', texto: grupo.cliente.nome }),
          el('span', { class: 'texto-fraco', texto: grupo.lista.length + '' })
        ]),
        itens,
        Estado.ehAdmin() ? el('button', {
          class: 'botao botao-largo sm-adicionar', type: 'button',
          onclick: function () {
            Cartao.abrirEditor({
              clienteId: grupo.cliente.id, data: diaSelecionado, aoSalvar: carregar
            });
          }
        }, ['+ Demanda para ' + grupo.cliente.nome]) : null
      ]));
    }

    refGrade.appendChild(corpo);
  }

  function desenhar() {
    if (!refGrade) return;

    /* o dia escolhido tem de pertencer à semana que está na tela */
    if (dias.indexOf(diaSelecionado) === -1) {
      const hoje = Datas.hoje();
      diaSelecionado = dias.indexOf(hoje) > -1 ? hoje : dias[0];
    }

    if (Dispositivo.ehMobile()) {
      desenharMobile();
      return;
    }

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

    /*
     * Quem tem trabalho visível na semana vai para o topo; quem não tem desce.
     * Dentro de cada grupo a ordem de cadastro é preservada — é a ordem que o
     * Júlio arrumou na aba Clientes, e reordenar por dentro dela faria a lista
     * dançar a cada troca de filtro.
     *
     * A ordenação acontece aqui, no desenho, e não no carregamento: assim ela
     * se refaz de graça ao trocar de semana e ao mexer no filtro, que é
     * justamente quando o resultado muda.
     */
    const comTrabalho = [];
    const semTrabalho = [];
    for (const cliente of clientes) {
      (visiveisDoCliente(cliente.id) > 0 ? comTrabalho : semTrabalho).push(cliente);
    }

    const ordenados = comTrabalho.concat(semTrabalho);

    /* uma linha por cliente */
    for (const cliente of ordenados) {
      refGrade.appendChild(celulaCliente(cliente));
      for (const data of dias) refGrade.appendChild(celulaDia(cliente, data));
    }

    /*
     * Separador entre os dois grupos. A grade tem 8 colunas (cliente + 7
     * dias), então a primeira linha dos vazios começa em 8 × (1 + quantos têm
     * trabalho) — o 1 é a linha de cabeçalho. A borda vai nas 8 células, para
     * a linha atravessar a grade inteira.
     */
    if (comTrabalho.length > 0 && semTrabalho.length > 0) {
      const inicio = (comTrabalho.length + 1) * 8;
      for (let i = inicio; i < inicio + 8; i += 1) {
        const celula = refGrade.children[i];
        if (celula) celula.classList.add('gs-inicio-vazios');
      }
    }

    refRolagem.scrollTop = rolagemAnterior.topo;
    refRolagem.scrollLeft = rolagemAnterior.lado;
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function montar(container) {
    /*
     * O filtro de tags parte do cargo de quem entrou, e não é persistido: a
     * cada carregamento ele volta ao padrão da função. Designer abre vendo
     * arte, editor de vídeo abre vendo vídeo, e quem coordena vê tudo.
     *
     * Sem persistir de propósito. Se ficasse gravado, mudar o cargo da pessoa
     * ou o cargo de uma tag não mudaria nada até alguém reabrir o menu e
     * mexer — o padrão velho continuaria mandando.
     */
    filtroTags = Filtro.criar({
      rotulo: 'Tags',
      itens: Estado.dados.tags.map(function (t) {
        return { id: t.id, nome: t.nome, cor: t.cor };
      }),
      padrao: tagsDoMeuCargo,
      rotuloPadrao: 'Restaurar padrão da função',
      dicaPadrao: dicaDoPadrao(),
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
              data: Dispositivo.ehMobile()
                ? diaSelecionado
                : (dias.indexOf(Datas.hoje()) > -1 ? Datas.hoje() : dias[0]),
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
