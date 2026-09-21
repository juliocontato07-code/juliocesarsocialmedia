'use strict';

/**
 * Tela de Usuários: concentra Cargos, Profissionais e Tags. Só admin.
 *
 * Os três estão juntos porque juntos é que a cadeia de atribuição se lê de
 * ponta a ponta: a tag aponta para um cargo, o cargo tem pessoas, e as pessoas
 * recebem as demandas daquela tag. Configurar isso em três telas diferentes
 * obrigava a guardar metade da regra na cabeça.
 *
 * Alinhamento: cada bloco é um grid com colunas de largura fixa, iguais em
 * todas as linhas, e as ações sempre na última coluna, à direita. Chip de
 * cargo e de permissão não truncam — a coluna é dimensionada pelo maior nome
 * cadastrado, e não o contrário.
 *
 * Não existe exclusão em nenhum dos três: desativa-se. Usuário desativado
 * continua referenciado no histórico das demandas, cargo desativado continua
 * sendo o cargo das demandas antigas, e tag arquivada continua classificando o
 * que já foi publicado.
 */
(function () {
  const el = UI.el;

  let refCargos = null;
  let refPessoas = null;
  let refTags = null;
  let refMutirao = null;

  let cargos = [];
  let pessoas = [];
  let listaTags = [];
  let pessoasPorTag = {};

  /* ------------------------------------------------------------------ *
   * Carregamento                                                        *
   * ------------------------------------------------------------------ */

  async function carregar() {
    try {
      const [c, p, t] = await Promise.all([
        window.api.cargos.listar({ incluirInativos: true }),
        window.api.usuarios.listar(),
        window.api.tags.listar({ incluirArquivadas: true })
      ]);

      cargos = c;
      pessoas = p;
      listaTags = t;

      /* quem cada tag atribuiria hoje: uma ida por tag, em paralelo */
      const respostas = await Promise.all(listaTags.map(function (tag) {
        return tag.cargo_id
          ? window.api.tags.pessoas(tag.id).catch(function () { return []; })
          : Promise.resolve([]);
      }));

      pessoasPorTag = {};
      listaTags.forEach(function (tag, i) { pessoasPorTag[tag.id] = respostas[i]; });

      desenharCargos();
      desenharPessoas();
      desenharTags();
      atualizarMutirao();
    } catch (erro) {
      for (const alvo of [refCargos, refPessoas, refTags]) {
        if (!alvo) continue;
        UI.limpar(alvo);
        alvo.appendChild(el('div', { class: 'erro', texto: erro.message }));
      }
    }
  }

  /** Recarrega tudo, inclusive o cache global: cargo novo entra nos seletores. */
  async function recarregarTudo() {
    await Estado.recarregar();
    await carregar();
    Estado.demandasMudaram();
  }

  /* ------------------------------------------------------------------ *
   * Peças da grade                                                      *
   * ------------------------------------------------------------------ */

  /** Cabeçalho e linhas usam a mesma classe de grid, então as colunas batem. */
  function cabecalho(classe, colunas) {
    return el('div', { class: 'grade-linha grade-cabecalho ' + classe },
      colunas.map(function (c) {
        return el('span', { class: c.classe || null, texto: c.rotulo });
      }));
  }

  function acoes(botoes) {
    return el('div', { class: 'grade-acoes' }, botoes.filter(Boolean));
  }

  function botao(rotulo, aoClicar, opcoes) {
    const o = opcoes || {};
    return el('button', {
      class: 'botao botao-pequeno' + (o.perigo ? ' botao-perigo' : ''),
      type: 'button',
      disabled: o.desabilitado || false,
      title: o.titulo || '',
      onclick: aoClicar
    }, [rotulo]);
  }

  function chip(texto, classe) {
    return el('span', { class: 'chip-fixo ' + (classe || ''), texto: texto });
  }

  /* ------------------------------------------------------------------ *
   * Bloco 1: Cargos                                                     *
   * ------------------------------------------------------------------ */

  const COLUNAS_CARGO = [
    { rotulo: 'Cargo' },
    { rotulo: 'Pessoas', classe: 'coluna-numero' },
    { rotulo: 'Tags', classe: 'coluna-numero' },
    { rotulo: 'Acesso' },
    { rotulo: 'Situação' },
    { rotulo: '', classe: 'grade-acoes-cabecalho' }
  ];

  function desenharCargos() {
    UI.limpar(refCargos);
    refCargos.appendChild(cabecalho('grade-cargos', COLUNAS_CARGO));

    if (cargos.length === 0) {
      refCargos.appendChild(UI.vazio('Nenhum cargo cadastrado.'));
      return;
    }

    for (const cargo of cargos) {
      refCargos.appendChild(el('div', {
        class: 'grade-linha grade-cargos' + (cargo.ativo ? '' : ' linha-inativa')
      }, [
        el('span', { class: 'grade-nome', texto: cargo.nome }),
        el('span', { class: 'coluna-numero', texto: String(cargo.pessoas) }),
        el('span', { class: 'coluna-numero', texto: String(cargo.tags) }),
        cargo.somente_leitura
          ? chip('somente leitura', 'chip-leitura-marca')
          : chip('edita', 'chip-neutro'),
        chip(cargo.ativo ? 'ativo' : 'desativado', cargo.ativo ? 'chip-ativo' : 'chip-inativo'),
        acoes([
          botao('Editar', function () { abrirCargo(cargo); }),
          botao(cargo.ativo ? 'Desativar' : 'Reativar', function () { alternarCargo(cargo); })
        ])
      ]));
    }
  }

  function abrirCargo(cargo) {
    const editando = Boolean(cargo);

    const nome = UI.entrada({
      value: editando ? cargo.nome : '',
      placeholder: 'ex.: Redator'
    });

    const somenteLeitura = el('input', { type: 'checkbox' });
    somenteLeitura.checked = editando ? Boolean(cargo.somente_leitura) : false;

    const aviso = el('p', { class: 'campo-dica aviso-inline' });

    function atualizarAviso() {
      const virando = somenteLeitura.checked && editando && !cargo.somente_leitura;
      aviso.textContent = virando && cargo.pessoas > 0
        ? 'As ' + cargo.pessoas + ' pessoa(s) deste cargo passam a ser somente leitura e ' +
          'saem das demandas em que são responsáveis.'
        : '';
    }

    somenteLeitura.addEventListener('change', atualizarAviso);

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      UI.campo('Nome do cargo', nome),
      el('label', { class: 'campo-marca' }, [
        somenteLeitura,
        el('span', {}, [
          el('span', { class: 'campo-marca-titulo', texto: 'Somente leitura' }),
          el('span', {
            class: 'campo-dica',
            texto: 'Vê tudo, não altera nada e nunca é atribuído como responsável. ' +
                   'Vale mesmo para quem tem permissão de administrador.'
          })
        ])
      ]),
      aviso
    ]);

    let salvando = false;
    const confirmar = el('button', { class: 'botao botao-principal', type: 'button' },
      [editando ? 'Salvar' : 'Criar cargo']);

    const modal = UI.abrirModal({
      titulo: editando ? 'Editar cargo' : 'Novo cargo',
      largura: '480px',
      corpo: formulario,
      rodape: [
        el('button', { class: 'botao', type: 'button', onclick: function () { modal.fechar(); } }, ['Cancelar']),
        confirmar
      ]
    });

    async function salvar() {
      if (salvando) return;
      salvando = true;
      confirmar.disabled = true;
      try {
        const dados = { nome: nome.value, somente_leitura: somenteLeitura.checked };
        const salvo = editando
          ? await window.api.cargos.atualizar(cargo.id, dados)
          : await window.api.cargos.criar(dados);

        UI.aviso(salvo.atribuicoes_liberadas
          ? 'Salvo. ' + salvo.atribuicoes_liberadas + ' atribuição(ões) foram removidas.'
          : (editando ? 'Cargo salvo.' : 'Cargo criado.'));

        modal.fechar();
        recarregarTudo();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        salvando = false;
        confirmar.disabled = false;
      }
    }

    confirmar.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (e) { e.preventDefault(); salvar(); });
    nome.focus();
  }

  async function alternarCargo(cargo) {
    if (cargo.ativo) {
      const certeza = await UI.confirmar({
        titulo: 'Desativar cargo',
        texto: 'O cargo "' + cargo.nome + '" deixa de aparecer nos cadastros. ' +
               'As demandas já atribuídas não mudam. Dá para reativar depois.',
        rotuloOk: 'Desativar',
        perigo: true
      });
      if (!certeza) return;
    }

    try {
      await window.api.cargos.definirAtivo(cargo.id, !cargo.ativo);
      UI.aviso(cargo.ativo ? 'Cargo desativado.' : 'Cargo reativado.');
      recarregarTudo();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  /* ------------------------------------------------------------------ *
   * Bloco 2: Profissionais                                              *
   * ------------------------------------------------------------------ */

  const COLUNAS_PESSOA = [
    { rotulo: 'Pessoa' },
    { rotulo: 'Login' },
    { rotulo: 'Cargo' },
    { rotulo: 'Permissão' },
    { rotulo: 'Situação' },
    { rotulo: '', classe: 'grade-acoes-cabecalho' }
  ];

  function desenharPessoas() {
    UI.limpar(refPessoas);
    refPessoas.appendChild(cabecalho('grade-pessoas', COLUNAS_PESSOA));

    if (pessoas.length === 0) {
      refPessoas.appendChild(UI.vazio('Nenhum usuário cadastrado.'));
      return;
    }

    for (const pessoa of pessoas) {
      const ehEu = Estado.dados.usuario && pessoa.id === Estado.dados.usuario.id;

      refPessoas.appendChild(el('div', {
        class: 'grade-linha grade-pessoas' + (pessoa.ativo ? '' : ' linha-inativa')
      }, [
        el('span', { class: 'grade-nome celula-pessoa' }, [
          Cartao.avatar(pessoa, { pequeno: true }),
          el('span', { class: 'grade-nome-texto', texto: Cartao.nomeDe(pessoa) }),
          ehEu ? el('span', { class: 'usuario-eu', texto: 'você' }) : null
        ]),
        el('span', { class: 'texto-fraco grade-login', texto: pessoa.usuario }),
        pessoa.cargo_nome
          ? chip(pessoa.cargo_nome, pessoa.cargo_somente_leitura ? 'chip-leitura-marca' : 'chip-neutro')
          : chip('sem cargo', 'chip-vazio'),
        chip(pessoa.papel === 'admin' ? 'administrador' : 'usuário',
          pessoa.papel === 'admin' ? 'chip-admin' : 'chip-neutro'),
        chip(pessoa.ativo ? 'ativo' : 'desativado', pessoa.ativo ? 'chip-ativo' : 'chip-inativo'),
        acoes([
          botao('Editar', function () { abrirPessoa(pessoa); }),
          botao('Senha', function () { abrirRedefinicao(pessoa); }),
          botao(pessoa.ativo ? 'Desativar' : 'Reativar', function () { alternarAtivo(pessoa); }, {
            desabilitado: ehEu && pessoa.ativo,
            titulo: ehEu && pessoa.ativo ? 'Você não pode desativar o próprio acesso' : ''
          })
        ])
      ]));
    }
  }

  function seletorCargo(atualId) {
    const ativos = cargos.filter(function (c) { return c.ativo; });

    return el('select', { class: 'entrada' }, ativos.map(function (c) {
      return el('option', {
        value: String(c.id),
        selected: c.id === Number(atualId),
        texto: c.nome + (c.somente_leitura ? ' — somente leitura' : '')
      });
    }));
  }

  function seletorPapel(atual) {
    return el('select', { class: 'entrada' }, [
      el('option', {
        value: 'usuario', selected: atual === 'usuario',
        texto: 'Usuário — vê tudo, altera status e link'
      }),
      el('option', {
        value: 'admin', selected: atual === 'admin',
        texto: 'Administrador — acesso total'
      })
    ]);
  }

  /** Sem `pessoa`, cria. Com, edita nome, papel e cargo (não a senha). */
  function abrirPessoa(pessoa) {
    const editando = Boolean(pessoa);

    const nomeCompleto = UI.entrada({
      value: editando ? (pessoa.nome_completo || '') : '',
      placeholder: 'Júlio César de Oliveira'
    });

    const login = UI.entrada({
      value: editando ? pessoa.usuario : '',
      placeholder: 'nome de acesso, sem espaços',
      disabled: editando || false
    });
    if (editando) login.classList.add('somente-leitura');

    const senha = editando ? null : UI.entrada({
      type: 'password', placeholder: 'mínimo de 6 caracteres'
    });

    const papel = seletorPapel(editando ? pessoa.papel : 'usuario');
    const cargo = seletorCargo(editando ? pessoa.cargo_id : null);

    const aviso = el('p', { class: 'campo-dica aviso-inline' });

    function atualizarAviso() {
      const escolhido = cargos.find(function (c) { return c.id === Number(cargo.value); });
      const virando = escolhido && escolhido.somente_leitura &&
        (!editando || !pessoa.cargo_somente_leitura);

      aviso.textContent = virando
        ? 'Cargo somente leitura: ' + (editando ? Cartao.nomeDe(pessoa) : 'a pessoa') +
          ' vê tudo, não altera nada e sai das demandas em que é responsável.'
        : '';
    }

    cargo.addEventListener('change', atualizarAviso);
    atualizarAviso();

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      UI.campo('Nome completo', nomeCompleto,
        'Usado na interface e nas iniciais. Vazio: aparece o login.'),
      UI.campo('Login', login, editando ? 'O login não muda.' : 'É com isto que a pessoa entra.'),
      senha ? UI.campo('Senha inicial', senha, 'A pessoa pode trocar depois, pelo menu.') : null,
      el('div', { class: 'formulario-par' }, [
        UI.campo('Permissão', papel),
        UI.campo('Cargo', cargo)
      ]),
      aviso
    ]);

    let salvando = false;
    const confirmar = el('button', { class: 'botao botao-principal', type: 'button' },
      [editando ? 'Salvar' : 'Criar usuário']);

    const modal = UI.abrirModal({
      titulo: editando ? 'Editar pessoa' : 'Nova pessoa',
      largura: '520px',
      corpo: formulario,
      rodape: [
        el('button', { class: 'botao', type: 'button', onclick: function () { modal.fechar(); } }, ['Cancelar']),
        confirmar
      ]
    });

    async function salvar() {
      if (salvando) return;
      salvando = true;
      confirmar.disabled = true;

      try {
        const dados = {
          nome_completo: nomeCompleto.value,
          papel: papel.value,
          cargo_id: Number(cargo.value)
        };

        let salvo;
        if (editando) {
          salvo = await window.api.usuarios.atualizar(pessoa.id, dados);
        } else {
          dados.usuario = login.value;
          dados.senha = senha.value;
          salvo = await window.api.usuarios.criar(dados);
        }

        UI.aviso(salvo.demandas_liberadas
          ? 'Salvo. ' + salvo.demandas_liberadas + ' atribuição(ões) foram removidas.'
          : (editando ? 'Pessoa salva.' : 'Pessoa criada.'));

        modal.fechar();
        await recarregarTudo();

        /* o próprio cargo mudando muda a interface inteira desta pessoa */
        if (editando && pessoa.id === Estado.dados.usuario.id) {
          UI.aviso('Você mudou o seu próprio acesso. A tela já está atualizada.');
        }
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        salvando = false;
        confirmar.disabled = false;
      }
    }

    confirmar.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (e) { e.preventDefault(); salvar(); });
    nomeCompleto.focus();
  }

  function abrirRedefinicao(pessoa) {
    const senha = UI.entrada({ type: 'password', placeholder: 'mínimo de 6 caracteres' });

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      el('p', { class: 'texto-fraco', texto: 'Nova senha para ' + Cartao.nomeDe(pessoa) + '.' }),
      UI.campo('Senha', senha)
    ]);

    const confirmar = el('button', { class: 'botao botao-principal', type: 'button' }, ['Redefinir']);

    const modal = UI.abrirModal({
      titulo: 'Redefinir senha',
      largura: '420px',
      corpo: formulario,
      rodape: [
        el('button', { class: 'botao', type: 'button', onclick: function () { modal.fechar(); } }, ['Cancelar']),
        confirmar
      ]
    });

    async function salvar() {
      confirmar.disabled = true;
      try {
        await window.api.usuarios.redefinirSenha(pessoa.id, senha.value);
        UI.aviso('Senha redefinida.');
        modal.fechar();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        confirmar.disabled = false;
      }
    }

    confirmar.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (e) { e.preventDefault(); salvar(); });
    senha.focus();
  }

  async function alternarAtivo(pessoa) {
    if (pessoa.ativo) {
      const certeza = await UI.confirmar({
        titulo: 'Desativar acesso',
        texto: Cartao.nomeDe(pessoa) + ' perde o acesso imediatamente. O histórico de ' +
               'alterações continua registrado. Dá para reativar depois.',
        rotuloOk: 'Desativar',
        perigo: true
      });
      if (!certeza) return;
    }

    try {
      await window.api.usuarios.definirAtivo(pessoa.id, !pessoa.ativo);
      UI.aviso(pessoa.ativo ? 'Acesso desativado.' : 'Acesso reativado.');
      recarregarTudo();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  /* ------------------------------------------------------------------ *
   * Bloco 3: Tags                                                       *
   * ------------------------------------------------------------------ */

  const COLUNAS_TAG = [
    { rotulo: 'Tag' },
    { rotulo: 'Cargo responsável' },
    { rotulo: 'Quem recebe hoje' },
    { rotulo: 'Situação' },
    { rotulo: '', classe: 'grade-acoes-cabecalho' }
  ];

  function desenharTags() {
    UI.limpar(refTags);
    refTags.appendChild(cabecalho('grade-tags', COLUNAS_TAG));

    if (listaTags.length === 0) {
      refTags.appendChild(UI.vazio('Nenhuma tag cadastrada.'));
      return;
    }

    const ativas = listaTags.filter(function (t) { return !t.arquivada; });

    listaTags.forEach(function (tag, indice) {
      const recebem = pessoasPorTag[tag.id] || [];
      const posicao = ativas.indexOf(tag);

      refTags.appendChild(el('div', {
        class: 'grade-linha grade-tags' + (tag.arquivada ? ' linha-inativa' : '')
      }, [
        el('span', { class: 'grade-nome' }, [Cartao.pilulaTag(tag.nome, tag.cor)]),

        tag.cargo_id
          ? chip(tag.cargo_nome, tag.cargo_ativo ? 'chip-neutro' : 'chip-inativo')
          : chip('sem cargo', 'chip-vazio'),

        /* Isto é a cadeia inteira visível numa célula: a tag aponta para um
           cargo, e estas são as pessoas daquele cargo agora. */
        recebem.length === 0
          ? el('span', {
              class: 'texto-fraco',
              title: tag.cargo_id
                ? 'O cargo não tem ninguém ativo'
                : 'Sem cargo configurado: a demanda nasce sem responsável',
              texto: 'ninguém'
            })
          : el('span', {
              class: 'pilha-avatares' + (recebem.length > 2 ? ' pilha-junta' : ''),
              title: recebem.map(Cartao.nomeDe).join(', ')
            }, recebem.map(function (p) { return Cartao.avatar(p, { pequeno: true }); })),

        chip(tag.arquivada ? 'arquivada' : 'ativa', tag.arquivada ? 'chip-inativo' : 'chip-ativo'),

        acoes([
          !tag.arquivada && posicao > 0
            ? botao('↑', function () { mover(tag, -1); }, { titulo: 'Subir' })
            : null,
          !tag.arquivada && posicao > -1 && posicao < ativas.length - 1
            ? botao('↓', function () { mover(tag, 1); }, { titulo: 'Descer' })
            : null,
          botao('Editar', function () { abrirTag(tag); }),
          botao(tag.arquivada ? 'Desarquivar' : 'Arquivar', function () { alternarTag(tag); })
        ])
      ]));
    });
  }

  async function mover(tag, passo) {
    const ativas = listaTags.filter(function (t) { return !t.arquivada; });
    const de = ativas.indexOf(tag);
    const para = de + passo;
    if (de < 0 || para < 0 || para >= ativas.length) return;

    const ids = ativas.map(function (t) { return t.id; });
    ids.splice(para, 0, ids.splice(de, 1)[0]);

    try {
      await window.api.tags.reordenar(ids);
      recarregarTudo();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  function abrirTag(tag) {
    const editando = Boolean(tag);

    const nome = UI.entrada({
      value: editando ? tag.nome : '',
      placeholder: 'ex.: Carrossel'
    });

    const cor = el('input', {
      class: 'entrada entrada-cor', type: 'color',
      value: editando ? tag.cor : '#9A9A9A'
    });

    const ativos = cargos.filter(function (c) { return c.ativo && !c.somente_leitura; });

    const cargo = el('select', { class: 'entrada' }, [
      el('option', { value: '', selected: !editando || !tag.cargo_id, texto: 'Sem cargo — ninguém é atribuído' })
    ].concat(ativos.map(function (c) {
      return el('option', {
        value: String(c.id),
        selected: editando && c.id === tag.cargo_id,
        texto: c.nome + ' (' + c.pessoas + ' pessoa' + (c.pessoas === 1 ? '' : 's') + ')'
      });
    })));

    const previa = el('p', { class: 'campo-dica' });

    function atualizarPrevia() {
      if (cargo.value === '') {
        previa.textContent = 'Demandas desta tag nascem sem responsável.';
        return;
      }
      const escolhido = cargos.find(function (c) { return c.id === Number(cargo.value); });
      previa.textContent = escolhido && escolhido.pessoas > 0
        ? 'Demandas novas desta tag vão para as ' + escolhido.pessoas +
          ' pessoa(s) ativas em ' + escolhido.nome + '.'
        : 'Este cargo não tem ninguém ativo: as demandas nascem sem responsável.';
    }

    cargo.addEventListener('change', atualizarPrevia);
    atualizarPrevia();

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      el('div', { class: 'formulario-par' }, [
        UI.campo('Nome', nome),
        UI.campo('Cor', cor)
      ]),
      UI.campo('Cargo responsável', cargo,
        'Quem executa o que tem esta tag. A atribuição é resolvida na criação da demanda.'),
      previa,
      editando ? el('p', { class: 'campo-dica', texto:
        'Mudar o cargo não reescreve demandas antigas: elas ficam com quem já recebeu.' }) : null
    ]);

    let salvando = false;
    const confirmar = el('button', { class: 'botao botao-principal', type: 'button' },
      [editando ? 'Salvar' : 'Criar tag']);

    const modal = UI.abrirModal({
      titulo: editando ? 'Editar tag' : 'Nova tag',
      largura: '500px',
      corpo: formulario,
      rodape: [
        el('button', { class: 'botao', type: 'button', onclick: function () { modal.fechar(); } }, ['Cancelar']),
        confirmar
      ]
    });

    async function salvar() {
      if (salvando) return;
      salvando = true;
      confirmar.disabled = true;
      try {
        const dados = {
          nome: nome.value,
          cor: cor.value,
          cargo_id: cargo.value === '' ? null : Number(cargo.value)
        };

        if (editando) await window.api.tags.atualizar(tag.id, dados);
        else await window.api.tags.criar(dados);

        UI.aviso(editando ? 'Tag salva.' : 'Tag criada.');
        modal.fechar();
        recarregarTudo();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        salvando = false;
        confirmar.disabled = false;
      }
    }

    confirmar.addEventListener('click', salvar);
    formulario.addEventListener('submit', function (e) { e.preventDefault(); salvar(); });
    nome.focus();
  }

  async function alternarTag(tag) {
    try {
      if (tag.arquivada) {
        await window.api.tags.desarquivar(tag.id);
        UI.aviso('Tag desarquivada.');
      } else {
        const usos = await window.api.tags.emUso(tag.id);
        const certeza = await UI.confirmar({
          titulo: 'Arquivar tag',
          texto: usos > 0
            ? 'A tag "' + tag.nome + '" está em ' + usos + ' demanda(s). Arquivar não ' +
              'apaga nada: ela só deixa de ser oferecida em demanda nova.'
            : 'A tag "' + tag.nome + '" deixa de ser oferecida em demanda nova.',
          rotuloOk: 'Arquivar'
        });
        if (!certeza) return;

        await window.api.tags.arquivar(tag.id);
        UI.aviso('Tag arquivada.');
      }
      recarregarTudo();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  /* ------------------------------------------------------------------ *
   * Mutirão: atribuir as demandas que estão sem ninguém                  *
   * ------------------------------------------------------------------ */

  async function atualizarMutirao() {
    if (!refMutirao) return;

    try {
      const p = await window.api.atribuicao.previa();
      refMutirao.disabled = p.sem_responsavel === 0;
      refMutirao.textContent = p.sem_responsavel === 0
        ? 'Nenhuma demanda sem responsável'
        : 'Atribuir ' + p.sem_responsavel + ' demanda(s) sem responsável';
      refMutirao.dataset.total = String(p.sem_responsavel);
      refMutirao.dataset.solucao = String(p.com_solucao);
    } catch (erro) {
      refMutirao.disabled = true;
      refMutirao.textContent = 'Atribuir demandas sem responsável';
    }
  }

  async function rodarMutirao() {
    const total = Number(refMutirao.dataset.total || 0);
    const solucao = Number(refMutirao.dataset.solucao || 0);

    const certeza = await UI.confirmar({
      titulo: 'Atribuir demandas sem responsável',
      texto: total + ' demanda(s) estão sem ninguém. A regra da tag resolve ' + solucao +
             ' delas' + (solucao < total
               ? '; as outras ' + (total - solucao) + ' têm tag sem cargo, ou cargo sem ninguém ativo, e ficam como estão.'
               : '.') +
             ' Nenhuma demanda que já tenha responsável é tocada.',
      rotuloOk: 'Atribuir agora'
    });
    if (!certeza) return;

    refMutirao.disabled = true;
    try {
      const r = await window.api.atribuicao.mutirao();
      UI.aviso(r.demandas + ' demanda(s) receberam responsável (' + r.atribuicoes + ' atribuições).');
      recarregarTudo();
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
      refMutirao.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function bloco(titulo, subtitulo, corpo, botaoTopo) {
    return el('section', { class: 'painel painel-secao' }, [
      el('div', { class: 'painel-topo' }, [
        el('div', {}, [
          el('h2', { class: 'painel-titulo', texto: titulo }),
          el('p', { class: 'painel-sub', texto: subtitulo })
        ]),
        botaoTopo || null
      ]),
      el('div', { class: 'grade-rolagem' }, [corpo])
    ]);
  }

  function montar(container) {
    refCargos = el('div', { class: 'grade' });
    refPessoas = el('div', { class: 'grade' });
    refTags = el('div', { class: 'grade' });

    refMutirao = el('button', {
      class: 'botao', type: 'button', disabled: true, onclick: rodarMutirao
    }, ['Atribuir demandas sem responsável']);

    const corpo = el('div', { class: 'painel-rolagem' }, [
      bloco('Cargos',
        'A função de cada pessoa no time. Cargo marcado como somente leitura vê tudo e ' +
        'não altera nada, mesmo com permissão de administrador.',
        refCargos,
        el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () { abrirCargo(null); }
        }, ['+ Novo cargo'])),

      bloco('Profissionais',
        'Permissão é o que a pessoa pode alterar; cargo é o que ela faz. ' +
        'Não existe exclusão: desative quem sair.',
        refPessoas,
        el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () { abrirPessoa(null); }
        }, ['+ Nova pessoa'])),

      bloco('Tags',
        'A tag aponta para um cargo, e o cargo define quem recebe as demandas. ' +
        'A atribuição acontece quando a demanda é criada.',
        refTags,
        el('div', { class: 'painel-acoes' }, [
          refMutirao,
          el('button', {
            class: 'botao botao-principal', type: 'button',
            onclick: function () { abrirTag(null); }
          }, ['+ Nova tag'])
        ]))
    ]);

    container.appendChild(el('div', { class: 'tela-cheia' }, [corpo]));

    carregar();
  }

  function desmontar() {
    refCargos = null;
    refPessoas = null;
    refTags = null;
    refMutirao = null;
  }

  window.TelaUsuarios = { montar: montar, desmontar: desmontar };
})();
