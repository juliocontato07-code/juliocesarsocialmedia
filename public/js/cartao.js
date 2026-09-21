'use strict';

/**
 * Card de demanda, chip de status e o editor de criação.
 * O mesmo card serve à visão semanal e ao modal do dia.
 *
 * O que aparece aqui é deliberadamente enxuto: chip, tag e título.
 * Descrição e link vivem na tela da demanda.
 */
(function () {
  const el = UI.el;

  /* Dois estados apenas. O chip alterna entre eles a cada clique. */
  const STATUS = [
    { valor: 0, nome: 'Pendente',  cor: '#E11D2E' },
    { valor: 1, nome: 'Concluído', cor: '#22C55E' }
  ];

  function status(valor) {
    return STATUS[valor] || STATUS[0];
  }

  /* ------------------------------------------------------------------ *
   * Chip de status                                                      *
   * ------------------------------------------------------------------ */

  /**
   * chipStatus(demanda, { aoMudar, grande })
   * Clique avança o ciclo e grava direto. Sem menu, sem confirmação.
   */
  function chipStatus(demanda, opcoes) {
    const config = opcoes || {};

    /* Espectador é leitura pura: o chip continua mostrando o status, mas vira
       um rótulo, não um botão. Sem cursor de clique e sem foco pelo teclado,
       para não prometer uma ação que o servidor vai recusar. */
    const soLeitura = Estado.ehEspectador();

    const chip = el(soLeitura ? 'span' : 'button', {
      class: 'chip-status' + (config.grande ? ' chip-grande' : '') +
             (soLeitura ? ' chip-leitura' : ''),
      type: soLeitura ? null : 'button',
      title: soLeitura ? 'Seu cargo é espectador: somente leitura' : 'Clique para avançar o status'
    });

    const ponto = el('i', { class: 'chip-ponto' });
    const rotulo = el('span', { class: 'chip-rotulo' });
    chip.appendChild(ponto);
    chip.appendChild(rotulo);

    function pintar(valor) {
      const marcador = status(valor);
      ponto.style.background = marcador.cor;
      rotulo.textContent = marcador.nome;
      chip.style.borderColor = marcador.cor + '66';
      chip.style.background = marcador.cor + '1F';
      chip.dataset.status = String(valor);
    }

    pintar(demanda.status);

    if (soLeitura) {
      chip.pintar = pintar;
      return chip;
    }

    let avancando = false;
    chip.addEventListener('click', async function (evento) {
      evento.stopPropagation();
      if (avancando) return;
      avancando = true;
      try {
        const salva = await window.api.demandas.avancarStatus(demanda.id);
        demanda.status = salva.status;
        pintar(salva.status);
        if (typeof config.aoMudar === 'function') config.aoMudar(salva);
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
      }
      avancando = false;
    });

    chip.pintar = pintar;
    return chip;
  }

  /* ------------------------------------------------------------------ *
   * Pílula de tag                                                       *
   * ------------------------------------------------------------------ */

  function pilulaTag(nome, cor) {
    const tom = cor || '#9A9A9A';
    return el('span', {
      class: 'pilula-tag',
      estilo: { background: tom + '22', borderColor: tom + '55' }
    }, [
      el('i', { class: 'pilula-ponto', estilo: { background: tom } }),
      el('span', { texto: nome })
    ]);
  }

  /* ------------------------------------------------------------------ *
   * Responsável                                                         *
   * ------------------------------------------------------------------ */

  /** 'Julio Cesar' -> 'JC'; 'Luan' -> 'LU'. Duas letras, sempre. */
  function iniciais(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return '??';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  /**
   * Linha do responsável.
   *
   * Sem ninguém atribuído, mostra um traço em vez de esconder a linha: a
   * ausência é informação, e uma linha que desaparece faz os cards da grade
   * ficarem de alturas diferentes.
   */
  function linhaResponsavel(demanda) {
    const nome = demanda.responsavel_nome;

    if (!nome) {
      return el('div', { class: 'cartao-responsavel cartao-responsavel-vago' }, [
        el('span', { class: 'avatar avatar-vago', texto: '–', 'aria-hidden': 'true' }),
        el('span', { class: 'cartao-responsavel-nome', texto: 'sem responsável' })
      ]);
    }

    return el('div', { class: 'cartao-responsavel' }, [
      el('span', { class: 'avatar', texto: iniciais(nome), 'aria-hidden': 'true' }),
      el('span', { class: 'cartao-responsavel-nome', texto: nome, title: nome })
    ]);
  }

  /**
   * Selo de atraso.
   *
   * Leva ícone e texto, não só a borda vermelha do card: quem não distingue
   * vermelho precisa de outro sinal, e "atrasada" escrito é esse sinal.
   */
  function seloAtraso(demanda) {
    if (!demanda.atrasada) return null;

    const dias = Number(demanda.dias_para_entrega);
    const quanto = Number.isFinite(dias) && dias < 0
      ? (dias === -1 ? '1 dia' : Math.abs(dias) + ' dias')
      : '';

    return el('span', {
      class: 'selo-atraso',
      title: quanto ? 'Prazo venceu há ' + quanto : 'Prazo vencido'
    }, [
      el('span', { class: 'selo-atraso-icone', texto: '⚠', 'aria-hidden': 'true' }),
      el('span', { texto: quanto ? 'atrasada ' + quanto : 'atrasada' })
    ]);
  }

  /* ------------------------------------------------------------------ *
   * Editor de criação                                                   *
   * ------------------------------------------------------------------ */

  /**
   * abrirEditor({ clienteId, data, aoSalvar })
   * Só cria. Edição acontece na tela da demanda.
   */
  function abrirEditor(opcoes) {
    const config = opcoes || {};

    if (!Estado.ehAdmin()) {
      UI.aviso('Seu perfil não cria demandas.', 'erro');
      return null;
    }

    const clientes = Estado.dados.clientes;
    const tags = Estado.dados.tags;

    if (clientes.length === 0) {
      UI.aviso('Cadastre ou importe ao menos um cliente antes de criar demandas.', 'erro');
      return null;
    }
    if (tags.length === 0) {
      UI.aviso('Cadastre ao menos uma tag antes de criar demandas.', 'erro');
      return null;
    }

    const seletorCliente = el('select', { class: 'entrada' },
      clientes.map(function (cliente) {
        return el('option', {
          value: String(cliente.id),
          selected: cliente.id === (config.clienteId || clientes[0].id),
          texto: cliente.nome
        });
      }));

    const seletorTag = el('select', { class: 'entrada' },
      tags.map(function (tag) {
        return el('option', { value: String(tag.id), texto: tag.nome });
      }));

    const entradaData = el('input', {
      class: 'entrada', type: 'date',
      value: config.data || Datas.hoje()
    });

    const entradaTitulo = UI.entrada({ placeholder: 'Nome curto da peça' });
    const entradaLink = UI.entrada({ placeholder: 'https://... (opcional)' });

    const seletorResponsavel = Campos.seletorResponsavel(null);
    const seletorPrioridade = Campos.seletorPrioridade('media');
    const entradaPrazo = el('input', { class: 'entrada', type: 'date' });
    const marcaExtra = Campos.marcaExtra(false);

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      el('div', { class: 'formulario-par' }, [
        UI.campo('Cliente', seletorCliente),
        UI.campo('Tag', seletorTag)
      ]),
      el('div', { class: 'formulario-par' }, [
        UI.campo('Data no calendário', entradaData),
        UI.campo('Prazo', entradaPrazo, 'Vazio: vale a data do calendário.')
      ]),
      UI.campo('Título', entradaTitulo),
      el('div', { class: 'formulario-par' }, [
        UI.campo('Responsável', seletorResponsavel),
        UI.campo('Prioridade', seletorPrioridade)
      ]),
      UI.campo('Link', entradaLink, 'A descrição você escreve na tela da demanda.'),
      marcaExtra.elemento
    ]);

    let salvando = false;
    const botaoSalvar = el('button', { class: 'botao botao-principal', type: 'button' }, ['Criar demanda']);

    const modal = UI.abrirModal({
      titulo: 'Nova demanda',
      largura: '520px',
      corpo: formulario,
      rodape: [
        el('button', {
          class: 'botao', type: 'button',
          onclick: function () { modal.fechar(); }
        }, ['Cancelar']),
        botaoSalvar
      ]
    });

    async function salvar() {
      if (salvando) return;
      salvando = true;
      botaoSalvar.disabled = true;
      try {
        const salva = await window.api.demandas.criar({
          cliente_id: Number(seletorCliente.value),
          tag_id: Number(seletorTag.value),
          data: entradaData.value,
          titulo: entradaTitulo.value,
          descricao: '',
          link: entradaLink.value,
          responsavel_id: seletorResponsavel.value === '' ? null : Number(seletorResponsavel.value),
          prioridade: seletorPrioridade.value,
          prazo: entradaPrazo.value || null,
          extra: marcaExtra.marcado()
        });

        UI.aviso('Demanda criada.');
        modal.fechar();
        if (typeof config.aoSalvar === 'function') config.aoSalvar(salva);
        Estado.demandasMudaram();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        salvando = false;
        botaoSalvar.disabled = false;
      }
    }

    botaoSalvar.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (evento) {
      evento.preventDefault();
      salvar();
    });

    entradaTitulo.focus();
    return modal;
  }

  /* ------------------------------------------------------------------ *
   * Duplicar                                                            *
   * ------------------------------------------------------------------ */

  function abrirDuplicar(demanda, aoConcluir) {
    const entradaData = el('input', { class: 'entrada', type: 'date', value: demanda.data });

    const resumo = el('div', { class: 'resumo-copia' }, [
      el('div', { class: 'resumo-copia-linha' }, [
        pilulaTag(demanda.tag_nome, demanda.tag_cor),
        el('span', { class: 'texto-fraco', texto: demanda.cliente_nome })
      ]),
      el('div', {
        class: 'cartao-titulo' + (demanda.titulo ? '' : ' cartao-titulo-vazio'),
        texto: demanda.titulo || 'sem título'
      })
    ]);

    let duplicando = false;
    const botao = el('button', { class: 'botao botao-principal', type: 'button' }, ['Duplicar']);

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      resumo,
      UI.campo('Data da cópia', entradaData, 'Começa no dia do original. Mude para qualquer data.'),
      el('p', { class: 'campo-dica', texto: 'A cópia leva o título e a descrição, nasce como Pendente e sem link.' })
    ]);

    const modal = UI.abrirModal({
      titulo: 'Duplicar demanda',
      largura: '440px',
      corpo: formulario,
      rodape: [
        el('button', {
          class: 'botao', type: 'button',
          onclick: function () { modal.fechar(); }
        }, ['Cancelar']),
        botao
      ]
    });

    async function duplicar() {
      if (duplicando) return;
      duplicando = true;
      botao.disabled = true;
      try {
        const copia = await window.api.demandas.duplicar(demanda.id, entradaData.value);
        UI.aviso('Cópia criada em ' + Datas.curta(copia.data) + '.');
        modal.fechar();
        if (typeof aoConcluir === 'function') aoConcluir(copia);
        Estado.demandasMudaram();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        duplicando = false;
        botao.disabled = false;
      }
    }

    botao.addEventListener('click', duplicar);
    formulario.addEventListener('submit', function (evento) {
      evento.preventDefault();
      duplicar();
    });

    entradaData.focus();
    return modal;
  }

  /* ------------------------------------------------------------------ *
   * Excluir                                                             *
   * ------------------------------------------------------------------ */

  async function pedirExclusao(demanda, aoConcluir) {
    const certeza = await UI.confirmar({
      titulo: 'Excluir demanda',
      texto: 'A demanda de ' + demanda.cliente_nome + ' em ' + Datas.curta(demanda.data) +
             ' será apagada de vez, com título e descrição. Isso não tem como desfazer.',
      rotuloOk: 'Excluir',
      perigo: true
    });
    if (!certeza) return false;

    try {
      await window.api.demandas.excluir(demanda.id);
      UI.aviso('Demanda excluída.');
      if (typeof aoConcluir === 'function') aoConcluir();
      Estado.demandasMudaram();
      return true;
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Card                                                                *
   * ------------------------------------------------------------------ */

  /**
   * criar(demanda, { aoMudar, mostrarCliente, arrastavel, origem })
   * Clicar no card abre a tela da demanda.
   */
  function criar(demanda, opcoes) {
    const config = opcoes || {};
    const aoMudar = config.aoMudar || function () {};

    const cartao = el('article', {
      class: 'cartao-demanda' +
             (demanda.atrasada ? ' cartao-atrasada' : '') +
             (demanda.extra ? ' cartao-extra' : ''),
      dados: {
        id: String(demanda.id),
        status: String(demanda.status),
        prioridade: demanda.prioridade || 'media'
      }
    });

    const ferramentas = Estado.ehAdmin() ? el('div', { class: 'cartao-ferramentas' }, [
      el('button', {
        class: 'botao-icone', type: 'button', title: 'Abrir e editar',
        onclick: function (evento) {
          evento.stopPropagation();
          abrirTela(demanda, config.origem);
        }
      }, ['✎']),
      el('button', {
        class: 'botao-icone', type: 'button', title: 'Duplicar',
        onclick: function (evento) {
          evento.stopPropagation();
          abrirDuplicar(demanda, aoMudar);
        }
      }, ['⧉']),
      el('button', {
        class: 'botao-icone botao-icone-perigo', type: 'button', title: 'Excluir',
        onclick: function (evento) {
          evento.stopPropagation();
          pedirExclusao(demanda, aoMudar);
        }
      }, ['✕'])
    ]) : null;

    const chip = chipStatus(demanda, {
      aoMudar: function (salva) { cartao.dataset.status = String(salva.status); }
    });

    /* Três linhas, nesta ordem: status com a tag, o responsável, o título.
       As ferramentas moram na primeira linha, à direita, e só aparecem no
       hover — por isso não brigam com a tag pelo espaço. */
    cartao.appendChild(el('div', { class: 'cartao-topo' }, [
      chip,
      pilulaTag(demanda.tag_nome, demanda.tag_cor),
      demanda.extra ? el('span', {
        class: 'selo-extra', title: 'Solicitação fora do escopo contratado', texto: 'extra'
      }) : null,
      ferramentas
    ]));

    cartao.appendChild(linhaResponsavel(demanda));

    if (config.mostrarCliente) {
      cartao.appendChild(el('div', { class: 'cartao-cliente', texto: demanda.cliente_nome }));
    }

    cartao.appendChild(el('div', {
      class: 'cartao-titulo' + (demanda.titulo && demanda.titulo.trim() !== '' ? '' : ' cartao-titulo-vazio'),
      texto: demanda.titulo && demanda.titulo.trim() !== '' ? demanda.titulo : 'sem título',
      title: demanda.titulo || ''
    }));

    const selo = seloAtraso(demanda);
    if (selo) cartao.appendChild(selo);

    cartao.addEventListener('click', function (evento) {
      if (evento.target.closest('.chip-status, .cartao-ferramentas')) return;
      abrirTela(demanda, config.origem);
    });

    /* arrastar move a demanda de dia e de cliente: só o admin pode */
    if (config.arrastavel && Estado.ehAdmin()) Arrastar.tornarArrastavel(cartao, demanda);

    return cartao;
  }

  /** Atalho para a tela da demanda, resolvido em tempo de execução. */
  function abrirTela(demanda, origem) {
    if (window.TelaDemanda) {
      App.ir('demanda', { id: demanda.id, origem: origem || App.atual() });
    }
  }

  window.Cartao = {
    criar: criar,
    chipStatus: chipStatus,
    abrirEditor: abrirEditor,
    abrirDuplicar: abrirDuplicar,
    pedirExclusao: pedirExclusao,
    pilulaTag: pilulaTag,
    linhaResponsavel: linhaResponsavel,
    seloAtraso: seloAtraso,
    iniciais: iniciais,
    status: status,
    STATUS: STATUS
  };
})();
