'use strict';

/**
 * Gerenciamento de usuários. Visível só para admin.
 * Não existe exclusão: usuário desativado perde o acesso mas continua
 * referenciado no histórico de alterações das demandas.
 */
(function () {
  const el = UI.el;

  let refLista = null;

  async function carregar() {
    if (!refLista) return;

    UI.limpar(refLista);
    refLista.appendChild(el('div', { class: 'texto-fraco', texto: 'Carregando…' }));

    try {
      const lista = await window.api.usuarios.listar();
      desenhar(lista);
    } catch (erro) {
      UI.limpar(refLista);
      refLista.appendChild(el('div', { class: 'erro', texto: erro.message }));
    }
  }

  function desenhar(lista) {
    UI.limpar(refLista);

    for (const usuario of lista) {
      const ehEu = Estado.dados.usuario && usuario.id === Estado.dados.usuario.id;

      refLista.appendChild(el('div', {
        class: 'linha-usuario' + (usuario.ativo ? '' : ' linha-usuario-inativo')
      }, [
        el('div', { class: 'usuario-identidade' }, [
          el('span', { class: 'usuario-nome', texto: usuario.usuario }),
          ehEu ? el('span', { class: 'usuario-eu', texto: 'você' }) : null
        ]),

        el('span', {
          class: 'usuario-papel' + (usuario.papel === 'admin' ? ' usuario-papel-admin' : ''),
          texto: usuario.papel === 'admin' ? 'administrador' : 'usuário'
        }),

        el('span', {
          class: 'usuario-situacao',
          texto: usuario.ativo ? 'ativo' : 'desativado'
        }),

        el('div', { class: 'usuario-acoes' }, [
          el('button', {
            class: 'botao botao-pequeno', type: 'button',
            onclick: function () { abrirRedefinicao(usuario); }
          }, ['Redefinir senha']),

          el('button', {
            class: 'botao botao-pequeno', type: 'button',
            disabled: ehEu && usuario.ativo,
            title: ehEu && usuario.ativo ? 'Você não pode desativar o próprio acesso' : '',
            onclick: function () { alternarAtivo(usuario); }
          }, [usuario.ativo ? 'Desativar' : 'Reativar'])
        ])
      ]));
    }

    if (lista.length === 0) {
      refLista.appendChild(UI.vazio('Nenhum usuário cadastrado.'));
    }
  }

  /* ------------------------------------------------------------------ *
   * Criar                                                               *
   * ------------------------------------------------------------------ */

  function abrirCriacao() {
    const nome = UI.entrada({ placeholder: 'nome de acesso, sem espaços' });
    const senha = UI.entrada({ type: 'password', placeholder: 'mínimo de 6 caracteres' });

    const papel = el('select', { class: 'entrada' }, [
      el('option', { value: 'usuario', texto: 'Usuário — vê tudo, altera status e link' }),
      el('option', { value: 'admin', texto: 'Administrador — acesso total' })
    ]);

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      UI.campo('Usuário', nome),
      UI.campo('Senha inicial', senha, 'A pessoa pode trocar depois, pelo menu.'),
      UI.campo('Papel', papel)
    ]);

    let salvando = false;
    const botao = el('button', { class: 'botao botao-principal', type: 'button' }, ['Criar usuário']);

    const modal = UI.abrirModal({
      titulo: 'Novo usuário',
      largura: '480px',
      corpo: formulario,
      rodape: [
        el('button', { class: 'botao', type: 'button', onclick: function () { modal.fechar(); } }, ['Cancelar']),
        botao
      ]
    });

    async function salvar() {
      if (salvando) return;
      salvando = true;
      botao.disabled = true;
      try {
        await window.api.usuarios.criar({
          usuario: nome.value, senha: senha.value, papel: papel.value
        });
        UI.aviso('Usuário criado.');
        modal.fechar();
        carregar();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        salvando = false;
        botao.disabled = false;
      }
    }

    botao.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (e) { e.preventDefault(); salvar(); });
    nome.focus();
  }

  /* ------------------------------------------------------------------ *
   * Redefinir senha e desativar                                         *
   * ------------------------------------------------------------------ */

  function abrirRedefinicao(usuario) {
    const senha = UI.entrada({ type: 'password', placeholder: 'mínimo de 6 caracteres' });

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      el('p', { class: 'texto-fraco', texto: 'Nova senha para ' + usuario.usuario + '.' }),
      UI.campo('Senha', senha)
    ]);

    const botao = el('button', { class: 'botao botao-principal', type: 'button' }, ['Redefinir']);

    const modal = UI.abrirModal({
      titulo: 'Redefinir senha',
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
        await window.api.usuarios.redefinirSenha(usuario.id, senha.value);
        UI.aviso('Senha redefinida.');
        modal.fechar();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        botao.disabled = false;
      }
    }

    botao.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (e) { e.preventDefault(); salvar(); });
    senha.focus();
  }

  async function alternarAtivo(usuario) {
    if (usuario.ativo) {
      const certeza = await UI.confirmar({
        titulo: 'Desativar acesso',
        texto: usuario.usuario + ' perde o acesso imediatamente. O histórico de alterações ' +
               'feitas por essa pessoa continua registrado. Dá para reativar depois.',
        rotuloOk: 'Desativar',
        perigo: true
      });
      if (!certeza) return;
    }

    try {
      await window.api.usuarios.definirAtivo(usuario.id, !usuario.ativo);
      UI.aviso(usuario.ativo ? 'Acesso desativado.' : 'Acesso reativado.');
      carregar();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function montar(container) {
    refLista = el('div', { class: 'lista-usuarios' });

    container.appendChild(el('div', { class: 'tela-simples' }, [
      el('div', { class: 'painel' }, [
        el('div', { class: 'painel-topo' }, [
          el('div', {}, [
            el('h2', { class: 'painel-titulo', texto: 'Usuários' }),
            el('p', {
              class: 'painel-sub',
              texto: 'Administrador faz tudo. Usuário vê tudo e altera apenas o status e o link ' +
                     'das demandas. Não existe exclusão: desative quem sair.'
            })
          ]),
          el('button', {
            class: 'botao botao-principal', type: 'button', onclick: abrirCriacao
          }, ['+ Novo usuário'])
        ]),
        refLista
      ])
    ]));

    carregar();
  }

  function desmontar() {
    refLista = null;
  }

  window.TelaUsuarios = { montar: montar, desmontar: desmontar };
})();
