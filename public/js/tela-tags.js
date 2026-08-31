'use strict';

(function () {
  const el = UI.el;

  const CORES_SUGERIDAS = [
    '#E11D2E', '#F59E0B', '#EAB308', '#22C55E',
    '#3B82F6', '#8B5CF6', '#EC4899', '#9A9A9A'
  ];

  let desinscrever = null;
  let refAtivas = null;
  let refArquivadas = null;
  let refTituloArquivadas = null;

  /* ---------------- seletor de cor ---------------- */

  function seletorCor(corInicial) {
    let corAtual = corInicial || CORES_SUGERIDAS[0];

    const nativo = el('input', { class: 'cor-nativa', type: 'color', value: corAtual });
    const amostras = el('div', { class: 'cor-amostras' });

    function marcar() {
      nativo.value = corAtual;
      for (const botao of amostras.children) {
        botao.classList.toggle('ativa', botao.dataset.cor.toUpperCase() === corAtual.toUpperCase());
      }
    }

    for (const cor of CORES_SUGERIDAS) {
      amostras.appendChild(el('button', {
        class: 'cor-amostra',
        type: 'button',
        title: cor,
        dados: { cor: cor },
        estilo: { background: cor },
        onclick: function () { corAtual = cor; marcar(); }
      }));
    }

    nativo.addEventListener('input', function () {
      corAtual = nativo.value.toUpperCase();
      marcar();
    });

    marcar();

    return {
      elemento: el('div', { class: 'cor-escolha' }, [amostras, nativo]),
      ler: function () { return corAtual; }
    };
  }

  /* ---------------- editor ---------------- */

  function abrirEditor(tag) {
    const ehNova = !tag;
    const entradaNome = UI.entrada({
      value: tag ? tag.nome : '',
      maxlength: 120,
      placeholder: 'Ex.: Reels, Bastidores'
    });
    const cor = seletorCor(tag ? tag.cor : CORES_SUGERIDAS[0]);
    let salvando = false;

    const botaoSalvar = el('button', { class: 'botao botao-principal', type: 'button' },
      [ehNova ? 'Criar tag' : 'Salvar']);

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      UI.campo('Nome da tag', entradaNome),
      UI.campo('Cor', cor.elemento)
    ]);

    const modal = UI.abrirModal({
      titulo: ehNova ? 'Nova tag' : 'Editar tag',
      largura: '460px',
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
        const dados = { nome: entradaNome.value, cor: cor.ler() };
        if (ehNova) await window.api.tags.criar(dados);
        else await window.api.tags.atualizar(tag.id, dados);
        await Estado.recarregar();
        UI.aviso(ehNova ? 'Tag criada.' : 'Tag atualizada.');
        modal.fechar();
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

    entradaNome.focus();
  }

  /* ---------------- ações ---------------- */

  async function mover(indice, deslocamento) {
    const ativas = Estado.dados.tags.slice();
    const destino = indice + deslocamento;
    if (destino < 0 || destino >= ativas.length) return;

    const movida = ativas.splice(indice, 1)[0];
    ativas.splice(destino, 0, movida);

    const ids = ativas.map(function (t) { return t.id; })
      .concat(Estado.dados.tagsArquivadas.map(function (t) { return t.id; }));

    try {
      await window.api.tags.reordenar(ids);
      await Estado.recarregar();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  async function pedirArquivamento(tag) {
    let emUso = 0;
    try {
      emUso = await window.api.tags.emUso(tag.id);
    } catch (erro) { /* segue com 0 */ }

    const texto = emUso > 0
      ? 'A tag "' + tag.nome + '" está em ' + emUso + ' demanda(s). Arquivar tira ela do select ' +
        'dos novos cards, mas as demandas existentes continuam com ela.'
      : 'A tag "' + tag.nome + '" sai do select dos cards. Nada é apagado e dá para desarquivar depois.';

    const certeza = await UI.confirmar({
      titulo: 'Arquivar tag',
      texto: texto,
      rotuloOk: 'Arquivar'
    });
    if (!certeza) return;

    try {
      await window.api.tags.arquivar(tag.id);
      await Estado.recarregar();
      UI.aviso('Tag arquivada.');
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  /* ---------------- desenho ---------------- */

  function botaoIcone(rotulo, titulo, aoClicar, desabilitado) {
    return el('button', {
      class: 'botao-icone',
      type: 'button',
      title: titulo,
      disabled: desabilitado === true,
      onclick: aoClicar
    }, [rotulo]);
  }

  function linhaTag(tag, indice, total) {
    return el('div', { class: 'linha-tag' }, [
      Estado.ehAdmin() ? el('div', { class: 'linha-tag-ordem' }, [
        botaoIcone('↑', 'Subir', function () { mover(indice, -1); }, indice === 0),
        botaoIcone('↓', 'Descer', function () { mover(indice, 1); }, indice === total - 1)
      ]) : null,
      el('span', { class: 'ponto-tag', estilo: { background: tag.cor || '#9A9A9A' } }),
      el('span', { class: 'linha-tag-nome', texto: tag.nome }),
      Estado.ehAdmin() ? el('div', { class: 'linha-tag-acoes' }, [
        el('button', {
          class: 'botao botao-pequeno', type: 'button',
          onclick: function () { abrirEditor(tag); }
        }, ['Editar']),
        el('button', {
          class: 'botao botao-pequeno', type: 'button',
          onclick: function () { pedirArquivamento(tag); }
        }, ['Arquivar'])
      ]) : null
    ]);
  }

  function desenhar() {
    if (!refAtivas) return;

    UI.limpar(refAtivas);
    const ativas = Estado.dados.tags;

    if (ativas.length === 0) {
      refAtivas.appendChild(UI.vazio('Nenhuma tag ativa.', 'Crie ao menos uma para poder cadastrar demandas.'));
    } else {
      ativas.forEach(function (tag, indice) {
        refAtivas.appendChild(linhaTag(tag, indice, ativas.length));
      });
    }

    UI.limpar(refArquivadas);
    const arquivadas = Estado.dados.tagsArquivadas;
    refTituloArquivadas.style.display = arquivadas.length === 0 ? 'none' : '';
    refArquivadas.style.display = arquivadas.length === 0 ? 'none' : '';

    for (const tag of arquivadas) {
      refArquivadas.appendChild(el('div', { class: 'linha-tag linha-tag-inativa' }, [
        el('span', { class: 'ponto-tag', estilo: { background: tag.cor || '#9A9A9A' } }),
        el('span', { class: 'linha-tag-nome', texto: tag.nome }),
        el('div', { class: 'linha-tag-acoes' }, [
          el('button', {
            class: 'botao botao-pequeno', type: 'button',
            onclick: async function () {
              try {
                await window.api.tags.desarquivar(tag.id);
                await Estado.recarregar();
                UI.aviso('Tag reativada.');
              } catch (erro) {
                UI.aviso(erro.message, 'erro');
              }
            }
          }, ['Desarquivar'])
        ])
      ]));
    }
  }

  /* ---------------- montagem ---------------- */

  function montar(container) {
    refAtivas = el('div', { class: 'lista-tags-cadastro' });
    refArquivadas = el('div', { class: 'lista-tags-cadastro' });
    refTituloArquivadas = el('h3', { class: 'secao-titulo', texto: 'Arquivadas' });

    container.appendChild(el('div', { class: 'tela-simples' }, [
      el('div', { class: 'painel' }, [
        el('div', { class: 'painel-topo' }, [
          el('div', {}, [
            el('h2', { class: 'painel-titulo', texto: 'Tags' }),
            el('p', {
              class: 'painel-sub',
              texto: 'Alimentam o select de tipo de material em todos os cards. A ordem daqui é a ordem que aparece no select.'
            })
          ]),
          Estado.ehAdmin() && el('button', {
            class: 'botao botao-principal', type: 'button',
            onclick: function () { abrirEditor(null); }
          }, ['+ Nova tag'])
        ]),
        refAtivas,
        refTituloArquivadas,
        refArquivadas
      ])
    ]));

    desinscrever = Estado.aoMudar(desenhar);
    desenhar();
  }

  function desmontar() {
    if (desinscrever) desinscrever();
    desinscrever = null;
    refAtivas = null;
    refArquivadas = null;
    refTituloArquivadas = null;
  }

  window.TelaTags = { montar: montar, desmontar: desmontar };
})();
