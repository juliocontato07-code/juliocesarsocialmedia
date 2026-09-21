'use strict';

/**
 * Rotinas: o trabalho recorrente do time.
 *
 * Rotina não é demanda e não aparece em nenhuma tela de demanda. Não existe
 * aqui nenhum caminho que crie demanda a partir de rotina, nem o contrário.
 *
 * Quem vê o quê: admin vê o time inteiro e cadastra; usuário vê a própria
 * rotina e marca o check do dia; espectador vê e não marca.
 */
(function () {
  const el = UI.el;

  const SIGLAS = [
    { id: 'DOM', nome: 'Dom' },
    { id: 'SEG', nome: 'Seg' },
    { id: 'TER', nome: 'Ter' },
    { id: 'QUA', nome: 'Qua' },
    { id: 'QUI', nome: 'Qui' },
    { id: 'SEX', nome: 'Sex' },
    { id: 'SAB', nome: 'Sáb' }
  ];

  let raiz = null;
  let refDia = null;
  let refTime = null;
  let refCadastro = null;
  let dia = null;

  /* ------------------------------------------------------------------ *
   * Texto da recorrência                                                *
   * ------------------------------------------------------------------ */

  function descreverRecorrencia(rotina) {
    if (rotina.frequencia === 'diaria') return 'todos os dias';

    if (rotina.frequencia === 'semanal') {
      const siglas = String(rotina.dias_semana || '').split(',').filter(Boolean);
      const nomes = siglas.map(function (s) {
        const achada = SIGLAS.find(function (x) { return x.id === s; });
        return achada ? achada.nome : s;
      });
      return nomes.length === 0 ? 'semanal' : nomes.join(', ');
    }

    return 'dia ' + rotina.dia_mes + ' de cada mês';
  }

  /* ------------------------------------------------------------------ *
   * A rotina do dia                                                     *
   * ------------------------------------------------------------------ */

  async function carregarDia() {
    if (!refDia) return;

    UI.limpar(refDia);
    refDia.appendChild(el('div', { class: 'texto-fraco carregando', texto: 'Carregando…' }));

    try {
      const lista = await window.api.rotinas.doDia(dia);
      desenharDia(lista);
    } catch (erro) {
      UI.limpar(refDia);
      refDia.appendChild(el('div', { class: 'erro', texto: erro.message }));
    }
  }

  function desenharDia(lista) {
    UI.limpar(refDia);

    if (lista.length === 0) {
      refDia.appendChild(UI.vazio(
        'Nenhuma rotina para ' + Datas.comDiaDaSemana(dia) + '.',
        Estado.ehAdmin()
          ? 'Tarefa semanal aparece só nos dias configurados, e mensal só no dia do mês.'
          : 'Quando houver rotina sua para hoje, ela aparece aqui.'
      ));
      return;
    }

    const feitas = lista.filter(function (r) { return r.concluida; }).length;

    refDia.appendChild(el('div', { class: 'rotina-progresso' }, [
      el('span', { texto: feitas + ' de ' + lista.length + ' marcadas' }),
      el('span', { class: 'barra-mini barra-mini-larga' }, [
        el('span', {
          class: 'barra-mini-preenchida',
          estilo: {
            width: (lista.length ? Math.round((feitas / lista.length) * 100) : 0) + '%',
            background: feitas === lista.length ? '#22C55E' : 'var(--acento)'
          }
        })
      ])
    ]));

    /* Já vem ordenado por horário do servidor; agrupar por pessoa só faz
       sentido para o admin, que vê o time inteiro. */
    const agrupar = Estado.ehAdmin();
    let donoAtual = null;

    for (const rotina of lista) {
      if (agrupar && rotina.usuario_id !== donoAtual) {
        donoAtual = rotina.usuario_id;
        refDia.appendChild(el('div', { class: 'rotina-dono' }, [
          Cartao.avatar({ usuario: rotina.usuario_nome, nome_completo: rotina.usuario_nome_completo,
                          cargo: rotina.usuario_cargo }, { pequeno: true }),
          el('span', { texto: Cartao.nomeDe({ usuario: rotina.usuario_nome,
                                              nome_completo: rotina.usuario_nome_completo }) }),
          el('span', { class: 'texto-fraco', texto: rotina.usuario_cargo || '' })
        ]));
      }

      refDia.appendChild(linhaRotina(rotina));
    }
  }

  function linhaRotina(rotina) {
    /* Espectador vê e não marca. Usuário marca só a própria — o servidor
       recusa de todo jeito, isto aqui é só para não oferecer o clique. */
    const podeMarcar = !Estado.ehSomenteLeitura() &&
      (Estado.ehAdmin() || rotina.usuario_id === Estado.dados.usuario.id);

    const caixa = el('input', { type: 'checkbox' });
    caixa.checked = Boolean(rotina.concluida);
    caixa.disabled = !podeMarcar;

    const linha = el('label', {
      class: 'rotina-item' + (rotina.concluida ? ' rotina-feita' : '') +
             (podeMarcar ? '' : ' rotina-travada'),
      title: podeMarcar ? '' : 'Você não marca esta rotina'
    }, [
      caixa,
      el('span', { class: 'rotina-horario', texto: rotina.horario || '—' }),
      el('span', { class: 'rotina-tarefa', texto: rotina.tarefa }),
      el('span', { class: 'rotina-frequencia texto-fraco', texto: descreverRecorrencia(rotina) }),
      rotina.marcado_em
        ? el('span', {
            class: 'rotina-marcado texto-fraco',
            texto: new Date(rotina.marcado_em).toLocaleTimeString('pt-BR', {
              hour: '2-digit', minute: '2-digit'
            })
          })
        : null
    ]);

    if (!podeMarcar) return linha;

    let gravando = false;
    caixa.addEventListener('change', async function () {
      if (gravando) return;
      gravando = true;
      const desejado = caixa.checked;
      caixa.disabled = true;

      try {
        await window.api.rotinas.marcar(rotina.id, dia, desejado);
        rotina.concluida = desejado;
        linha.classList.toggle('rotina-feita', desejado);
        /* recarrega para o contador e o consolidado do time acompanharem */
        carregarDia();
        if (Estado.ehAdmin()) carregarTime();
      } catch (erro) {
        caixa.checked = !desejado;          /* desfaz o visual */
        UI.aviso(erro.message, 'erro');
      }

      caixa.disabled = false;
      gravando = false;
    });

    return linha;
  }

  /* ------------------------------------------------------------------ *
   * Consolidado do time (admin)                                         *
   * ------------------------------------------------------------------ */

  function pct(parte, total) {
    if (!total) return null;
    return Math.round((Number(parte) / Number(total)) * 100);
  }

  function textoPct(valor) {
    return valor === null ? '—' : valor + '%';
  }

  async function carregarTime() {
    if (!refTime) return;

    UI.limpar(refTime);
    refTime.appendChild(el('div', { class: 'texto-fraco carregando', texto: 'Contando…' }));

    try {
      const lista = await window.api.rotinas.consolidado(dia);
      desenharTime(lista);
    } catch (erro) {
      UI.limpar(refTime);
      refTime.appendChild(el('div', { class: 'erro', texto: erro.message }));
    }
  }

  function desenharTime(lista) {
    UI.limpar(refTime);

    if (lista.length === 0) {
      refTime.appendChild(UI.vazio('Ninguém tem rotina cadastrada ainda.'));
      return;
    }

    const linhas = lista.map(function (p) {
      const hoje = pct(p.hoje_feitas, p.hoje_total);
      const sete = pct(p.sete_feitas, p.sete_total);
      const trinta = pct(p.trinta_feitas, p.trinta_total);

      return el('tr', {}, [
        el('td', {}, [
          el('div', { class: 'celula-pessoa' }, [
            Cartao.avatar({ usuario: p.login || p.nome, nome_completo: p.nome_completo, cargo: p.cargo }),
            el('div', {}, [
              el('div', { class: 'celula-pessoa-nome', texto: p.nome }),
              el('div', { class: 'texto-fraco celula-pessoa-cargo', texto: p.cargo || '' })
            ])
          ])
        ]),
        el('td', { class: 'coluna-numero' }, [
          el('span', {
            class: p.hoje_total === 0 ? 'texto-fraco' : null,
            texto: p.hoje_total === 0 ? 'sem rotina hoje' : p.hoje_feitas + ' de ' + p.hoje_total
          })
        ]),
        el('td', { class: 'coluna-numero' }, [
          el('span', { title: p.sete_feitas + ' de ' + p.sete_total + ' ocorrências', texto: textoPct(sete) })
        ]),
        el('td', { class: 'coluna-numero' }, [
          el('span', { title: p.trinta_feitas + ' de ' + p.trinta_total + ' ocorrências', texto: textoPct(trinta) })
        ]),
        el('td', {}, [
          el('span', { class: 'barra-mini barra-mini-larga' }, [
            el('span', {
              class: 'barra-mini-preenchida',
              estilo: {
                width: (trinta === null ? 0 : trinta) + '%',
                background: trinta === null ? 'var(--texto-fraco)'
                  : trinta >= 80 ? '#22C55E' : trinta >= 50 ? '#F59E0B' : 'var(--acento)'
              }
            })
          ])
        ])
      ]);
    });

    refTime.appendChild(el('div', { class: 'tabela-rolagem' }, [
      el('table', { class: 'tabela' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { texto: 'Pessoa' }),
            el('th', { class: 'coluna-numero', texto: 'Hoje' }),
            el('th', { class: 'coluna-numero', texto: '7 dias' }),
            el('th', { class: 'coluna-numero', texto: '30 dias' }),
            el('th', { texto: '' })
          ])
        ]),
        el('tbody', {}, linhas)
      ])
    ]));

    refTime.appendChild(el('p', { class: 'painel-sub', texto:
      'O denominador é o número de vezes que a rotina realmente caiu no período, ' +
      'não rotina vezes dias: tarefa de segunda conta 1 vez em 7 dias, não 7.' }));
  }

  /* ------------------------------------------------------------------ *
   * Cadastro (admin)                                                    *
   * ------------------------------------------------------------------ */

  async function carregarCadastro() {
    if (!refCadastro) return;

    UI.limpar(refCadastro);
    refCadastro.appendChild(el('div', { class: 'texto-fraco carregando', texto: 'Carregando…' }));

    try {
      const lista = await window.api.rotinas.listar({ incluirInativas: true });
      desenharCadastro(lista);
    } catch (erro) {
      UI.limpar(refCadastro);
      refCadastro.appendChild(el('div', { class: 'erro', texto: erro.message }));
    }
  }

  function desenharCadastro(lista) {
    UI.limpar(refCadastro);

    if (lista.length === 0) {
      refCadastro.appendChild(UI.vazio('Nenhuma rotina cadastrada.',
        'Use "+ Nova rotina" para começar.'));
      return;
    }

    for (const rotina of lista) {
      refCadastro.appendChild(el('div', {
        class: 'linha-rotina-cadastro' + (rotina.ativa ? '' : ' linha-inativa')
      }, [
        el('div', { class: 'celula-pessoa' }, [
          Cartao.avatar({ usuario: rotina.usuario_nome,
                          nome_completo: rotina.usuario_nome_completo }, { pequeno: true }),
          el('span', { texto: Cartao.nomeDe({ usuario: rotina.usuario_nome,
                                              nome_completo: rotina.usuario_nome_completo }) })
        ]),
        el('span', { class: 'rotina-horario', texto: rotina.horario || '—' }),
        el('span', { class: 'rotina-tarefa', texto: rotina.tarefa }),
        el('span', { class: 'texto-fraco', texto: descreverRecorrencia(rotina) }),
        el('span', {
          class: 'usuario-situacao',
          texto: rotina.ativa ? 'ativa' : 'desativada'
        }),
        el('div', { class: 'usuario-acoes' }, [
          el('button', {
            class: 'botao botao-pequeno', type: 'button',
            onclick: function () { abrirFormulario(rotina); }
          }, ['Editar']),
          el('button', {
            class: 'botao botao-pequeno', type: 'button',
            onclick: async function () {
              try {
                await window.api.rotinas.definirAtiva(rotina.id, !rotina.ativa);
                UI.aviso(rotina.ativa ? 'Rotina desativada.' : 'Rotina reativada.');
                carregarCadastro();
                carregarDia();
                carregarTime();
              } catch (erro) { UI.aviso(erro.message, 'erro'); }
            }
          }, [rotina.ativa ? 'Desativar' : 'Reativar'])
        ])
      ]));
    }
  }

  /**
   * Formulário de rotina. Sem `rotina`, cria; com, edita.
   *
   * Os campos de dia da semana e dia do mês aparecem conforme a frequência,
   * porque preencher "dias da semana" numa rotina diária não significa nada e
   * um campo morto no formulário só gera dúvida.
   */
  function abrirFormulario(rotina) {
    const editando = Boolean(rotina);
    const pessoas = Estado.dados.atribuiveis;

    if (pessoas.length === 0) {
      UI.aviso('Cadastre alguém que não seja espectador antes de criar rotina.', 'erro');
      return null;
    }

    const dono = el('select', { class: 'entrada' }, pessoas.map(function (p) {
      return el('option', {
        value: String(p.id),
        selected: editando && p.id === rotina.usuario_id,
        texto: Cartao.nomeDe(p) + (p.cargo ? ' — ' + p.cargo : '')
      });
    }));

    const tarefa = UI.entrada({
      value: editando ? rotina.tarefa : '',
      placeholder: 'ex.: responder comentários dos perfis'
    });

    const horario = el('input', {
      class: 'entrada', type: 'time',
      value: editando ? (rotina.horario || '') : ''
    });

    const frequencia = el('select', { class: 'entrada' }, [
      el('option', { value: 'diaria', selected: editando && rotina.frequencia === 'diaria', texto: 'Diária' }),
      el('option', { value: 'semanal', selected: editando && rotina.frequencia === 'semanal', texto: 'Semanal' }),
      el('option', { value: 'mensal', selected: editando && rotina.frequencia === 'mensal', texto: 'Mensal' })
    ]);

    const marcados = new Set(
      editando ? String(rotina.dias_semana || '').split(',').filter(Boolean) : []
    );

    const caixasDia = SIGLAS.map(function (s) {
      const caixa = el('input', { type: 'checkbox' });
      caixa.checked = marcados.has(s.id);
      caixa.dataset.sigla = s.id;
      return el('label', { class: 'dia-marca' }, [caixa, el('span', { texto: s.nome })]);
    });

    const blocoSemana = UI.campo('Dias da semana',
      el('div', { class: 'dias-semana' }, caixasDia));

    const diaMes = el('input', {
      class: 'entrada', type: 'number', min: '1', max: '31',
      value: editando && rotina.dia_mes ? String(rotina.dia_mes) : '1'
    });

    const blocoMes = UI.campo('Dia do mês', diaMes,
      'Dia 29, 30 ou 31 em mês mais curto cai no último dia do mês.');

    function ajustarVisibilidade() {
      blocoSemana.style.display = frequencia.value === 'semanal' ? '' : 'none';
      blocoMes.style.display = frequencia.value === 'mensal' ? '' : 'none';
    }

    frequencia.addEventListener('change', ajustarVisibilidade);

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      UI.campo('Pessoa', dono),
      UI.campo('Tarefa', tarefa),
      el('div', { class: 'formulario-par' }, [
        UI.campo('Horário', horario, 'Opcional. Sem horário, vai para o fim da lista.'),
        UI.campo('Frequência', frequencia)
      ]),
      blocoSemana,
      blocoMes
    ]);

    ajustarVisibilidade();

    let salvando = false;
    const botao = el('button', { class: 'botao botao-principal', type: 'button' },
      [editando ? 'Salvar' : 'Criar rotina']);

    const modal = UI.abrirModal({
      titulo: editando ? 'Editar rotina' : 'Nova rotina',
      largura: '520px',
      corpo: formulario,
      rodape: [
        el('button', {
          class: 'botao', type: 'button', onclick: function () { modal.fechar(); }
        }, ['Cancelar']),
        botao
      ]
    });

    async function salvar() {
      if (salvando) return;
      salvando = true;
      botao.disabled = true;

      const dias = caixasDia
        .map(function (rotulo) { return rotulo.querySelector('input'); })
        .filter(function (caixa) { return caixa.checked; })
        .map(function (caixa) { return caixa.dataset.sigla; })
        .join(',');

      const dados = {
        usuario_id: Number(dono.value),
        tarefa: tarefa.value,
        horario: horario.value || null,
        frequencia: frequencia.value,
        dias_semana: dias,
        dia_mes: Number(diaMes.value)
      };

      try {
        if (editando) await window.api.rotinas.atualizar(rotina.id, dados);
        else await window.api.rotinas.criar(dados);

        UI.aviso(editando ? 'Rotina salva.' : 'Rotina criada.');
        modal.fechar();
        carregarCadastro();
        carregarDia();
        carregarTime();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        salvando = false;
        botao.disabled = false;
      }
    }

    botao.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (e) { e.preventDefault(); salvar(); });
    tarefa.focus();

    return modal;
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function montar(container) {
    dia = Datas.hoje();

    raiz = el('div', { class: 'tela-cheia' });
    container.appendChild(raiz);

    const entradaDia = el('input', { class: 'entrada entrada-compacta', type: 'date', value: dia });
    entradaDia.addEventListener('change', function () {
      dia = entradaDia.value || Datas.hoje();
      atualizarTitulo();
      carregarDia();
      if (Estado.ehAdmin()) carregarTime();
    });

    const titulo = el('span', { class: 'barra-periodo' });

    function atualizarTitulo() {
      titulo.textContent = 'Rotinas · ' + Datas.comDiaDaSemana(dia);
    }
    atualizarTitulo();

    raiz.appendChild(el('div', { class: 'barra' }, [
      el('div', { class: 'barra-esquerda' }, [
        titulo,
        entradaDia,
        el('button', {
          class: 'botao botao-pequeno', type: 'button',
          onclick: function () {
            dia = Datas.hoje();
            entradaDia.value = dia;
            atualizarTitulo();
            carregarDia();
            if (Estado.ehAdmin()) carregarTime();
          }
        }, ['Hoje'])
      ]),
      el('div', { class: 'barra-direita' }, [
        Estado.ehAdmin() ? el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () { abrirFormulario(null); }
        }, ['+ Nova rotina']) : null
      ])
    ]));

    refDia = el('div', { class: 'rotina-lista' });

    const corpo = el('div', { class: 'painel-rolagem' }, [
      el('section', { class: 'painel painel-secao' }, [
        el('div', { class: 'painel-topo' }, [
          el('div', {}, [
            el('h2', { class: 'painel-titulo', texto: 'A rotina do dia' }),
            el('p', { class: 'painel-sub', texto: Estado.ehSomenteLeitura()
              ? 'Seu cargo é somente leitura: você acompanha e não marca.'
              : Estado.ehAdmin()
                ? 'Você vê e marca a rotina do time inteiro.'
                : 'Marque o que você já fez. Só a sua rotina aparece aqui.' })
          ])
        ]),
        refDia
      ])
    ]);

    if (Estado.ehAdmin()) {
      refTime = el('div', {});
      refCadastro = el('div', { class: 'lista-rotinas' });

      corpo.appendChild(el('section', { class: 'painel painel-secao' }, [
        el('div', { class: 'painel-topo' }, [
          el('div', {}, [
            el('h2', { class: 'painel-titulo', texto: 'Cumprimento do time' }),
            el('p', { class: 'painel-sub', texto: 'Hoje, e o acumulado dos últimos 7 e 30 dias.' })
          ])
        ]),
        refTime
      ]));

      corpo.appendChild(el('section', { class: 'painel painel-secao' }, [
        el('div', { class: 'painel-topo' }, [
          el('div', {}, [
            el('h2', { class: 'painel-titulo', texto: 'Rotinas cadastradas' }),
            el('p', { class: 'painel-sub', texto:
              'Rotina não se apaga: desative, e os checks já marcados continuam ' +
              'valendo como histórico.' })
          ])
        ]),
        refCadastro
      ]));
    }

    raiz.appendChild(corpo);

    carregarDia();
    if (Estado.ehAdmin()) {
      carregarTime();
      carregarCadastro();
    }
  }

  function desmontar() {
    raiz = null;
    refDia = null;
    refTime = null;
    refCadastro = null;
  }

  window.TelaRotinas = { montar: montar, desmontar: desmontar };
})();
