'use strict';

/**
 * Lista de demandas: uma por linha, tabela larga com rolagem lateral.
 *
 * A ordenação acontece no navegador, sobre o resultado já filtrado, porque o
 * filtro é que reduz o volume — e reordenar sem ir ao servidor responde na
 * hora quando alguém fica trocando de coluna procurando um padrão.
 */
(function () {
  const el = UI.el;

  let raiz = null;
  let refCorpo = null;
  let refResumo = null;
  let desinscrever = null;

  let demandas = [];
  let filtros = null;
  let ordem = { coluna: 'prazo', crescente: true };

  /* ------------------------------------------------------------------ *
   * Colunas                                                            *
   * ------------------------------------------------------------------ */

  /**
   * Cada coluna sabe como se desenha e como se ordena.
   *
   * O `valor` existe separado do `celula` de propósito: ordenar por "Em
   * atraso" precisa de um número comparável, não do texto que aparece.
   */
  const COLUNAS = [
    {
      id: 'data_solicitacao',
      rotulo: 'Solicitado',
      valor: function (d) { return d.data_solicitacao || ''; },
      celula: function (d) {
        return d.data_solicitacao
          ? el('span', { texto: Datas.curta(d.data_solicitacao) })
          : el('span', { class: 'texto-fraco', texto: '—' });
      }
    },
    {
      id: 'cliente',
      rotulo: 'Cliente',
      valor: function (d) { return d.cliente_nome || ''; },
      celula: function (d) { return el('span', { texto: d.cliente_nome }); }
    },
    {
      id: 'tag',
      rotulo: 'Tipo',
      valor: function (d) { return d.tag_nome || ''; },
      celula: function (d) { return Cartao.pilulaTag(d.tag_nome, d.tag_cor); }
    },
    {
      id: 'titulo',
      rotulo: 'Título',
      largura: 'ampla',
      valor: function (d) { return (d.titulo || '').toLowerCase(); },
      celula: function (d) {
        const vazio = !d.titulo || d.titulo.trim() === '';

        /* Na tabela vai só o título; a descrição inteira abre no pop-up.
           É botão, e não div clicável, para o teclado alcançar. */
        return el('button', {
          class: 'celula-titulo' + (vazio ? ' celula-titulo-vazio' : ''),
          type: 'button',
          title: 'Abrir a descrição completa',
          onclick: function () { abrirDescricao(d); }
        }, [
          el('span', { texto: vazio ? 'sem título' : d.titulo }),
          d.extra ? el('span', { class: 'selo-extra', texto: 'extra' }) : null
        ]);
      }
    },
    {
      id: 'responsavel',
      rotulo: 'Responsáveis',
      /* sem responsável vai para o fim na ordem crescente, não para o começo:
         '' ordenaria antes de 'Ana', e o vazio no topo não ajuda ninguém */
      valor: function (d) {
        const pessoas = d.responsaveis || [];
        return pessoas.length === 0 ? '￿' : Cartao.nomeDe(pessoas[0]);
      },
      celula: function (d) {
        const pessoas = d.responsaveis || [];
        if (pessoas.length === 0) {
          return el('span', { class: 'texto-fraco', texto: 'sem responsável' });
        }

        const nomes = pessoas.map(Cartao.nomeDe);

        return el('span', { class: 'celula-pessoa-compacta', title: nomes.join(', ') }, [
          el('span', {
            class: 'pilha-avatares' + (pessoas.length > 2 ? ' pilha-junta' : '')
          }, pessoas.map(function (p) { return Cartao.avatar(p, { pequeno: true }); })),
          el('span', {
            class: 'celula-nomes',
            texto: pessoas.length === 1 ? nomes[0] : nomes.length + ' pessoas'
          })
        ]);
      }
    },
    {
      id: 'prioridade',
      rotulo: 'Prioridade',
      /* ordem de gravidade, não alfabética: alta antes de baixa */
      valor: function (d) {
        return ({ alta: 0, media: 1, baixa: 2 })[d.prioridade];
      },
      celula: function (d) {
        return el('span', {
          class: 'pilula-prioridade pilula-prioridade-' + (d.prioridade || 'media'),
          texto: Campos.nomePrioridade(d.prioridade)
        });
      }
    },
    {
      id: 'prazo',
      rotulo: 'Publicação',
      valor: function (d) { return d.data || ''; },
      celula: function (d) {
        return el('span', {
          title: 'Data de publicação, que é também o prazo de entrega',
          texto: Datas.curta(d.data)
        });
      }
    },
    {
      id: 'concluido_em',
      rotulo: 'Concluída em',
      valor: function (d) { return d.dia_conclusao || ''; },
      celula: function (d) {
        if (!d.dia_conclusao) {
          return el('span', {
            class: 'texto-fraco',
            title: d.status === 1 ? 'Concluída sem data registrada' : '',
            texto: '—'
          });
        }
        /* a data civil em São Paulo vem pronta do servidor: formatar o
           timestamp aqui daria o dia errado perto da meia-noite */
        return el('span', {
          title: new Date(d.concluido_em).toLocaleString('pt-BR'),
          texto: Datas.curta(d.dia_conclusao)
        });
      }
    },
    {
      id: 'status',
      rotulo: 'Status',
      valor: function (d) { return d.status; },
      celula: function (d) {
        return Cartao.chipStatus(d, {
          aoMudar: function (salva) {
            /* o servidor devolve a demanda recalculada, com concluido_em e as
               derivações já novas: trocar em memória e redesenhar mantém a
               coluna de prazo coerente sem outra ida à rede */
            const indice = demandas.findIndex(function (x) { return x.id === salva.id; });
            if (indice > -1) demandas[indice] = salva;
            desenhar();
            atualizarResumo();
          }
        });
      }
    },
    {
      id: 'indicador',
      rotulo: 'Indicador de prazo',
      /* atraso primeiro, e dentro do atraso o mais vencido na frente; depois
         o que está por vencer, por dias restantes */
      valor: function (d) {
        if (d.em_dia === false) return -100000 + Number(d.dias_para_entrega || 0);
        if (d.status === 1) return 100000;
        return Number(d.dias_para_entrega || 0);
      },
      celula: function (d) { return Campos.selo(d); }
    }
  ];

  /* ------------------------------------------------------------------ *
   * Pop-up da descrição                                                 *
   * ------------------------------------------------------------------ */

  /**
   * A descrição completa, em leitura.
   *
   * Fecha por Esc, pelo X e por clique no fundo — isso vem do UI.abrirModal,
   * que já trata os três.
   */
  function abrirDescricao(demanda) {
    const temDescricao = demanda.descricao && demanda.descricao.trim() !== '';

    const cabecalho = el('div', { class: 'popup-cabecalho' }, [
      el('div', { class: 'popup-linha' }, [
        Cartao.pilulaTag(demanda.tag_nome, demanda.tag_cor),
        el('span', {
          class: 'pilula-prioridade pilula-prioridade-' + (demanda.prioridade || 'media'),
          texto: Campos.nomePrioridade(demanda.prioridade)
        }),
        Campos.selo(demanda),
        demanda.extra ? el('span', { class: 'selo-extra', texto: 'extra' }) : null
      ]),
      el('dl', { class: 'popup-dados' }, [
        el('dt', { texto: 'Cliente' }), el('dd', { texto: demanda.cliente_nome }),
        el('dt', { texto: (demanda.responsaveis || []).length > 1 ? 'Responsáveis' : 'Responsável' }),
        el('dd', {
          texto: (demanda.responsaveis || []).length === 0
            ? 'sem responsável'
            : demanda.responsaveis.map(Cartao.nomeDe).join(', ')
        }),
        el('dt', { texto: 'Publicação' }),
        el('dd', { texto: Datas.curta(demanda.data) + ' — é também o prazo' }),
        demanda.data_solicitacao ? el('dt', { texto: 'Solicitado em' }) : null,
        demanda.data_solicitacao ? el('dd', { texto: Datas.curta(demanda.data_solicitacao) }) : null,
        demanda.dia_conclusao ? el('dt', { texto: 'Concluída em' }) : null,
        demanda.dia_conclusao
          ? el('dd', { texto: Datas.curta(demanda.dia_conclusao) })
          : null
      ])
    ]);

    const corpo = el('div', { class: 'popup-descricao-caixa' }, [
      el('div', { class: 'campo-rotulo', texto: 'Descrição' }),
      temDescricao
        ? el('pre', { class: 'popup-descricao', texto: demanda.descricao })
        : el('p', { class: 'texto-fraco', texto: 'Esta demanda não tem descrição.' })
    ]);

    const modal = UI.abrirModal({
      titulo: demanda.titulo || 'sem título',
      largura: '680px',
      corpo: el('div', {}, [cabecalho, corpo]),
      rodape: [
        el('button', {
          class: 'botao', type: 'button', onclick: function () { modal.fechar(); }
        }, ['Fechar']),
        demanda.link ? el('button', {
          class: 'botao', type: 'button',
          onclick: function () {
            window.api.abrirLink(demanda.link).catch(function (e) { UI.aviso(e.message, 'erro'); });
          }
        }, ['Abrir link']) : null,
        el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () {
            modal.fechar();
            App.ir('demanda', { id: demanda.id, origem: 'lista' });
          }
        }, [Estado.ehAdmin() ? 'Abrir e editar' : 'Abrir'])
      ]
    });

    return modal;
  }

  /* ------------------------------------------------------------------ *
   * Filtros                                                            *
   * ------------------------------------------------------------------ */

  function montarFiltros() {
    const hoje = Datas.hoje();

    const inicio = el('input', {
      class: 'entrada entrada-compacta', type: 'date',
      value: Estado.pref('lista.inicio', Datas.primeiroDiaDoMes(hoje))
    });
    const fim = el('input', {
      class: 'entrada entrada-compacta', type: 'date',
      value: Estado.pref('lista.fim', Datas.ultimoDiaDoMes(hoje))
    });

    function seletor(rotuloVazio, itens, chavePref) {
      const s = el('select', { class: 'entrada entrada-compacta' }, [
        el('option', { value: '', texto: rotuloVazio })
      ].concat(itens.map(function (i) {
        return el('option', { value: String(i.id), texto: i.nome });
      })));
      s.value = String(Estado.pref(chavePref, ''));
      return s;
    }

    const cliente = seletor('Todos os clientes',
      Estado.dados.clientes.map(function (c) { return { id: c.id, nome: c.nome }; }),
      'lista.cliente');

    const tag = seletor('Todos os tipos',
      Estado.dados.tags.map(function (t) { return { id: t.id, nome: t.nome }; }),
      'lista.tag');

    const responsavel = seletor('Todos os responsáveis',
      [{ id: 'sem', nome: 'Sem responsável' }].concat(
        Estado.dados.atribuiveis.map(function (u) {
          return { id: u.id, nome: Cartao.nomeDe(u) };
        })
      ),
      'lista.responsavel');

    const status = el('select', { class: 'entrada entrada-compacta' }, [
      el('option', { value: '', texto: 'Pendente e concluído' }),
      el('option', { value: '0', texto: 'Só pendentes' }),
      el('option', { value: '1', texto: 'Só concluídas' })
    ]);
    status.value = String(Estado.pref('lista.status', ''));

    const prioridade = seletor('Todas as prioridades',
      Campos.PRIORIDADES.map(function (p) { return { id: p.id, nome: p.nome }; }),
      'lista.prioridade');

    const soAtrasadas = el('input', { type: 'checkbox' });
    soAtrasadas.checked = Boolean(Estado.pref('lista.atrasadas', false));

    const soExtras = el('input', { type: 'checkbox' });
    soExtras.checked = Boolean(Estado.pref('lista.extras', false));

    const controles = { inicio, fim, cliente, tag, responsavel, status, prioridade, soAtrasadas, soExtras };

    function guardar() {
      Estado.definirPref('lista.inicio', inicio.value);
      Estado.definirPref('lista.fim', fim.value);
      Estado.definirPref('lista.cliente', cliente.value);
      Estado.definirPref('lista.tag', tag.value);
      Estado.definirPref('lista.responsavel', responsavel.value);
      Estado.definirPref('lista.status', status.value);
      Estado.definirPref('lista.prioridade', prioridade.value);
      Estado.definirPref('lista.atrasadas', soAtrasadas.checked);
      Estado.definirPref('lista.extras', soExtras.checked);
    }

    for (const chave of Object.keys(controles)) {
      controles[chave].addEventListener('change', function () {
        guardar();
        carregar();
      });
    }

    function ler() {
      return {
        inicio: inicio.value || null,
        fim: fim.value || null,
        clienteId: cliente.value || null,
        tagId: tag.value || null,
        responsavelId: responsavel.value || null,
        status: status.value === '' ? null : status.value,
        prioridade: prioridade.value || null,
        somenteAtrasadas: soAtrasadas.checked,
        extra: soExtras.checked
      };
    }

    const elemento = el('div', { class: 'filtros-lista' }, [
      el('div', { class: 'filtro-grupo' }, [
        el('span', { class: 'filtro-rotulo', texto: 'De' }), inicio,
        el('span', { class: 'filtro-rotulo', texto: 'até' }), fim
      ]),
      cliente, tag, responsavel, status, prioridade,
      el('label', { class: 'filtro-marca' }, [soAtrasadas, el('span', { texto: 'Só atrasadas' })]),
      el('label', { class: 'filtro-marca' }, [soExtras, el('span', { texto: 'Só extras' })]),
      el('button', {
        class: 'botao botao-pequeno', type: 'button',
        onclick: function () {
          inicio.value = Datas.primeiroDiaDoMes(Datas.hoje());
          fim.value = Datas.ultimoDiaDoMes(Datas.hoje());
          cliente.value = '';
          tag.value = '';
          responsavel.value = '';
          status.value = '';
          prioridade.value = '';
          soAtrasadas.checked = false;
          soExtras.checked = false;
          guardar();
          carregar();
        }
      }, ['Limpar'])
    ]);

    return { elemento: elemento, ler: ler };
  }

  /* ------------------------------------------------------------------ *
   * Desenho                                                            *
   * ------------------------------------------------------------------ */

  function ordenar(lista) {
    const coluna = COLUNAS.find(function (c) { return c.id === ordem.coluna; }) || COLUNAS[6];
    const sinal = ordem.crescente ? 1 : -1;

    return lista.slice().sort(function (a, b) {
      const va = coluna.valor(a);
      const vb = coluna.valor(b);
      if (va === vb) return a.id - b.id;      /* empate estável */
      return (va > vb ? 1 : -1) * sinal;
    });
  }

  function cabecalho() {
    return el('tr', {}, COLUNAS.map(function (coluna) {
      const ativa = ordem.coluna === coluna.id;

      return el('th', { class: coluna.largura === 'ampla' ? 'coluna-ampla' : null }, [
        el('button', {
          class: 'ordenar' + (ativa ? ' ordenar-ativa' : ''),
          type: 'button',
          title: 'Ordenar por ' + coluna.rotulo,
          onclick: function () {
            if (ordem.coluna === coluna.id) ordem.crescente = !ordem.crescente;
            else ordem = { coluna: coluna.id, crescente: true };
            Estado.definirPref('lista.ordem', ordem);
            desenhar();
          }
        }, [
          el('span', { texto: coluna.rotulo }),
          el('span', {
            class: 'ordenar-seta',
            texto: ativa ? (ordem.crescente ? '↑' : '↓') : ''
          })
        ])
      ]);
    }));
  }

  function desenhar() {
    if (!refCorpo) return;
    UI.limpar(refCorpo);

    if (demandas.length === 0) {
      refCorpo.appendChild(el('div', { class: 'painel' }, [
        UI.vazio('Nenhuma demanda com esses filtros.',
          'Ajuste o período ou limpe os filtros.')
      ]));
      return;
    }

    const linhas = ordenar(demandas).map(function (d) {
      return el('tr', {
        class: d.em_dia === false ? 'linha-atrasada' : null,
        dados: { id: String(d.id) }
      }, COLUNAS.map(function (coluna) {
        return el('td', { class: coluna.largura === 'ampla' ? 'coluna-ampla' : null }, [
          coluna.celula(d)
        ]);
      }));
    });

    refCorpo.appendChild(el('div', { class: 'tabela-rolagem tabela-rolagem-cheia' }, [
      el('table', { class: 'tabela tabela-lista' }, [
        el('thead', {}, [cabecalho()]),
        el('tbody', {}, linhas)
      ])
    ]));
  }

  function atualizarResumo() {
    if (!refResumo) return;

    const total = demandas.length;
    const concluidas = demandas.filter(function (d) { return d.status === 1; }).length;

    /*
     * "Em atraso" agora vale para os dois lados da regra: pendente com a
     * publicação vencida, e concluída depois da publicação. Somar os dois num
     * número só faria alguém achar que há 162 coisas para fazer quando metade
     * já está entregue, só entregue fora do dia. Por isso vão separados.
     */
    const pendentesVencidas = demandas.filter(function (d) {
      return d.status === 0 && d.em_dia === false;
    }).length;

    const concluidasForaDoPrazo = demandas.filter(function (d) {
      return d.status === 1 && d.em_dia === false;
    }).length;

    UI.limpar(refResumo);
    refResumo.appendChild(el('span', {
      title: 'Em atraso = pendente com a publicação vencida, ou concluída depois da publicação.'
    }, [
      total + (total === 1 ? ' demanda' : ' demandas') +
      ' · ' + concluidas + ' concluída' + (concluidas === 1 ? '' : 's') +
      ' · ' + pendentesVencidas + ' vencida' + (pendentesVencidas === 1 ? '' : 's') +
      ' · ' + concluidasForaDoPrazo + ' entregue' + (concluidasForaDoPrazo === 1 ? '' : 's') +
      ' fora do prazo'
    ]));
  }

  async function carregar() {
    if (!refCorpo) return;

    UI.limpar(refCorpo);
    refCorpo.appendChild(el('div', { class: 'texto-fraco carregando', texto: 'Buscando…' }));

    try {
      demandas = await window.api.demandas.listar(filtros.ler());
      desenhar();
      atualizarResumo();
    } catch (erro) {
      UI.limpar(refCorpo);
      refCorpo.appendChild(el('div', { class: 'painel' }, [
        el('div', { class: 'erro', texto: erro.message })
      ]));
    }
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function montar(container) {
    raiz = el('div', { class: 'tela-cheia' });
    container.appendChild(raiz);

    const gravada = Estado.pref('lista.ordem', null);
    if (gravada && gravada.coluna && COLUNAS.some(function (c) { return c.id === gravada.coluna; })) {
      ordem = { coluna: gravada.coluna, crescente: Boolean(gravada.crescente) };
    }

    filtros = montarFiltros();
    refResumo = el('span', { class: 'texto-fraco' });
    refCorpo = el('div', { class: 'lista-corpo' });

    raiz.appendChild(el('div', { class: 'barra barra-alta' }, [
      el('div', { class: 'barra-esquerda barra-esquerda-quebra' }, [
        el('span', { class: 'barra-periodo', texto: 'Lista' }),
        filtros.elemento
      ]),
      el('div', { class: 'barra-direita' }, [refResumo])
    ]));

    raiz.appendChild(refCorpo);

    desinscrever = Estado.aoMudarDemandas(carregar);
    carregar();
  }

  function desmontar() {
    if (desinscrever) desinscrever();
    desinscrever = null;
    raiz = null;
    refCorpo = null;
    refResumo = null;
    filtros = null;
    demandas = [];
  }

  window.TelaLista = { montar: montar, desmontar: desmontar };
})();
