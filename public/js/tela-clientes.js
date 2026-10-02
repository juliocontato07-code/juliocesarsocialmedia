'use strict';

(function () {
  const el = UI.el;

  let raiz = null;
  let desinscrever = null;
  let selecionadoId = null;
  let filtro = '';

  let refLista = null;
  let refDetalhe = null;
  let refContador = null;

  /* o bloco do cofre guarda temporizadores de senha aberta: precisa ser
     desmontado quando a tela troca, senão uma senha segue visível atrás */
  let blocoAcessos = null;

  /* ---------------- formulário ---------------- */

  function formularioCliente(cliente) {
    const dados = cliente || {};

    const campos = {
      nome: UI.entrada({ value: dados.nome || '', maxlength: 120, placeholder: 'Nome do cliente' }),
      arroba: UI.entrada({ value: dados.arroba || '', placeholder: '@perfil' }),
      nicho: UI.entrada({ value: dados.nicho || '', placeholder: 'Ex.: alimentação, estética' }),
      tipo_negocio: UI.entrada({ value: dados.tipo_negocio || '', placeholder: 'Ex.: loja física, e-commerce' }),
      contato: UI.entrada({ value: dados.contato || '', placeholder: '(00) 00000-0000' }),
      observacoes: UI.areaTexto({ value: dados.observacoes || '', placeholder: 'Anotações internas' })
    };

    const formulario = el('form', { class: 'formulario', autocomplete: 'off' }, [
      UI.campo('Nome', campos.nome),
      el('div', { class: 'formulario-par' }, [
        UI.campo('@ do Instagram', campos.arroba),
        UI.campo('Contato', campos.contato)
      ]),
      el('div', { class: 'formulario-par' }, [
        UI.campo('Nicho', campos.nicho),
        UI.campo('Tipo de negócio', campos.tipo_negocio)
      ]),
      UI.campo('Observações', campos.observacoes)
    ]);

    return {
      elemento: formulario,
      ler: function () {
        return {
          nome: campos.nome.value,
          arroba: campos.arroba.value,
          nicho: campos.nicho.value,
          tipo_negocio: campos.tipo_negocio.value,
          contato: campos.contato.value,
          observacoes: campos.observacoes.value
        };
      },
      focar: function () { campos.nome.focus(); }
    };
  }

  function abrirEditor(cliente) {
    const ehNovo = !cliente;
    const formulario = formularioCliente(cliente);
    let salvando = false;

    const botaoSalvar = el('button', { class: 'botao botao-principal', type: 'button' },
      [ehNovo ? 'Adicionar cliente' : 'Salvar alterações']);

    const modal = UI.abrirModal({
      titulo: ehNovo ? 'Novo cliente' : 'Editar cliente',
      largura: '560px',
      corpo: formulario.elemento,
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
        const dados = formulario.ler();
        const salvo = ehNovo
          ? await window.api.clientes.criar(dados)
          : await window.api.clientes.atualizar(cliente.id, dados);
        selecionadoId = salvo.id;
        await Estado.recarregar();
        UI.aviso(ehNovo ? 'Cliente adicionado.' : 'Cliente atualizado.');
        modal.fechar();
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        salvando = false;
        botaoSalvar.disabled = false;
      }
    }

    botaoSalvar.addEventListener('click', salvar);
    formulario.elemento.addEventListener('submit', function (evento) {
      evento.preventDefault();
      salvar();
    });

    formulario.focar();
  }

  /* ---------------- arquivados ---------------- */

  function abrirArquivados() {
    const corpo = el('div', { class: 'lista-arquivados' });

    function desenharArquivados() {
      UI.limpar(corpo);
      const lista = Estado.dados.clientesArquivados;

      if (lista.length === 0) {
        corpo.appendChild(UI.vazio('Nenhum cliente arquivado.',
          'Clientes arquivados somem das telas de trabalho, mas mantêm todo o histórico.'));
        return;
      }

      for (const cliente of lista) {
        corpo.appendChild(el('div', { class: 'linha-arquivado' }, [
          el('div', { class: 'linha-arquivado-info' }, [
            el('div', { class: 'linha-arquivado-nome', texto: cliente.nome }),
            cliente.arroba ? el('div', { class: 'texto-fraco', texto: cliente.arroba }) : null
          ]),
          el('button', {
            class: 'botao botao-pequeno',
            type: 'button',
            onclick: function () { Exportacao.abrirHistorico(cliente); }
          }, ['Histórico']),
          Estado.ehAdmin() && el('button', {
            class: 'botao botao-pequeno',
            type: 'button',
            onclick: async function () {
              try {
                await window.api.clientes.desarquivar(cliente.id);
                await Estado.recarregar();
                UI.aviso(cliente.nome + ' voltou para as telas de trabalho.');
                desenharArquivados();
              } catch (erro) {
                UI.aviso(erro.message, 'erro');
              }
            }
          }, ['Desarquivar'])
        ]));
      }
    }

    desenharArquivados();

    UI.abrirModal({
      titulo: 'Clientes arquivados',
      largura: '520px',
      corpo: corpo
    });
  }

  /* ---------------- lista lateral ---------------- */

  function desenharLista(alvo) {
    UI.limpar(alvo);

    const termo = filtro.trim().toLowerCase();
    const lista = Estado.dados.clientes.filter(function (cliente) {
      if (termo === '') return true;
      return (cliente.nome + ' ' + (cliente.arroba || '') + ' ' + (cliente.nicho || ''))
        .toLowerCase().indexOf(termo) > -1;
    });

    if (lista.length === 0) {
      alvo.appendChild(UI.vazio(
        Estado.dados.clientes.length === 0 ? 'Nenhum cliente ainda.' : 'Nada encontrado.',
        Estado.dados.clientes.length === 0 ? 'Use "Adicionar cliente" para começar.' : null
      ));
      return;
    }

    for (const cliente of lista) {
      alvo.appendChild(el('button', {
        class: 'item-cliente' + (cliente.id === selecionadoId ? ' ativo' : ''),
        type: 'button',
        onclick: function () {
          selecionadoId = cliente.id;
          desenhar();
        }
      }, [
        el('span', { class: 'item-cliente-nome', texto: cliente.nome }),
        cliente.arroba ? el('span', { class: 'item-cliente-arroba', texto: cliente.arroba }) : null
      ]));
    }
  }

  /* ---------------- detalhe ---------------- */

  function linhaInfo(rotulo, valor) {
    return el('div', { class: 'info' }, [
      el('div', { class: 'info-rotulo', texto: rotulo }),
      el('div', { class: 'info-valor' + (valor ? '' : ' info-vazia'), texto: valor || 'não informado' })
    ]);
  }

  async function desenharDetalhe(alvo) {
    UI.limpar(alvo);

    const cliente = Estado.dados.clientes.find(function (c) { return c.id === selecionadoId; });

    if (!cliente) {
      alvo.appendChild(UI.vazio('Selecione um cliente',
        'Os dados do cliente aparecem aqui. Calendário em lote e exportação em PDF entram nas próximas fases.'));
      return;
    }

    alvo.appendChild(el('div', { class: 'detalhe-topo' }, [
      el('div', {}, [
        el('h2', { class: 'detalhe-nome', texto: cliente.nome }),
        el('div', { class: 'texto-fraco', texto: cliente.arroba || 'sem @ cadastrado' })
      ]),
      el('div', { class: 'detalhe-acoes' }, [
        Estado.ehAdmin() && el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () { App.ir('planejador', { clienteId: cliente.id }); }
        }, ['Elaborar calendário']),
        el('button', {
          class: 'botao', type: 'button',
          onclick: function () { Exportacao.abrir(cliente); }
        }, ['Exportar PDF']),
        Estado.ehAdmin() && el('button', {
          class: 'botao', type: 'button',
          onclick: function () { abrirEditor(cliente); }
        }, ['Editar']),
        Estado.ehAdmin() && el('button', {
          class: 'botao', type: 'button',
          onclick: function () { pedirArquivamento(cliente); }
        }, ['Arquivar'])
      ])
    ]));

    alvo.appendChild(el('div', { class: 'grade-info' }, [
      linhaInfo('Nicho', cliente.nicho),
      linhaInfo('Tipo de negócio', cliente.tipo_negocio),
      linhaInfo('Contato', cliente.contato)
    ]));

    alvo.appendChild(el('div', { class: 'bloco-observacoes' }, [
      el('div', { class: 'info-rotulo', texto: 'Observações' }),
      el('div', {
        class: 'info-valor' + (cliente.observacoes ? '' : ' info-vazia'),
        texto: cliente.observacoes || 'nenhuma observação'
      })
    ]));

    /*
     * O cofre entra depois dos dados do cliente e antes do rodapé.
     *
     * Para quem não tem o cargo marcado, montarBloco devolve null e não
     * acrescenta nada: a tela fica exatamente como era antes desta mudança,
     * sem espaço reservado nem cadeado.
     */
    if (window.Acessos) {
      if (blocoAcessos && blocoAcessos.desmontar) blocoAcessos.desmontar();
      blocoAcessos = Acessos.montarBloco(cliente, alvo);
    }

    const rodape = el('div', { class: 'rodape-detalhe texto-fraco' });
    alvo.appendChild(rodape);

    try {
      const resumo = await window.api.clientes.resumo(cliente.id);
      rodape.textContent = (resumo.total || 0) + ' demanda(s) registradas para este cliente.';
    } catch (erro) {
      rodape.textContent = '';
    }
  }

  async function pedirArquivamento(cliente) {
    const certeza = await UI.confirmar({
      titulo: 'Arquivar cliente',
      texto: cliente.nome + ' vai sumir da grade semanal, da visão mensal e de todos os selects. ' +
             'O histórico continua salvo e volta inteiro se você desarquivar.',
      rotuloOk: 'Arquivar'
    });
    if (!certeza) return;
    try {
      await window.api.clientes.arquivar(cliente.id);
      selecionadoId = null;
      await Estado.recarregar();
      UI.aviso(cliente.nome + ' foi arquivado.');
    } catch (erro) {
      UI.aviso(erro.message, 'erro');
    }
  }

  /* ---------------- montagem ---------------- */

  function desenhar() {
    if (!refLista) return;
    desenharLista(refLista);
    desenharDetalhe(refDetalhe);

    UI.limpar(refContador);
    const total = Estado.dados.clientesArquivados.length;
    if (total > 0) refContador.appendChild(el('span', { class: 'contador', texto: String(total) }));
  }

  function montar(container) {
    raiz = container;
    refContador = el('span', { class: 'contador-caixa' });

    const busca = UI.entrada({
      class: 'entrada busca',
      placeholder: 'Buscar cliente',
      oninput: function (evento) {
        filtro = evento.target.value;
        desenharLista(refLista);
      }
    });

    refLista = el('div', { class: 'lista-clientes' });
    refDetalhe = el('section', { class: 'detalhe' });

    const lateral = el('aside', { class: 'lateral' }, [
      el('div', { class: 'lateral-topo' }, [
        Estado.ehAdmin() && el('button', {
          class: 'botao botao-principal botao-largo', type: 'button',
          onclick: function () { abrirEditor(null); }
        }, ['+ Adicionar cliente']),
        el('button', {
          class: 'botao botao-largo', type: 'button',
          onclick: abrirArquivados
        }, ['Clientes arquivados', refContador])
      ]),
      busca,
      refLista
    ]);

    raiz.appendChild(el('div', { class: 'tela-lateral' }, [lateral, refDetalhe]));

    desinscrever = Estado.aoMudar(desenhar);
    desenhar();
  }

  function desmontar() {
    if (blocoAcessos && blocoAcessos.desmontar) blocoAcessos.desmontar();
    blocoAcessos = null;
    if (desinscrever) desinscrever();
    desinscrever = null;
    refLista = null;
    refDetalhe = null;
    refContador = null;
    raiz = null;
  }

  window.TelaClientes = { montar: montar, desmontar: desmontar };
})();
