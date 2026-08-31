'use strict';

/**
 * Menu do app, no canto do cabeçalho: conta e sessão.
 * O backup do Electron não existe mais: o banco agora é compartilhado e a
 * cópia de segurança é responsabilidade do Postgres, não do cliente.
 */
(function () {
  const el = UI.el;

  let aberto = null;

  /* ------------------------------------------------------------------ *
   * Trocar a própria senha                                              *
   * ------------------------------------------------------------------ */

  function trocarSenha() {
    const atual = UI.entrada({ type: 'password', placeholder: 'sua senha de hoje' });
    const nova = UI.entrada({ type: 'password', placeholder: 'mínimo de 6 caracteres' });

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      UI.campo('Senha atual', atual),
      UI.campo('Nova senha', nova)
    ]);

    const botao = el('button', { class: 'botao botao-principal', type: 'button' }, ['Trocar senha']);

    const modal = UI.abrirModal({
      titulo: 'Trocar minha senha',
      largura: '420px',
      corpo: formulario,
      rodape: [
        el('button', { class: 'botao', type: 'button', onclick: function () { modal.fechar(); } }, ['Cancelar']),
        botao
      ]
    });

    async function salvar() {
      botao.disabled = true;
      try {
        await window.api.sessao.trocarSenha(atual.value, nova.value);
        UI.aviso('Senha trocada.');
        modal.fechar();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        botao.disabled = false;
      }
    }

    botao.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (e) { e.preventDefault(); salvar(); });
    atual.focus();
  }

  async function sair() {
    try {
      await window.api.sessao.sair();
    } catch (erro) { /* mesmo falhando, o destino é o login */ }
    window.location.href = '/login';
  }

  /* ------------------------------------------------------------------ *
   * Menu suspenso                                                       *
   * ------------------------------------------------------------------ */

  function fechar() {
    if (!aberto) return;
    aberto.remove();
    aberto = null;
    document.removeEventListener('mousedown', aoClicarFora, true);
  }

  function aoClicarFora(evento) {
    if (!aberto) return;
    const alvo = evento.target;
    const dentro = alvo instanceof Node && aberto.contains(alvo);
    const noBotao = alvo instanceof Element && alvo.closest('.menu-botao') !== null;
    if (!dentro && !noBotao) fechar();
  }

  function itemDoMenu(rotulo, descricao, aoEscolher) {
    return el('button', {
      class: 'menu-item', type: 'button',
      onclick: function () { fechar(); aoEscolher(); }
    }, [
      el('span', { class: 'menu-item-rotulo', texto: rotulo }),
      el('span', { class: 'menu-item-descricao', texto: descricao })
    ]);
  }

  function alternar(botao) {
    if (aberto) { fechar(); return; }

    const usuario = Estado.dados.usuario || { usuario: '—', papel: 'usuario' };

    aberto = el('div', { class: 'menu-suspenso' }, [
      el('div', { class: 'menu-conta' }, [
        el('div', { class: 'menu-conta-nome', texto: usuario.usuario }),
        el('div', {
          class: 'menu-conta-papel',
          texto: usuario.papel === 'admin' ? 'administrador' : 'usuário'
        })
      ]),
      itemDoMenu('Trocar minha senha', 'Pede a senha atual antes de mudar.', trocarSenha),
      itemDoMenu('Sair', 'Encerra a sessão neste navegador.', sair)
    ]);

    botao.parentNode.appendChild(aberto);
    document.addEventListener('mousedown', aoClicarFora, true);
  }

  function montar() {
    const caixa = document.getElementById('menu-app');
    if (!caixa) return;

    const botao = el('button', {
      class: 'menu-botao', type: 'button',
      title: 'Conta e sessão', 'aria-label': 'Conta e sessão'
    }, ['⋯']);

    botao.addEventListener('click', function (evento) {
      evento.stopPropagation();
      alternar(botao);
    });

    caixa.appendChild(botao);

    document.addEventListener('keydown', function (evento) {
      if (evento.key === 'Escape') fechar();
    });
  }

  window.Menu = { montar: montar, trocarSenha: trocarSenha, sair: sair };
})();
