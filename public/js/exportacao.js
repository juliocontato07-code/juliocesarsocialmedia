'use strict';

/**
 * Exportação do calendário de um cliente e histórico.
 *
 * Sem Electron não existe printToPDF: a folha é montada no próprio documento
 * e entregue à impressão do navegador, que salva em PDF. Fundo branco de
 * propósito — o navegador desliga cor de fundo por padrão na impressão, e um
 * documento preto sairia com texto branco em papel branco.
 */
(function () {
  const el = UI.el;

  function periodoPadrao() {
    const hoje = Datas.hoje();
    return { inicio: hoje, fim: Datas.somarDias(hoje, 27) };
  }

  /* ------------------------------------------------------------------ *
   * Seletor de período com lápis                                        *
   * ------------------------------------------------------------------ */

  function seletorPeriodo(periodo, aoMudar) {
    const caixa = el('div', { class: 'periodo-caixa' });

    function diasNoPeriodo() {
      const a = Datas.paraObjeto(periodo.inicio);
      const b = Datas.paraObjeto(periodo.fim);
      return Math.round((b - a) / 86400000) + 1;
    }

    function modoLeitura() {
      UI.limpar(caixa);
      caixa.appendChild(el('div', { class: 'periodo-texto' }, [
        el('div', { class: 'periodo-valor', texto: Datas.intervaloPorExtenso(periodo.inicio, periodo.fim) }),
        el('div', {
          class: 'periodo-dias',
          texto: diasNoPeriodo() + ' dias · ' + Datas.curta(periodo.inicio) + ' até ' + Datas.curta(periodo.fim)
        })
      ]));
      caixa.appendChild(el('button', {
        class: 'botao-icone lapis-periodo', type: 'button',
        title: 'Escolher outro período', onclick: modoEdicao
      }, ['✎']));
    }

    function modoEdicao() {
      UI.limpar(caixa);

      const de = el('input', { class: 'entrada', type: 'date', value: periodo.inicio });
      const ate = el('input', { class: 'entrada', type: 'date', value: periodo.fim });

      function aplicar() {
        if (!de.value || !ate.value) return UI.aviso('Preencha as duas datas.', 'erro');
        if (de.value > ate.value) return UI.aviso('A data de início vem depois da data de fim.', 'erro');
        periodo.inicio = de.value;
        periodo.fim = ate.value;
        modoLeitura();
        if (typeof aoMudar === 'function') aoMudar(periodo);
      }

      const aoTeclar = function (evento) {
        if (evento.key === 'Enter') { evento.preventDefault(); aplicar(); }
        if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); modoLeitura(); }
      };
      de.addEventListener('keydown', aoTeclar);
      ate.addEventListener('keydown', aoTeclar);

      caixa.appendChild(el('div', { class: 'periodo-edicao' }, [
        el('label', { class: 'periodo-campo' }, [
          el('span', { class: 'campo-rotulo', texto: 'Início' }), de
        ]),
        el('label', { class: 'periodo-campo' }, [
          el('span', { class: 'campo-rotulo', texto: 'Fim' }), ate
        ]),
        el('div', { class: 'periodo-botoes' }, [
          el('button', { class: 'botao-icone', type: 'button', title: 'Aplicar', onclick: aplicar }, ['✓']),
          el('button', { class: 'botao-icone', type: 'button', title: 'Cancelar', onclick: modoLeitura }, ['✕'])
        ])
      ]));

      de.focus();
    }

    modoLeitura();
    return caixa;
  }

  /* ------------------------------------------------------------------ *
   * Folha de impressão                                                  *
   * ------------------------------------------------------------------ */

  function montarFolha(cliente, lista, periodo) {
    const folha = el('div', { class: 'folha', id: 'folha-impressao' });

    folha.appendChild(el('header', { class: 'folha-capa' }, [
      el('h1', { class: 'folha-cliente', texto: cliente.nome }),
      cliente.arroba ? el('div', { class: 'folha-arroba', texto: cliente.arroba }) : null,
      el('div', { class: 'folha-periodo' }, [
        el('span', {}, [
          'Calendário de ',
          el('strong', { texto: Datas.intervaloPorExtenso(periodo.inicio, periodo.fim) })
        ]),
        el('span', {
          texto: lista.length + (lista.length === 1 ? ' publicação' : ' publicações')
        })
      ])
    ]));

    const porData = {};
    for (const demanda of lista) {
      if (!porData[demanda.data]) porData[demanda.data] = [];
      porData[demanda.data].push(demanda);
    }

    let semana = Datas.inicioSemana(periodo.inicio);
    const ultima = Datas.inicioSemana(periodo.fim);
    let algumaSemana = false;

    while (semana <= ultima) {
      const dias = [];

      for (let i = 0; i < 7; i += 1) {
        const data = Datas.somarDias(semana, i);
        if (data < periodo.inicio || data > periodo.fim) continue;
        if (!porData[data]) continue;

        const itens = el('div', { class: 'folha-dia-itens' },
          porData[data].map(function (demanda) {
            const titulo = (demanda.titulo || '').trim();
            return el('div', { class: 'folha-item' }, [
              el('span', { class: 'folha-tipo', texto: demanda.tag_nome }),
              el('span', {
                class: 'folha-titulo' + (titulo ? '' : ' folha-vazio'),
                texto: titulo || 'sem tema definido'
              })
            ]);
          }));

        dias.push(el('div', { class: 'folha-dia' }, [
          el('div', { class: 'folha-dia-rotulo' }, [
            el('span', { class: 'folha-dia-nome', texto: Datas.nomeDiaCurto(data).toUpperCase() }),
            el('span', { class: 'folha-dia-data', texto: Datas.curta(data).slice(0, 5) })
          ]),
          itens
        ]));
      }

      if (dias.length > 0) {
        algumaSemana = true;
        const visivelInicio = semana < periodo.inicio ? periodo.inicio : semana;
        const fimSemana = Datas.somarDias(semana, 6);
        const visivelFim = fimSemana > periodo.fim ? periodo.fim : fimSemana;

        folha.appendChild(el('section', { class: 'folha-semana' }, [
          el('div', {
            class: 'folha-semana-titulo',
            texto: Datas.intervaloPorExtenso(visivelInicio, visivelFim)
          })
        ].concat(dias)));
      }

      semana = Datas.somarDias(semana, 7);
    }

    if (!algumaSemana) {
      folha.appendChild(el('div', {
        class: 'folha-vazio-total',
        texto: 'Nenhuma publicação programada neste período.'
      }));
    }

    folha.appendChild(el('div', { class: 'folha-rodape' }, [
      el('span', { texto: cliente.nome }),
      el('span', { texto: 'Gerado em ' + Datas.porExtenso(Datas.hoje()) })
    ]));

    return folha;
  }

  function imprimir(cliente, lista, periodo) {
    const anterior = document.getElementById('folha-impressao');
    if (anterior) anterior.remove();

    const folha = montarFolha(cliente, lista, periodo);
    document.body.appendChild(folha);
    document.body.classList.add('imprimindo');

    const limpar = function () {
      document.body.classList.remove('imprimindo');
      const atual = document.getElementById('folha-impressao');
      if (atual) atual.remove();
      window.removeEventListener('afterprint', limpar);
    };

    window.addEventListener('afterprint', limpar);

    /* dá um quadro ao navegador para aplicar o estilo antes de abrir o diálogo */
    window.requestAnimationFrame(function () {
      window.print();
      /* alguns navegadores não disparam afterprint: rede de segurança */
      window.setTimeout(limpar, 1500);
    });
  }

  /* ------------------------------------------------------------------ *
   * Modal de exportação                                                 *
   * ------------------------------------------------------------------ */

  function abrirExportacao(cliente, periodoInicial) {
    const periodo = periodoInicial
      ? { inicio: periodoInicial.inicio, fim: periodoInicial.fim }
      : periodoPadrao();

    const contagem = el('div', { class: 'exp-contagem texto-fraco', texto: 'Contando…' });
    let lista = [];

    async function atualizarContagem() {
      contagem.textContent = 'Contando…';
      try {
        lista = await window.api.demandas.listarPeriodo(periodo.inicio, periodo.fim, {
          clienteId: cliente.id, incluirArquivados: true
        });
        contagem.textContent = lista.length === 0
          ? 'Nenhuma publicação neste período — a folha sai avisando isso.'
          : lista.length + (lista.length === 1 ? ' publicação entra na folha.' : ' publicações entram na folha.');
      } catch (erro) {
        contagem.textContent = erro.message;
      }
    }

    const corpo = el('div', { class: 'exp-corpo' }, [
      el('div', { class: 'exp-cliente' }, [
        el('div', { class: 'exp-nome', texto: cliente.nome }),
        cliente.arroba ? el('div', { class: 'texto-fraco', texto: cliente.arroba }) : null,
        cliente.arquivado ? el('span', { class: 'exp-selo', texto: 'arquivado' }) : null
      ]),
      el('div', { class: 'campo-rotulo', texto: 'Período' }),
      seletorPeriodo(periodo, atualizarContagem),
      contagem,
      el('div', { class: 'exp-nota texto-fraco' }, [
        'A folha é documento de cliente: sai sem status e sem link, com o calendário por semana ' +
        'e por dia. Na janela de impressão, escolha "Salvar como PDF" no destino.'
      ])
    ]);

    const modal = UI.abrirModal({
      titulo: 'Imprimir calendário / salvar em PDF',
      largura: '520px',
      corpo: corpo,
      rodape: [
        el('button', {
          class: 'botao', type: 'button', onclick: function () { modal.fechar(); }
        }, ['Cancelar']),
        el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () {
            modal.fechar();
            imprimir(cliente, lista, periodo);
          }
        }, ['Abrir impressão'])
      ]
    });

    atualizarContagem();
    return modal;
  }

  /* ------------------------------------------------------------------ *
   * Histórico do cliente                                                *
   * ------------------------------------------------------------------ */

  function abrirHistorico(cliente) {
    const corpo = el('div', { class: 'hist-corpo' }, [
      el('div', { class: 'texto-fraco', texto: 'Carregando…' })
    ]);

    const modal = UI.abrirModal({
      titulo: 'Histórico — ' + cliente.nome,
      largura: '560px',
      corpo: corpo,
      rodape: [
        el('button', { class: 'botao', type: 'button', onclick: function () { modal.fechar(); } }, ['Fechar']),
        el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () { abrirExportacao(cliente); }
        }, ['Imprimir calendário'])
      ]
    });

    (async function () {
      try {
        const lista = await window.api.demandas.listarPeriodo('1900-01-01', '2999-12-31', {
          clienteId: cliente.id, incluirArquivados: true
        });

        UI.limpar(corpo);

        if (lista.length === 0) {
          corpo.appendChild(UI.vazio('Nenhuma demanda registrada.',
            'Este cliente ainda não teve nada lançado no calendário.'));
          return;
        }

        corpo.appendChild(el('div', { class: 'hist-resumo texto-fraco' }, [
          lista.length + ' demanda(s), de ' + Datas.curta(lista[0].data) +
          ' a ' + Datas.curta(lista[lista.length - 1].data)
        ]));

        let mesAtual = null;
        for (let i = lista.length - 1; i >= 0; i -= 1) {
          const demanda = lista[i];
          const chaveMes = demanda.data.slice(0, 7);

          if (chaveMes !== mesAtual) {
            mesAtual = chaveMes;
            corpo.appendChild(el('div', {
              class: 'hist-mes',
              texto: Datas.nomeMes(Datas.mes(demanda.data)) + ' de ' + Datas.ano(demanda.data)
            }));
          }

          corpo.appendChild(el('div', { class: 'hist-linha' }, [
            el('span', { class: 'hist-data', texto: Datas.curta(demanda.data) }),
            Cartao.pilulaTag(demanda.tag_nome, demanda.tag_cor),
            el('span', {
              class: 'hist-tema' + (demanda.titulo ? '' : ' info-vazia'),
              texto: demanda.titulo || 'sem título'
            }),
            el('span', {
              class: 'hist-status',
              estilo: { background: Cartao.status(demanda.status).cor },
              title: Cartao.status(demanda.status).nome
            })
          ]));
        }
      } catch (erro) {
        UI.limpar(corpo);
        corpo.appendChild(el('div', { class: 'erro', texto: erro.message }));
      }
    })();

    return modal;
  }

  window.Exportacao = {
    abrir: abrirExportacao,
    abrirHistorico: abrirHistorico,
    periodoPadrao: periodoPadrao
  };
})();
