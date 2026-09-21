'use strict';

/**
 * Dashboard: uma página só, em rolagem, com o mês inteiro em números.
 *
 * Nada aqui é calculado no navegador. As cinco seções vêm contadas do banco
 * numa ida só, porque somar 357 demandas no cliente daria outro resultado que
 * a lista filtrada — e dois números diferentes na mesma tela é pior que
 * número nenhum.
 */
(function () {
  const el = UI.el;

  let raiz = null;
  let refCorpo = null;
  let meses = [];
  let selecionado = null;   /* { ano, mes } */
  let desinscrever = null;

  /* ------------------------------------------------------------------ *
   * Formatação                                                          *
   * ------------------------------------------------------------------ */

  /**
   * Porcentagem com denominador zero.
   *
   * Devolve null em vez de 0 quando não há o que dividir: "0%" e "não houve
   * nada para medir" são leituras diferentes, e mostrar 0% num mês sem
   * demanda faria o time parecer parado quando só não havia trabalho.
   */
  function pct(parte, total) {
    if (!total) return null;
    return Math.round((Number(parte) / Number(total)) * 100);
  }

  function textoPct(valor, vazio) {
    return valor === null ? (vazio || '—') : valor + '%';
  }

  /* ------------------------------------------------------------------ *
   * Peças reutilizadas                                                  *
   * ------------------------------------------------------------------ */

  function cartaoNumero(rotulo, valor, detalhe, tom) {
    return el('div', { class: 'kpi' + (tom ? ' kpi-' + tom : '') }, [
      el('div', { class: 'kpi-rotulo', texto: rotulo }),
      el('div', { class: 'kpi-valor', texto: String(valor) }),
      detalhe ? el('div', { class: 'kpi-detalhe', texto: detalhe }) : null
    ]);
  }

  function secao(titulo, subtitulo, conteudo) {
    return el('section', { class: 'painel painel-secao' }, [
      el('div', { class: 'painel-topo' }, [
        el('div', {}, [
          el('h2', { class: 'painel-titulo', texto: titulo }),
          subtitulo ? el('p', { class: 'painel-sub', texto: subtitulo }) : null
        ])
      ]),
      conteudo
    ]);
  }

  /** Barra proporcional, para o olho comparar sem ler número por número. */
  function barra(valor, maximo, cor) {
    const largura = maximo > 0 ? Math.max(2, Math.round((valor / maximo) * 100)) : 0;
    return el('span', { class: 'barra-mini' }, [
      el('span', {
        class: 'barra-mini-preenchida',
        estilo: { width: largura + '%', background: cor || 'var(--acento)' }
      })
    ]);
  }

  function tabela(colunas, linhas, vazio) {
    if (linhas.length === 0) {
      return el('div', { class: 'tabela-vazia' }, [UI.vazio(vazio || 'Nada neste mês.')]);
    }

    return el('div', { class: 'tabela-rolagem' }, [
      el('table', { class: 'tabela' }, [
        el('thead', {}, [
          el('tr', {}, colunas.map(function (c) {
            return el('th', {
              class: c.numerica ? 'coluna-numero' : null,
              texto: c.rotulo
            });
          }))
        ]),
        el('tbody', {}, linhas)
      ])
    ]);
  }

  /* ------------------------------------------------------------------ *
   * 4.1 Visão geral                                                     *
   * ------------------------------------------------------------------ */

  function visaoGeral(g) {
    const taxa = pct(g.concluidas, g.total);
    const prazo = pct(g.no_prazo, g.mensuraveis);

    const cartoes = el('div', { class: 'kpis' }, [
      cartaoNumero('Demandas no mês', g.total, g.extras > 0 ? g.extras + ' são extras' : null),
      cartaoNumero('Concluídas', g.concluidas, textoPct(taxa, 'sem demanda') + ' do mês', 'ok'),
      cartaoNumero('Em aberto', g.abertas, null),
      cartaoNumero('Atrasadas agora', g.atrasadas,
        g.atrasadas > 0 ? 'pendentes com prazo vencido' : 'nenhum prazo vencido',
        g.atrasadas > 0 ? 'alerta' : null),
      cartaoNumero('Entregas no prazo', textoPct(prazo, '—'),
        g.mensuraveis > 0
          ? g.no_prazo + ' de ' + g.mensuraveis + ' com hora registrada'
          : 'nenhuma conclusão medida ainda')
    ]);

    /* O denominador do prazo não é o total de concluídas: demanda concluída
       antes de existir registro de hora não tem como ser medida. Dizer isso na
       tela evita a conta "não fecha" com a linha de cima. */
    const nota = g.concluidas > g.mensuraveis
      ? el('p', { class: 'painel-sub', texto:
          (g.concluidas - g.mensuraveis) + ' conclusão(ões) deste mês não tem hora registrada e ' +
          'ficam fora do índice de prazo, sem contar como atraso.' })
      : null;

    return secao('Visão geral do mês', null, el('div', {}, [cartoes, nota]));
  }

  /* ------------------------------------------------------------------ *
   * 4.2 Produtividade por colaborador                                   *
   * ------------------------------------------------------------------ */

  function colaboradores(lista) {
    const comPessoa = lista.filter(function (l) { return l.usuario_id !== null; });

    /* Os destaques saem só de quem tem nome: "sem atribuição" não é pessoa e
       não pode ganhar o troféu de maior carga. */
    const maiorCarga = comPessoa.reduce(function (a, b) {
      return !a || b.total > a.total ? b : a;
    }, null);

    const melhorPrazo = comPessoa.reduce(function (a, b) {
      const pb = pct(b.no_prazo, b.mensuraveis);
      if (pb === null) return a;
      const pa = a ? pct(a.no_prazo, a.mensuraveis) : null;
      return pa === null || pb > pa ? b : a;
    }, null);

    const maximo = lista.reduce(function (m, l) { return Math.max(m, l.total); }, 0);

    const linhas = lista.map(function (l) {
      const semPessoa = l.usuario_id === null;
      const participacao = pct(l.total, l.total_do_mes);
      const taxa = pct(l.concluidas, l.total);
      const prazo = pct(l.no_prazo, l.mensuraveis);

      const marcas = [];
      if (maiorCarga && l.usuario_id === maiorCarga.usuario_id) {
        marcas.push(el('span', { class: 'etiqueta etiqueta-carga', texto: 'maior carga' }));
      }
      if (melhorPrazo && l.usuario_id === melhorPrazo.usuario_id) {
        marcas.push(el('span', { class: 'etiqueta etiqueta-prazo', texto: 'melhor prazo' }));
      }

      return el('tr', { class: semPessoa ? 'linha-sem-pessoa' : null }, [
        el('td', {}, [
          el('div', { class: 'celula-pessoa' }, [
            semPessoa
              ? el('span', { class: 'avatar avatar-vago', texto: '–' })
              : el('span', { class: 'avatar', texto: Cartao.iniciais(l.nome) }),
            el('div', {}, [
              el('div', { class: 'celula-pessoa-nome', texto: l.nome }),
              l.cargo
                ? el('div', { class: 'texto-fraco celula-pessoa-cargo', texto: Estado.nomeCargo(l.cargo) })
                : el('div', { class: 'texto-fraco celula-pessoa-cargo', texto: 'ninguém atribuído' })
            ]),
            marcas.length ? el('span', { class: 'celula-marcas' }, marcas) : null
          ])
        ]),
        el('td', { class: 'coluna-numero' }, [
          el('div', { class: 'celula-com-barra' }, [
            el('span', { texto: String(l.total) }),
            barra(l.total, maximo, semPessoa ? 'var(--texto-fraco)' : 'var(--acento)')
          ])
        ]),
        el('td', { class: 'coluna-numero', texto: String(l.concluidas) }),
        el('td', { class: 'coluna-numero', texto: textoPct(participacao) }),
        el('td', { class: 'coluna-numero', texto: textoPct(taxa) }),
        el('td', { class: 'coluna-numero' }, [
          el('span', {
            class: prazo === null ? 'texto-fraco' : null,
            title: l.mensuraveis > 0 ? l.no_prazo + ' de ' + l.mensuraveis + ' medidas' : 'nada medido',
            texto: textoPct(prazo)
          })
        ]),
        el('td', { class: 'coluna-numero' }, [
          l.atrasadas > 0
            ? el('span', { class: 'numero-alerta', texto: String(l.atrasadas) })
            : el('span', { class: 'texto-fraco', texto: '0' })
        ])
      ]);
    });

    const colunas = [
      { rotulo: 'Pessoa' },
      { rotulo: 'Atribuídas', numerica: true },
      { rotulo: 'Concluídas', numerica: true },
      { rotulo: 'Participação', numerica: true },
      { rotulo: 'Conclusão', numerica: true },
      { rotulo: 'No prazo', numerica: true },
      { rotulo: 'Atrasadas', numerica: true }
    ];

    return secao(
      'Produtividade por colaborador',
      'Participação é a fatia do mês. Conclusão e prazo são da própria carga de cada um.',
      tabela(colunas, linhas, 'Nenhuma demanda neste mês.')
    );
  }

  /* ------------------------------------------------------------------ *
   * 4.3 Solicitações extras por cliente                                 *
   * ------------------------------------------------------------------ */

  function extras(lista) {
    const maximo = lista.reduce(function (m, l) { return Math.max(m, l.total); }, 0);

    const linhas = lista.map(function (l) {
      return el('tr', {}, [
        el('td', { texto: l.nome }),
        el('td', { class: 'coluna-numero' }, [
          el('div', { class: 'celula-com-barra' }, [
            el('span', { texto: String(l.total) }),
            barra(l.total, maximo, '#F59E0B')
          ])
        ]),
        el('td', { class: 'coluna-numero', texto: String(l.concluidas) }),
        el('td', { class: 'coluna-numero', texto: textoPct(pct(l.concluidas, l.total)) }),
        el('td', { class: 'coluna-numero', texto: String(l.abertas) })
      ]);
    });

    return secao(
      'Solicitações extras por cliente',
      'Só o que está marcado como fora do escopo contratado.',
      tabela([
        { rotulo: 'Cliente' },
        { rotulo: 'Extras', numerica: true },
        { rotulo: 'Concluídas', numerica: true },
        { rotulo: 'Conclusão', numerica: true },
        { rotulo: 'Abertas', numerica: true }
      ], linhas, 'Nenhuma solicitação extra neste mês.')
    );
  }

  /* ------------------------------------------------------------------ *
   * 4.4 Demandas por tipo                                               *
   * ------------------------------------------------------------------ */

  function tipos(lista) {
    const maximo = lista.reduce(function (m, l) { return Math.max(m, l.total); }, 0);

    const linhas = lista.map(function (l) {
      return el('tr', {}, [
        el('td', {}, [Cartao.pilulaTag(l.nome, l.cor)]),
        el('td', { class: 'coluna-numero' }, [
          el('div', { class: 'celula-com-barra' }, [
            el('span', { texto: String(l.total) }),
            barra(l.total, maximo, l.cor)
          ])
        ]),
        el('td', { class: 'coluna-numero', texto: String(l.concluidas) }),
        el('td', { class: 'coluna-numero', texto: textoPct(pct(l.concluidas, l.total)) })
      ]);
    });

    return secao(
      'Demandas por tipo',
      'Sai das tags cadastradas, quaisquer que sejam.',
      tabela([
        { rotulo: 'Tipo' },
        { rotulo: 'Total', numerica: true },
        { rotulo: 'Concluídas', numerica: true },
        { rotulo: 'Conclusão', numerica: true }
      ], linhas, 'Nenhuma demanda neste mês.')
    );
  }

  /* ------------------------------------------------------------------ *
   * 4.5 Clientes com mais demandas                                      *
   * ------------------------------------------------------------------ */

  function clientes(lista) {
    const maximo = lista.reduce(function (m, l) { return Math.max(m, l.total); }, 0);

    const linhas = lista.map(function (l, indice) {
      return el('tr', {}, [
        el('td', { class: 'coluna-posicao', texto: String(indice + 1) }),
        el('td', {}, [
          el('div', { class: 'celula-cliente' }, [
            el('span', { texto: l.nome }),
            l.arroba ? el('span', { class: 'texto-fraco', texto: l.arroba }) : null
          ])
        ]),
        el('td', { class: 'coluna-numero' }, [
          el('div', { class: 'celula-com-barra' }, [
            el('span', { texto: String(l.total) }),
            barra(l.total, maximo)
          ])
        ]),
        el('td', { class: 'coluna-numero', texto: String(l.concluidas) }),
        el('td', { class: 'coluna-numero', texto: String(l.abertas) }),
        el('td', { class: 'coluna-numero' }, [
          l.atrasadas > 0
            ? el('span', { class: 'numero-alerta', texto: String(l.atrasadas) })
            : el('span', { class: 'texto-fraco', texto: '0' })
        ])
      ]);
    });

    return secao(
      'Clientes com mais demandas',
      null,
      tabela([
        { rotulo: '#' },
        { rotulo: 'Cliente' },
        { rotulo: 'Total', numerica: true },
        { rotulo: 'Concluídas', numerica: true },
        { rotulo: 'Abertas', numerica: true },
        { rotulo: 'Atrasadas', numerica: true }
      ], linhas, 'Nenhuma demanda neste mês.')
    );
  }

  /* ------------------------------------------------------------------ *
   * Carregamento                                                        *
   * ------------------------------------------------------------------ */

  function limites(escolha) {
    const primeiro = escolha.ano + '-' + (escolha.mes < 10 ? '0' : '') + escolha.mes + '-01';
    return { inicio: primeiro, fim: Datas.ultimoDiaDoMes(primeiro) };
  }

  async function carregar() {
    if (!refCorpo || !selecionado) return;

    UI.limpar(refCorpo);
    refCorpo.appendChild(el('div', { class: 'texto-fraco carregando', texto: 'Contando…' }));

    const faixa = limites(selecionado);

    try {
      const dados = await window.api.painel.tudo(faixa.inicio, faixa.fim);

      UI.limpar(refCorpo);
      refCorpo.appendChild(visaoGeral(dados.geral));
      refCorpo.appendChild(colaboradores(dados.colaboradores));
      refCorpo.appendChild(extras(dados.extras));
      refCorpo.appendChild(tipos(dados.tipos));
      refCorpo.appendChild(clientes(dados.clientes));
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

  function seletorDeMes() {
    const seletor = el('select', { class: 'entrada entrada-compacta' },
      meses.map(function (m) {
        return el('option', {
          value: m.ano + '-' + m.mes,
          selected: selecionado && m.ano === selecionado.ano && m.mes === selecionado.mes,
          texto: Datas.nomeMes(m.mes - 1) + ' de ' + m.ano + ' (' + m.total + ')'
        });
      }));

    seletor.addEventListener('change', function () {
      const partes = seletor.value.split('-').map(Number);
      selecionado = { ano: partes[0], mes: partes[1] };
      Estado.definirPref('painel.mes', seletor.value);
      carregar();
    });

    return seletor;
  }

  async function montar(container) {
    raiz = el('div', { class: 'tela-cheia' });
    container.appendChild(raiz);

    refCorpo = el('div', { class: 'painel-rolagem' });

    try {
      meses = await window.api.painel.meses();
    } catch (erro) {
      raiz.appendChild(el('div', { class: 'tela-simples' }, [
        el('div', { class: 'painel' }, [el('div', { class: 'erro', texto: erro.message })])
      ]));
      return;
    }

    if (meses.length === 0) {
      raiz.appendChild(el('div', { class: 'tela-simples' }, [
        el('div', { class: 'painel' }, [
          UI.vazio('Nenhuma demanda cadastrada.',
            'O dashboard aparece quando houver pelo menos um mês com demanda.')
        ])
      ]));
      return;
    }

    /* Reabre no mês que a pessoa estava vendo; se aquele mês não tem mais
       demanda, cai no mais recente em vez de numa tela vazia. */
    const gravado = Estado.pref('painel.mes', null);
    const achado = gravado && meses.find(function (m) { return m.ano + '-' + m.mes === gravado; });
    const escolha = achado || meses[0];
    selecionado = { ano: escolha.ano, mes: escolha.mes };

    raiz.appendChild(el('div', { class: 'barra' }, [
      el('div', { class: 'barra-esquerda' }, [
        el('span', { class: 'barra-periodo', texto: 'Dashboard' }),
        seletorDeMes()
      ]),
      el('div', { class: 'barra-direita' }, [
        el('button', {
          class: 'botao', type: 'button', title: 'Recontar agora',
          onclick: carregar
        }, ['Atualizar'])
      ])
    ]));

    raiz.appendChild(refCorpo);

    /* marcar Concluído em outra tela muda estes números */
    desinscrever = Estado.aoMudarDemandas(carregar);

    carregar();
  }

  function desmontar() {
    if (desinscrever) desinscrever();
    desinscrever = null;
    raiz = null;
    refCorpo = null;
  }

  window.TelaDashboard = { montar: montar, desmontar: desmontar };
})();
