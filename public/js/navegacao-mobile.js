'use strict';

/**
 * Navegação do celular: barra fixa embaixo e o painel "Mais".
 *
 * Nove abas mais o botão de importar não cabem no topo de um telefone, e uma
 * barra que rola de lado esconde metade das opções atrás de um gesto que
 * ninguém descobre sozinho. As quatro telas de uso diário ficam à vista, o
 * resto entra no "Mais".
 *
 * A barra fica embaixo porque é onde o polegar alcança: o topo de um telefone
 * de seis polegadas exige a segunda mão.
 *
 * Toda a montagem respeita o papel de quem entrou — a aba Usuários e o botão
 * de importar só existem para o admin, do mesmo jeito que no desktop. Esconder
 * aqui é acabamento; quem recusa é o servidor.
 */
(function () {
  const el = UI.el;

  /* As quatro da barra: as telas de todo dia. Na ordem em que se usa. */
  const PRINCIPAIS = [
    { tela: 'dia', rotulo: 'Dia', icone: '■' },
    { tela: 'semanal', rotulo: 'Semana', icone: '▦' },
    { tela: 'mensal', rotulo: 'Mês', icone: '▤' },
    { tela: 'lista', rotulo: 'Lista', icone: '≡' }
  ];

  let refBarra = null;
  let painelAberto = null;

  /* ------------------------------------------------------------------ *
   * Painel "Mais"                                                       *
   * ------------------------------------------------------------------ */

  function fecharPainel() {
    if (!painelAberto) return;
    const fundo = painelAberto;
    painelAberto = null;

    fundo.classList.add('saindo');
    window.setTimeout(function () { fundo.remove(); }, 140);
    document.removeEventListener('keydown', aoTeclar, true);
    marcarAtiva(App.atual());
  }

  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      fecharPainel();
    }
  }

  function itemDoPainel(rotulo, descricao, aoEscolher, opcoes) {
    const config = opcoes || {};

    return el('button', {
      class: 'mais-item' + (config.destaque ? ' mais-item-destaque' : ''),
      type: 'button',
      onclick: function () {
        fecharPainel();
        aoEscolher();
      }
    }, [
      el('span', { class: 'mais-item-rotulo', texto: rotulo }),
      descricao ? el('span', { class: 'mais-item-descricao', texto: descricao }) : null
    ]);
  }

  function abrirPainel() {
    if (painelAberto) { fecharPainel(); return; }

    const usuario = Estado.dados.usuario || {};
    const admin = Estado.ehAdmin();

    const lista = el('div', { class: 'mais-lista' }, [
      itemDoPainel('Dashboard', 'Os números do mês', function () { App.ir('dashboard'); }),
      itemDoPainel('Rotinas', 'O seu checklist do dia', function () { App.ir('rotinas'); }),
      itemDoPainel('Clientes', 'Cadastro e calendário por cliente', function () { App.ir('clientes'); }),

      admin ? itemDoPainel('Usuários', 'Cargos, profissionais e tags',
        function () { App.ir('usuarios'); }) : null,

      admin ? itemDoPainel('Importar calendário', 'Arquivo .json do mês',
        function () { Importar.importar(); }) : null,

      /* sem guarda de papel: exportar é leitura, e quem só lê também precisa
         do roteiro para produzir */
      itemDoPainel('Exportar conteúdos', 'PDF de produção com o roteiro completo',
        function () { ExportarConteudos.abrir(); })
    ]);

    /* A conta fica separada no fim: é o que se procura para sair, e misturar
       com as telas faria procurar entre elas. */
    const conta = el('div', { class: 'mais-conta' }, [
      el('div', { class: 'mais-conta-topo' }, [
        Cartao.avatar(usuario),
        el('div', {}, [
          el('div', { class: 'mais-conta-nome', texto: Cartao.nomeDe(usuario) }),
          el('div', { class: 'texto-fraco mais-conta-cargo', texto:
            (usuario.cargo_nome || 'sem cargo') +
            (usuario.papel === 'admin' ? ' · administrador' : '') })
        ])
      ]),
      el('div', { class: 'mais-conta-acoes' }, [
        el('button', {
          class: 'botao botao-largo', type: 'button',
          onclick: function () { fecharPainel(); Menu.trocarSenha(); }
        }, ['Trocar minha senha']),
        el('button', {
          class: 'botao botao-largo', type: 'button',
          onclick: function () { fecharPainel(); Menu.sair(); }
        }, ['Sair'])
      ])
    ]);

    const folha = el('div', { class: 'mais-folha', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'folha-puxador', 'aria-hidden': 'true' }),
      el('div', { class: 'mais-titulo' }, [
        el('span', { texto: 'Mais' }),
        el('button', {
          class: 'botao-icone', type: 'button', 'aria-label': 'Fechar',
          onclick: fecharPainel
        }, ['×'])
      ]),
      lista,
      conta
    ]);

    const fundo = el('div', { class: 'mais-fundo' }, [folha]);

    fundo.addEventListener('mousedown', function (evento) {
      if (evento.target === fundo) fecharPainel();
    });
    fundo.addEventListener('touchstart', function (evento) {
      if (evento.target === fundo) fecharPainel();
    }, { passive: true });

    UI.fecharAoDeslizar(folha, fecharPainel);

    document.body.appendChild(fundo);
    painelAberto = fundo;
    document.addEventListener('keydown', aoTeclar, true);

    /* o botão Mais fica aceso enquanto o painel está aberto */
    for (const b of refBarra.querySelectorAll('.barra-item')) {
      b.classList.toggle('ativa', b.dataset.acao === 'mais');
    }
  }

  /* ------------------------------------------------------------------ *
   * A barra                                                            *
   * ------------------------------------------------------------------ */

  /** Acende o item da tela atual. Telas do "Mais" acendem o botão Mais. */
  function marcarAtiva(tela) {
    if (!refBarra) return;

    const naBarra = PRINCIPAIS.some(function (p) { return p.tela === tela; });

    for (const botao of refBarra.querySelectorAll('.barra-item')) {
      const alvo = botao.dataset.tela;
      botao.classList.toggle('ativa', alvo === tela || (!naBarra && botao.dataset.acao === 'mais'));
    }
  }

  function montar() {
    refBarra = document.getElementById('barra-inferior');
    if (!refBarra) return;

    UI.limpar(refBarra);

    for (const item of PRINCIPAIS) {
      refBarra.appendChild(el('button', {
        class: 'barra-item',
        type: 'button',
        dados: { tela: item.tela },
        'aria-label': item.rotulo,
        onclick: function () {
          fecharPainel();
          App.ir(item.tela);
        }
      }, [
        el('span', { class: 'barra-item-icone', texto: item.icone, 'aria-hidden': 'true' }),
        el('span', { class: 'barra-item-rotulo', texto: item.rotulo })
      ]));
    }

    refBarra.appendChild(el('button', {
      class: 'barra-item',
      type: 'button',
      dados: { acao: 'mais' },
      'aria-label': 'Mais opções',
      onclick: abrirPainel
    }, [
      el('span', { class: 'barra-item-icone', texto: '⋯', 'aria-hidden': 'true' }),
      el('span', { class: 'barra-item-rotulo', texto: 'Mais' })
    ]));
  }

  window.NavegacaoMobile = {
    montar: montar,
    marcarAtiva: marcarAtiva,
    fecharPainel: fecharPainel,
    /** As telas que ficam na barra; o app usa para escolher a aba inicial. */
    PRINCIPAIS: PRINCIPAIS
  };
})();
