'use strict';

/**
 * Tela da demanda: o único lugar onde tudo aparece.
 * Cliente, data, tag, chip de status, título, botão de link e a descrição
 * completa, que é o campo mais importante do app.
 */
(function () {
  const el = UI.el;

  let demanda = null;
  let origem = 'semanal';
  let campos = null;
  let marcaExtra = null;
  let refSalvar = null;
  let refAviso = null;
  let sujo = false;

  /* ------------------------------------------------------------------ *
   * Estado do formulário                                                *
   * ------------------------------------------------------------------ */

  function marcarSujo() {
    if (sujo) return;
    sujo = true;
    refSalvar.disabled = false;
    refSalvar.textContent = 'Salvar alterações';
    refAviso.textContent = 'Alterações não salvas';
    refAviso.classList.add('td-aviso-pendente');
  }

  function marcarLimpo(mensagem) {
    sujo = false;
    refSalvar.disabled = true;
    refSalvar.textContent = 'Salvo';
    refAviso.textContent = mensagem || '';
    refAviso.classList.remove('td-aviso-pendente');
  }

  function lerFormulario() {
    /* o servidor recusa campo fora da permissão; aqui nem mandamos */
    if (!Estado.ehAdmin()) return { link: campos.link.value };

    return {
      cliente_id: Number(campos.cliente.value),
      tag_id: Number(campos.tag.value),
      data: campos.data.value,
      titulo: campos.titulo.value,
      descricao: campos.descricao.value,
      link: campos.link.value,
      responsavel_id: campos.responsavel.value === '' ? null : Number(campos.responsavel.value),
      prioridade: campos.prioridade.value,
      data_solicitacao: campos.data_solicitacao.value || null,
      prazo: campos.prazo.value || null,
      extra: marcaExtra.marcado()
    };
  }

  async function salvar() {
    if (!sujo) return true;
    refSalvar.disabled = true;
    try {
      const salva = await window.api.demandas.atualizar(demanda.id, lerFormulario());
      demanda = salva;
      marcarLimpo('Salvo agora');
      Estado.demandasMudaram();
      return true;
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
      refSalvar.disabled = false;
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Montagem                                                            *
   * ------------------------------------------------------------------ */

  function montar(container, argumentos) {
    origem = argumentos.origem && argumentos.origem !== 'demanda' ? argumentos.origem : 'semanal';
    sujo = false;

    const raiz = el('div', { class: 'tela-cheia' });
    container.appendChild(raiz);

    window.api.demandas.obter(argumentos.id).then(function (encontrada) {
      if (!encontrada) {
        raiz.appendChild(el('div', { class: 'tela-simples' }, [
          el('div', { class: 'painel' }, [UI.vazio('Demanda não encontrada.')])
        ]));
        return;
      }
      demanda = encontrada;
      desenhar(raiz);
    }).catch(function (erro) {
      raiz.appendChild(el('div', { class: 'tela-simples' }, [
        el('div', { class: 'painel' }, [el('div', { class: 'erro', texto: erro.message })])
      ]));
    });
  }

  function desenhar(raiz) {
    UI.limpar(raiz);

    const clientes = Estado.dados.clientes.slice();
    if (!clientes.some(function (c) { return c.id === demanda.cliente_id; })) {
      clientes.push({ id: demanda.cliente_id, nome: demanda.cliente_nome + ' (arquivado)' });
    }

    const tags = Estado.dados.tags.slice();
    if (!tags.some(function (t) { return t.id === demanda.tag_id; })) {
      tags.push({ id: demanda.tag_id, nome: demanda.tag_nome + ' (arquivada)' });
    }

    campos = {
      cliente: el('select', { class: 'entrada' }, clientes.map(function (c) {
        return el('option', { value: String(c.id), selected: c.id === demanda.cliente_id, texto: c.nome });
      })),
      tag: el('select', { class: 'entrada' }, tags.map(function (t) {
        return el('option', { value: String(t.id), selected: t.id === demanda.tag_id, texto: t.nome });
      })),
      data: el('input', { class: 'entrada', type: 'date', value: demanda.data }),
      titulo: UI.entrada({ value: demanda.titulo || '', placeholder: 'Nome curto da peça' }),
      link: UI.entrada({ value: demanda.link || '', placeholder: 'https://...' }),
      descricao: el('textarea', {
        class: 'entrada td-descricao',
        placeholder: 'Copy da publicação, roteiro do vídeo, direção de arte…\n\nQuebras de linha são preservadas.',
        spellcheck: 'false',
        value: demanda.descricao || ''
      }),
      responsavel: Campos.seletorResponsavel(demanda.responsavel_id, {
        nomeAtual: demanda.responsavel_nome
      }),
      prioridade: Campos.seletorPrioridade(demanda.prioridade),
      data_solicitacao: el('input', {
        class: 'entrada', type: 'date', value: demanda.data_solicitacao || ''
      }),
      prazo: el('input', { class: 'entrada', type: 'date', value: demanda.prazo || '' })
    };

    marcaExtra = Campos.marcaExtra(demanda.extra);

    refAviso = el('span', { class: 'td-aviso' });
    refSalvar = el('button', {
      class: 'botao botao-principal', type: 'button', disabled: true, onclick: salvar
    }, ['Salvo']);

    /* para o papel "usuario" só o link é editável: o resto abre em leitura */
    const editaveis = Estado.ehAdmin()
      ? Object.keys(campos)
      : ['link'];

    for (const chave of Object.keys(campos)) {
      if (editaveis.indexOf(chave) === -1) {
        campos[chave].readOnly = true;
        campos[chave].disabled = campos[chave].tagName === 'SELECT';
        campos[chave].classList.add('somente-leitura');
        continue;
      }
      campos[chave].addEventListener('input', marcarSujo);
      campos[chave].addEventListener('change', marcarSujo);
    }

    /* Espectador não altera nem o link: o único campo que sobraria editável
       para o papel "usuario" também fecha. */
    if (Estado.ehEspectador()) {
      campos.link.readOnly = true;
      campos.link.classList.add('somente-leitura');
    }

    if (Estado.ehAdmin()) {
      marcaExtra.caixa.addEventListener('change', marcarSujo);
    } else {
      marcaExtra.caixa.disabled = true;
      marcaExtra.elemento.classList.add('somente-leitura');
    }

    /* Ctrl+S salva sem tirar a mão do teclado */
    raiz.addEventListener('keydown', function (evento) {
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 's') {
        evento.preventDefault();
        salvar();
      }
    });

    const chip = Cartao.chipStatus(demanda, { grande: true });

    const barra = el('div', { class: 'barra' }, [
      el('div', { class: 'barra-esquerda' }, [
        el('button', {
          class: 'botao', type: 'button', title: 'Voltar',
          onclick: function () { App.ir(origem); }
        }, ['‹ Voltar']),
        el('span', { class: 'barra-periodo', texto: demanda.cliente_nome }),
        el('span', { class: 'texto-fraco', texto: Datas.comDiaDaSemana(demanda.data) + ' de ' + Datas.ano(demanda.data) })
      ]),
      el('div', { class: 'barra-direita' }, [
        refAviso,
        Estado.ehAdmin() && el('button', {
          class: 'botao', type: 'button',
          onclick: function () { Cartao.abrirDuplicar(demanda); }
        }, ['Duplicar']),
        Estado.ehAdmin() && el('button', {
          class: 'botao', type: 'button',
          onclick: async function () {
            const foi = await Cartao.pedirExclusao(demanda);
            if (foi) { sujo = false; App.ir(origem); }
          }
        }, ['Excluir']),
        refSalvar
      ])
    ]);

    const botaoLink = el('button', {
      class: 'botao', type: 'button',
      onclick: async function () {
        const url = campos.link.value.trim();
        if (url === '') { campos.link.focus(); return; }
        try { await window.api.abrirLink(url); } catch (erro) { UI.aviso(erro.message, 'erro'); }
      }
    }, ['Abrir link']);

    const situacao = Campos.prazoSituacao(demanda);

    const cabecalho = el('div', { class: 'td-cabecalho' }, [
      el('div', { class: 'td-linha-status' }, [
        chip,
        Cartao.pilulaTag(demanda.tag_nome, demanda.tag_cor),
        el('span', {
          class: 'selo-prazo selo-prazo-' + situacao.tom,
          title: situacao.detalhe,
          texto: situacao.texto === '—' ? 'sem medição' : situacao.texto
        }),
        demanda.extra ? el('span', {
          class: 'selo-extra', title: 'Fora do escopo contratado', texto: 'extra'
        }) : null,
        demanda.concluido_em ? el('span', {
          class: 'texto-fraco td-concluido',
          texto: 'concluída em ' + new Date(demanda.concluido_em).toLocaleString('pt-BR')
        }) : null
      ]),
      UI.campo('Título', campos.titulo),
      el('div', { class: 'td-grade' }, [
        UI.campo('Cliente', campos.cliente),
        UI.campo('Tag', campos.tag),
        UI.campo('Data no calendário', campos.data)
      ]),
      el('div', { class: 'td-grade' }, [
        UI.campo('Responsável', campos.responsavel),
        UI.campo('Prioridade', campos.prioridade),
        UI.campo('Data da solicitação', campos.data_solicitacao, 'Quando o cliente pediu.')
      ]),
      el('div', { class: 'td-grade td-grade-prazo' }, [
        UI.campo('Prazo de entrega', campos.prazo,
          demanda.prazo ? '' : 'Vazio: vale a data no calendário, ' + Datas.curta(demanda.data) + '.'),
        marcaExtra.elemento
      ]),
      el('div', { class: 'td-linha-link' }, [
        el('label', { class: 'campo td-campo-link' }, [
          el('span', { class: 'campo-rotulo', texto: 'Link' }),
          campos.link
        ]),
        botaoLink
      ])
    ]);

    const bloco = el('div', { class: 'td-bloco-descricao' }, [
      el('div', { class: 'td-descricao-topo' }, [
        el('span', { class: 'campo-rotulo', texto: 'Descrição' }),
        el('span', {
          class: 'texto-fraco td-dica',
          texto: Estado.ehAdmin()
            ? 'copy, roteiro, direção de arte — sem limite de tamanho'
            : 'somente leitura no seu perfil'
        })
      ]),
      campos.descricao
    ]);

    raiz.appendChild(barra);
    raiz.appendChild(el('div', { class: 'td-corpo' }, [cabecalho, bloco]));

    marcarLimpo(Estado.ehAdmin() ? ''
      : Estado.ehEspectador() ? 'Seu cargo é espectador: somente leitura'
      : 'Seu perfil altera o status e o link');
    if (Estado.ehAdmin()) campos.titulo.focus();
    else campos.link.focus();
  }

  /** O roteador pergunta antes de sair com alterações pendentes. */
  async function podeSair() {
    if (!sujo) return true;

    const certeza = await UI.confirmar({
      titulo: 'Sair sem salvar',
      texto: 'Esta demanda tem alterações que ainda não foram gravadas. Sair agora descarta o que você escreveu.',
      rotuloOk: 'Descartar alterações',
      perigo: true
    });
    return certeza;
  }

  function desmontar() {
    demanda = null;
    campos = null;
    marcaExtra = null;
    refSalvar = null;
    refAviso = null;
    sujo = false;
  }

  window.TelaDemanda = { montar: montar, desmontar: desmontar, podeSair: podeSair };
})();
