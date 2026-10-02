'use strict';

/**
 * O bloco de Acessos da tela de Clientes: o cofre de credenciais.
 *
 * Quem não tem o cargo marcado não vê este bloco — e isso é acabamento, não
 * segurança. Quem barra é o servidor: as rotas respondem 403 mesmo para uma
 * requisição montada na mão. Aqui a tela só evita oferecer o que não existe.
 *
 * A senha nunca chega junto com a lista. Ela vem por uma chamada própria, que
 * registra quem pediu, e some sozinha depois de meio minuto.
 */
(function () {
  const el = UI.el;

  /* Meio minuto é o tempo de ler e digitar em outra aba. Mais que isso vira
     senha esquecida aberta numa tela que alguém deixou no escritório. */
  const SEGUNDOS_VISIVEL = 30;

  /* ------------------------------------------------------------------ *
   * Área de transferência                                               *
   * ------------------------------------------------------------------ */

  /**
   * `navigator.clipboard` exige contexto seguro e permissão, e falha calada em
   * alguns navegadores. A alternativa antiga é feia mas funciona em todos, e
   * aqui ela importa: copiar é o caminho normal de usar uma senha, e falhar em
   * silêncio faria a pessoa colar o que estava antes na área de transferência.
   */
  async function copiar(texto) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        return true;
      }
    } catch (erro) { /* cai para o caminho de baixo */ }

    try {
      const caixa = document.createElement('textarea');
      caixa.value = texto;
      caixa.setAttribute('readonly', '');
      caixa.style.position = 'fixed';
      caixa.style.opacity = '0';
      document.body.appendChild(caixa);
      caixa.select();
      const certo = document.execCommand('copy');
      caixa.remove();
      return certo;
    } catch (erro) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Formulário                                                          *
   * ------------------------------------------------------------------ */

  function abrirEditor(clienteId, acesso, aoSalvar) {
    const editando = Boolean(acesso);

    const campoConta = UI.entrada({
      placeholder: 'Instagram, Meta Ads, Google Meu Negócio…',
      maxlength: 80
    });
    const campoLogin = UI.entrada({
      placeholder: 'usuário, email ou telefone',
      maxlength: 200,
      autocomplete: 'off'
    });

    /*
     * type="password" com autocomplete="new-password" é o par que desliga as
     * duas coisas erradas que o navegador faria aqui: oferecer para salvar a
     * senha do cliente no cofre pessoal de quem digitou, e autopreencher com
     * uma credencial de outro contexto — que acabaria gravada como senha do
     * cliente sem ninguém notar.
     */
    const campoSenha = UI.entrada({
      type: 'password',
      autocomplete: 'new-password',
      placeholder: editando ? 'deixe em branco para manter a atual' : 'a senha da conta'
    });

    const campoObs = UI.areaTexto({
      placeholder: '2FA no celular do dono, acesso via BM da agência…',
      maxlength: 500,
      rows: 3
    });

    if (editando) {
      campoConta.value = acesso.conta;
      campoLogin.value = acesso.login;
      campoObs.value = acesso.observacoes || '';
    }

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      UI.campo('Conta', campoConta, 'o que é este acesso'),
      UI.campo('Acesso', campoLogin, 'o login: usuário, email ou telefone'),
      UI.campo('Senha', campoSenha,
        editando ? 'em branco mantém a senha que já está guardada' : null),
      UI.campo('Observações', campoObs, 'opcional')
    ]);

    const botao = el('button', { class: 'botao botao-principal', type: 'button' },
      [editando ? 'Salvar' : 'Adicionar']);

    const modal = UI.abrirModal({
      titulo: editando ? 'Editar acesso' : 'Novo acesso',
      largura: '480px',
      corpo: formulario,
      rodape: [
        el('button', {
          class: 'botao', type: 'button', onclick: function () { modal.fechar(); }
        }, ['Cancelar']),
        botao
      ]
    });

    async function salvar() {
      const dados = {
        conta: campoConta.value,
        login: campoLogin.value,
        senha: campoSenha.value,
        observacoes: campoObs.value
      };

      if (!editando && dados.senha.trim() === '') {
        UI.aviso('A senha é obrigatória.', 'erro');
        campoSenha.focus();
        return;
      }

      botao.disabled = true;
      try {
        if (editando) await window.api.acessos.atualizar(acesso.id, dados);
        else await window.api.acessos.criar(clienteId, dados);

        /* o campo é zerado na mão: o navegador guarda o valor do input se o
           nó só for removido do DOM, e senha de cliente não fica em memória
           de formulário mais do que o necessário */
        campoSenha.value = '';
        modal.fechar();
        UI.aviso(editando ? 'Acesso atualizado.' : 'Acesso adicionado.');
        aoSalvar();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        botao.disabled = false;
      }
    }

    botao.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (evento) {
      evento.preventDefault();
      salvar();
    });
  }

  /* ------------------------------------------------------------------ *
   * Uma linha                                                           *
   * ------------------------------------------------------------------ */

  function quando(iso) {
    if (!iso) return '';
    const data = new Date(iso);
    const dias = Math.floor((Date.now() - data.getTime()) / 86400000);
    if (dias <= 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return 'há ' + dias + ' dias';
    return 'em ' + Datas.curta(Datas.paraTexto(data));
  }

  function botaoCopiar(titulo, obter) {
    const botao = el('button', {
      class: 'botao-icone ac-icone', type: 'button', title: titulo, 'aria-label': titulo
    }, ['⧉']);

    botao.addEventListener('click', async function () {
      botao.disabled = true;
      try {
        const texto = await obter();
        if (texto === null) return;
        const certo = await copiar(texto);
        UI.aviso(certo ? 'Copiado.' : 'O navegador não deixou copiar. Revele e copie à mão.',
          certo ? undefined : 'erro');
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
      } finally {
        botao.disabled = false;
      }
    });

    return botao;
  }

  function linhaDoAcesso(acesso, contexto) {
    const valorSenha = el('span', { class: 'ac-senha-valor', texto: '••••••••••' });
    const contador = el('span', { class: 'ac-contador' });

    let relogio = null;
    let temporizador = null;

    function esconder() {
      window.clearInterval(relogio);
      window.clearTimeout(temporizador);
      relogio = null;
      temporizador = null;
      valorSenha.textContent = '••••••••••';
      valorSenha.classList.remove('ac-senha-aberta');
      contador.textContent = '';
      olho.textContent = '👁';
      olho.title = 'Revelar a senha';
    }

    /* some sozinha se a tela for trocada com a senha aberta */
    contexto.aoDesmontar(esconder);

    const olho = el('button', {
      class: 'botao-icone ac-icone', type: 'button',
      title: 'Revelar a senha', 'aria-label': 'Revelar a senha'
    }, ['👁']);

    olho.addEventListener('click', async function () {
      if (relogio) { esconder(); return; }

      olho.disabled = true;
      try {
        const r = await window.api.acessos.revelar(acesso.id, 'revelou');
        valorSenha.textContent = r.senha;
        valorSenha.classList.add('ac-senha-aberta');
        olho.textContent = '🙈';
        olho.title = 'Esconder agora';

        let restam = SEGUNDOS_VISIVEL;
        contador.textContent = restam + 's';
        relogio = window.setInterval(function () {
          restam -= 1;
          contador.textContent = restam + 's';
        }, 1000);
        temporizador = window.setTimeout(esconder, SEGUNDOS_VISIVEL * 1000);

        contexto.recarregarHistorico();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
      } finally {
        olho.disabled = false;
      }
    });

    const acoes = [
      el('button', {
        class: 'botao botao-pequeno', type: 'button',
        onclick: function () {
          abrirEditor(acesso.cliente_id, acesso, contexto.recarregar);
        }
      }, ['Editar']),
      el('button', {
        class: 'botao botao-pequeno botao-perigo', type: 'button',
        onclick: async function () {
          const certeza = await UI.confirmar({
            titulo: 'Excluir acesso',
            texto: 'O acesso "' + acesso.conta + '" (' + acesso.login + ') sai do cofre, ' +
                   'com a senha guardada. Isto não tem volta.',
            rotuloOk: 'Excluir'
          });
          if (!certeza) return;
          try {
            await window.api.acessos.excluir(acesso.id);
            UI.aviso('Acesso excluído.');
            contexto.recarregar();
          } catch (erro) {
            UI.aviso(erro.message, 'erro');
          }
        }
      }, ['Excluir'])
    ];

    const setas = el('div', { class: 'ac-setas' }, [
      el('button', {
        class: 'botao-icone ac-seta', type: 'button', title: 'Subir', 'aria-label': 'Subir',
        disabled: contexto.primeiro, onclick: function () { contexto.mover(acesso.id, -1); }
      }, ['↑']),
      el('button', {
        class: 'botao-icone ac-seta', type: 'button', title: 'Descer', 'aria-label': 'Descer',
        disabled: contexto.ultimo, onclick: function () { contexto.mover(acesso.id, 1); }
      }, ['↓'])
    ]);

    const linha = el('div', { class: 'ac-linha', 'data-id': String(acesso.id) }, [
      el('div', { class: 'ac-principal' }, [
        el('div', { class: 'ac-conta', texto: acesso.conta }),

        el('div', { class: 'ac-campo' }, [
          el('span', { class: 'ac-rotulo', texto: 'Acesso' }),
          el('span', { class: 'ac-login', texto: acesso.login }),
          botaoCopiar('Copiar o login', function () { return acesso.login; })
        ]),

        el('div', { class: 'ac-campo' }, [
          el('span', { class: 'ac-rotulo', texto: 'Senha' }),
          valorSenha,
          olho,
          /* copiar passa pela mesma rota de revelar: a senha não está aqui,
             e a cópia tem de ficar registrada igual */
          botaoCopiar('Copiar a senha', async function () {
            const r = await window.api.acessos.revelar(acesso.id, 'copiou');
            contexto.recarregarHistorico();
            return r.senha;
          }),
          contador
        ]),

        acesso.observacoes
          ? el('div', { class: 'ac-obs', texto: acesso.observacoes })
          : null,

        el('div', { class: 'ac-marca texto-fraco', texto:
          acesso.atualizado_por_nome
            ? 'atualizado por ' + acesso.atualizado_por_nome + ' ' + quando(acesso.atualizado_em)
            : 'atualizado ' + quando(acesso.atualizado_em) })
      ]),

      el('div', { class: 'ac-acoes' }, [setas, el('div', { class: 'ac-botoes' }, acoes)])
    ]);

    return linha;
  }

  /* ------------------------------------------------------------------ *
   * O bloco                                                             *
   * ------------------------------------------------------------------ */

  function montarBloco(cliente, alvo) {
    /* sem permissão o bloco simplesmente não existe — nem vazio, nem com
       cadeado: um cadeado é um convite a perguntar de quem é a chave */
    if (!Estado.podeCredenciais()) return null;

    const lista = el('div', { class: 'ac-lista' });
    const historico = el('div', { class: 'ac-historico' });
    const aoDesmontarFns = [];

    const botaoNovo = el('button', {
      class: 'botao botao-pequeno', type: 'button',
      onclick: function () { abrirEditor(cliente.id, null, carregar); }
    }, ['+ Novo acesso']);

    const bloco = el('section', { class: 'painel bloco-acessos' }, [
      el('div', { class: 'bloco-acessos-topo' }, [
        el('div', {}, [
          el('h3', { class: 'bloco-titulo', texto: 'Acessos' }),
          el('div', { class: 'texto-fraco bloco-sub', texto:
            'As contas deste cliente que a agência opera.' })
        ]),
        botaoNovo
      ]),
      lista,
      historico
    ]);

    const contexto = {
      aoDesmontar: function (fn) { aoDesmontarFns.push(fn); },
      recarregar: carregar,
      recarregarHistorico: carregarHistorico,
      mover: mover
    };

    let atual = [];

    async function mover(id, direcao) {
      const ids = atual.map(function (a) { return a.id; });
      const i = ids.indexOf(id);
      const j = i + direcao;
      if (i < 0 || j < 0 || j >= ids.length) return;

      ids.splice(j, 0, ids.splice(i, 1)[0]);
      try {
        await window.api.acessos.reordenar(cliente.id, ids);
        carregar();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
      }
    }

    function limparPendentes() {
      for (const fn of aoDesmontarFns.splice(0)) fn();
    }

    async function carregar() {
      limparPendentes();
      UI.limpar(lista);
      lista.appendChild(el('div', { class: 'texto-fraco', texto: 'Carregando…' }));

      let resposta;
      try {
        resposta = await window.api.acessos.listar(cliente.id);
      } catch (erro) {
        UI.limpar(lista);
        lista.appendChild(el('div', { class: 'erro', texto: erro.message }));
        return;
      }

      atual = resposta.acessos || [];
      UI.limpar(lista);

      /*
       * Cofre fechado é um estado à parte de cofre vazio.
       *
       * Sem a chave no ambiente, as senhas que estão no banco continuam lá e
       * continuam ilegíveis. Dizer "nenhum acesso cadastrado" nessa situação
       * faria alguém cadastrar tudo de novo.
       */
      const fechado = resposta.cofre && !resposta.cofre.disponivel;
      botaoNovo.disabled = fechado;

      if (fechado) {
        lista.appendChild(el('div', { class: 'ac-fechado' }, [
          el('strong', { texto: 'O cofre está indisponível.' }),
          el('div', { texto: resposta.cofre.motivo + '. Enquanto isso, nenhuma senha pode ' +
                             'ser lida nem gravada. As que já estão guardadas continuam ' +
                             'no banco, intactas.' })
        ]));
      }

      if (atual.length === 0) {
        if (!fechado) {
          lista.appendChild(el('div', { class: 'texto-fraco ac-vazio', texto:
            'Nenhum acesso cadastrado. Use "+ Novo acesso" para guardar a primeira conta.' }));
        }
        UI.limpar(historico);
        return;
      }

      atual.forEach(function (acesso, i) {
        lista.appendChild(linhaDoAcesso(acesso, Object.assign({}, contexto, {
          primeiro: i === 0,
          ultimo: i === atual.length - 1
        })));
      });

      /* arrastar no desktop, setas em todo lugar: no toque o arrasto briga
         com a rolagem do dedo, e as setas continuam funcionando lá */
      if (!Dispositivo.ehToque() && window.Arrastar) ligarArrasto();

      carregarHistorico();
    }

    function ligarArrasto() {
      const linhas = Array.from(lista.querySelectorAll('.ac-linha'));

      for (const linha of linhas) {
        linha.setAttribute('draggable', 'true');

        linha.addEventListener('dragstart', function (evento) {
          evento.dataTransfer.setData('text/plain', linha.dataset.id);
          linha.classList.add('ac-arrastando');
        });

        linha.addEventListener('dragend', function () {
          linha.classList.remove('ac-arrastando');
        });

        linha.addEventListener('dragover', function (evento) { evento.preventDefault(); });

        linha.addEventListener('drop', async function (evento) {
          evento.preventDefault();
          const arrastado = Number(evento.dataTransfer.getData('text/plain'));
          const destino = Number(linha.dataset.id);
          if (!arrastado || arrastado === destino) return;

          const ids = atual.map(function (a) { return a.id; });
          const de = ids.indexOf(arrastado);
          const para = ids.indexOf(destino);
          if (de < 0 || para < 0) return;

          ids.splice(para, 0, ids.splice(de, 1)[0]);
          try {
            await window.api.acessos.reordenar(cliente.id, ids);
            carregar();
          } catch (erro) {
            UI.aviso(erro.message, 'erro');
          }
        });
      }
    }

    async function carregarHistorico() {
      UI.limpar(historico);
      if (!Estado.ehAdmin()) return;

      let consultas;
      try {
        consultas = await window.api.acessos.consultas(cliente.id);
      } catch (erro) {
        return;   /* histórico é acessório: falhar nele não estraga o bloco */
      }

      if (!consultas || consultas.length === 0) return;

      historico.appendChild(el('div', { class: 'ac-historico-titulo texto-fraco',
        texto: 'Quem consultou' }));

      const ultimas = consultas.slice(0, 6);
      for (const c of ultimas) {
        historico.appendChild(el('div', { class: 'ac-historico-linha texto-fraco', texto:
          c.usuario_nome + ' ' + c.acao + ' ' + c.conta + ' ' + quando(c.criado_em) }));
      }
    }

    alvo.appendChild(bloco);
    carregar();

    return { recarregar: carregar, desmontar: limparPendentes };
  }

  window.Acessos = { montarBloco: montarBloco };
})();
