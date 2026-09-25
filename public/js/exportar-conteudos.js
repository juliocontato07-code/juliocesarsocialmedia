'use strict';

/**
 * Exportar conteúdos: o documento interno de produção.
 *
 * Não confundir com a exportação de calendário, que continua em exportacao.js
 * e não foi tocada. Aquela é o que vai para o cliente: sem status, sem link,
 * sem roteiro. Esta é o oposto — é o roteiro inteiro, com responsável e
 * status, para o designer, o editor e o social media trabalharem a partir
 * dela. As duas convivem e não compartilham nada além do andaime de impressão.
 *
 * Esse andaime é reaproveitado de propósito: a folha usa o mesmo id
 * `folha-impressao`, então a regra que esconde o resto da página na hora de
 * imprimir já vale aqui sem uma linha nova. O que distingue as duas é a
 * classe da folha, e é por ela que os estilos de cada uma se separam.
 *
 * Leitura pura: qualquer papel exporta, inclusive cargo somente leitura.
 */
(function () {
  const el = UI.el;

  /* ------------------------------------------------------------------ *
   * Impressão                                                           *
   * ------------------------------------------------------------------ */

  function slug(texto) {
    return String(texto || 'cliente')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'cliente';
  }

  /**
   * O nome sugerido do arquivo vem do título do documento.
   *
   * É o único jeito de influenciar o nome no "Salvar como PDF" do navegador:
   * não existe API para isso. O título volta ao original assim que a impressão
   * termina, senão a aba ficaria com o nome do arquivo para sempre.
   */
  function comTituloDeArquivo(nome, funcao) {
    const original = document.title;
    document.title = nome;

    const devolver = function () { document.title = original; };
    funcao(devolver);
  }

  function imprimir(folha, nomeArquivo) {
    const anterior = document.getElementById('folha-impressao');
    if (anterior) anterior.remove();

    document.body.appendChild(folha);
    document.body.classList.add('imprimindo');

    comTituloDeArquivo(nomeArquivo, function (devolverTitulo) {
      const limpar = function () {
        document.body.classList.remove('imprimindo');
        const atual = document.getElementById('folha-impressao');
        if (atual) atual.remove();
        devolverTitulo();
        window.removeEventListener('afterprint', limpar);
      };

      window.addEventListener('afterprint', limpar);

      /* um quadro para o navegador aplicar o estilo antes do diálogo */
      window.requestAnimationFrame(function () {
        window.print();
        /* alguns navegadores não disparam afterprint: rede de segurança */
        window.setTimeout(limpar, 1500);
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * A folha                                                             *
   * ------------------------------------------------------------------ */

  function contagemPorTag(lista) {
    const ordem = [];
    const contas = new Map();

    for (const d of lista) {
      if (!contas.has(d.tag_nome)) { contas.set(d.tag_nome, 0); ordem.push(d.tag_nome); }
      contas.set(d.tag_nome, contas.get(d.tag_nome) + 1);
    }

    return ordem.map(function (nome) { return contas.get(nome) + ' ' + nome; });
  }

  function etiquetasDaPeca(demanda) {
    const marcas = [];

    if (demanda.prioridade === 'alta') {
      marcas.push(el('span', { class: 'pc-etiqueta', texto: 'prioridade alta' }));
    }
    if (demanda.extra) {
      marcas.push(el('span', { class: 'pc-etiqueta', texto: 'solicitação extra' }));
    }

    return marcas;
  }

  /**
   * Uma peça é uma tabela, e isso não é decoração.
   *
   * O roteiro de um carrossel de dez cards não cabe em uma página, e o pedido
   * é que o título se repita no topo da continuação. Nenhuma propriedade de
   * CSS faz isso: `break-inside` só diz onde pode quebrar, não o que redesenhar
   * depois da quebra. O único mecanismo de impressão que repete um cabeçalho
   * quando o conteúdo atravessa páginas é o <thead> de uma tabela — é para isso
   * que ele existe. Então o cabeçalho da peça vai no <thead> e a descrição no
   * <tbody>: peça curta não quebra por causa do break-inside: avoid, e peça
   * longa quebra trazendo tag, status, título e responsável de novo.
   */
  function blocoDaPeca(demanda) {
    const pessoas = (demanda.responsaveis || []).map(Cartao.nomeDe);
    const temLink = demanda.link && demanda.link.trim() !== '';
    const temDescricao = demanda.descricao && demanda.descricao.trim() !== '';

    const cabecalho = el('th', { class: 'pc-peca-cabecalho' }, [
      el('div', { class: 'pc-peca-topo' }, [
        el('span', { class: 'pc-tag', texto: demanda.tag_nome }),
        el('span', {
          class: 'pc-status pc-status-' + demanda.status,
          texto: demanda.status === 1 ? 'Concluído' : 'Pendente'
        })
      ].concat(etiquetasDaPeca(demanda))),

      el('div', { class: 'pc-titulo', texto: demanda.titulo || 'sem título' }),

      el('div', { class: 'pc-responsavel' }, [
        el('span', { class: 'pc-rotulo', texto: 'Responsável: ' }),
        el('span', { texto: pessoas.length > 0 ? pessoas.join(', ') : 'sem responsável' })
      ])
    ]);

    const corpo = el('td', { class: 'pc-peca-corpo' }, [
      /*
       * <pre> com white-space: pre-wrap devolve as quebras de linha exatamente
       * como estão no banco. É o roteiro: perder uma quebra aqui é perder a
       * separação entre as falas de um vídeo ou entre os cards de um carrossel.
       */
      temDescricao
        ? el('pre', { class: 'pc-descricao', texto: demanda.descricao })
        : el('div', { class: 'pc-sem-descricao', texto: 'Sem roteiro escrito.' }),

      /* escrito por extenso: em papel não existe clique */
      temLink
        ? el('div', { class: 'pc-link' }, [
            el('span', { class: 'pc-rotulo', texto: 'Link: ' }),
            el('span', { texto: demanda.link })
          ])
        : null
    ]);

    return el('table', { class: 'pc-peca' }, [
      el('thead', {}, [el('tr', {}, [cabecalho])]),
      el('tbody', {}, [el('tr', {}, [corpo])])
    ]);
  }

  function montarFolha(cliente, lista, periodo) {
    const folha = el('div', { class: 'folha folha-conteudos', id: 'folha-impressao' });

    /* ---- cabeçalho da primeira página ---- */
    folha.appendChild(el('header', { class: 'pc-capa' }, [
      el('h1', { class: 'pc-cliente', texto: cliente.nome }),
      cliente.arroba ? el('div', { class: 'pc-arroba', texto: cliente.arroba }) : null,

      el('div', { class: 'pc-capa-dados' }, [
        el('div', {}, [
          el('span', { class: 'pc-rotulo', texto: 'Período: ' }),
          el('strong', { texto: Datas.intervaloPorExtenso(periodo.inicio, periodo.fim) })
        ]),
        el('div', {}, [
          el('strong', { texto: String(lista.length) }),
          el('span', { texto: lista.length === 1 ? ' peça' : ' peças' })
        ]),
        el('div', { class: 'pc-gerado' }, [
          el('span', { texto: 'Gerado em ' + Datas.curta(Datas.hoje()) })
        ])
      ]),

      /* ---- resumo por tag ---- */
      el('div', { class: 'pc-resumo', texto: contagemPorTag(lista).join(' · ') })
    ]));

    /* ---- conteúdo, agrupado por data em ordem crescente ---- */
    const porData = new Map();
    for (const d of lista) {
      if (!porData.has(d.data)) porData.set(d.data, []);
      porData.get(d.data).push(d);
    }

    const datas = Array.from(porData.keys()).sort();

    /*
     * Todo o conteúdo mora dentro de uma tabela, e o rodapé dentro do <tfoot>
     * dela. Parece rebuscado e não é: é o único jeito de ter um rodapé em toda
     * página que não passe por cima do texto.
     *
     * `position: fixed` desenha em toda página, mas o motor não reserva o
     * espaço: numa página cheia o rodapé cai em cima da última linha do
     * roteiro — foi o que aconteceu aqui antes desta mudança. O <tfoot>, sim,
     * é descontado da altura útil de cada página antes do texto ser
     * distribuído, então a colisão deixa de ser possível.
     *
     * O número da página não entra: counter(page) só vale dentro de margin box
     * do @page, que o Chrome não implementa. A numeração vem do rodapé do
     * próprio navegador, junto com o título — que é o nome do arquivo, com
     * cliente e período.
     */
    const rodape = el('tfoot', { class: 'pc-rodape-linha' }, [
      el('tr', {}, [
        el('td', {}, [
          el('div', { class: 'pc-rodape' }, [
            el('span', { texto: cliente.nome }),
            el('span', { texto: Datas.curta(periodo.inicio) + ' a ' + Datas.curta(periodo.fim) })
          ])
        ])
      ])
    ]);

    const celula = el('td', { class: 'pc-folha-celula' });
    const corpo = el('table', { class: 'pc-folha' }, [
      rodape,
      el('tbody', {}, [el('tr', {}, [celula])])
    ]);

    folha.appendChild(corpo);

    for (const data of datas) {
      const pecas = porData.get(data);

      const titulo = el('h2', { class: 'pc-dia-titulo' }, [
        el('span', { class: 'pc-dia-data', texto: Datas.porExtenso(data) }),
        el('span', { class: 'pc-dia-semana', texto: Datas.nomeDiaLongo(data) })
      ]);

      /*
       * O cabeçalho da data anda colado na primeira peça.
       *
       * `break-after: avoid` seria o jeito direto de dizer "não me deixe sozinho
       * no pé da página", mas o Chrome ignora essa propriedade na impressão.
       * O que ele respeita é `break-inside: avoid`: então o título e a primeira
       * peça entram no mesmo bloco, e o motor tem de levar os dois juntos para
       * a página seguinte ou nenhum.
       */
      const grupo = el('section', { class: 'pc-dia' }, [
        el('div', { class: 'pc-dia-abertura' }, [titulo, blocoDaPeca(pecas[0])])
      ]);

      for (const demanda of pecas.slice(1)) grupo.appendChild(blocoDaPeca(demanda));

      celula.appendChild(grupo);
    }

    return folha;
  }


  /* ------------------------------------------------------------------ *
   * Modal                                                               *
   * ------------------------------------------------------------------ */

  function atalhosDePeriodo(entradaInicio, entradaFim, aoMudar) {
    function aplicar(inicio, fim) {
      entradaInicio.value = inicio;
      entradaFim.value = fim;
      aoMudar();
    }

    const hoje = Datas.hoje();

    return el('div', { class: 'ec-atalhos' }, [
      el('button', {
        class: 'botao botao-pequeno', type: 'button',
        onclick: function () {
          aplicar(Datas.primeiroDiaDoMes(hoje), Datas.ultimoDiaDoMes(hoje));
        }
      }, ['Este mês']),

      el('button', {
        class: 'botao botao-pequeno', type: 'button',
        onclick: function () {
          const passado = Datas.somarMeses(Datas.primeiroDiaDoMes(hoje), -1);
          aplicar(Datas.primeiroDiaDoMes(passado), Datas.ultimoDiaDoMes(passado));
        }
      }, ['Mês passado']),

      el('button', {
        class: 'botao botao-pequeno', type: 'button',
        onclick: function () { aplicar(hoje, Datas.somarDias(hoje, 30)); }
      }, ['Próximos 30 dias'])
    ]);
  }

  function abrir() {
    /* ---------------- cliente ---------------- */

    const marcaArquivados = el('input', { type: 'checkbox' });

    const seletorCliente = el('select', { class: 'entrada' });

    function preencherClientes() {
      const lista = marcaArquivados.checked
        ? Estado.dados.clientes.concat(Estado.dados.clientesArquivados)
        : Estado.dados.clientes;

      const escolhido = seletorCliente.value;
      UI.limpar(seletorCliente);

      seletorCliente.appendChild(el('option', { value: '', texto: 'Escolha um cliente' }));

      for (const c of lista) {
        const arquivado = Estado.dados.clientesArquivados.indexOf(c) > -1;
        seletorCliente.appendChild(el('option', {
          value: String(c.id),
          texto: c.nome + (arquivado ? ' (arquivado)' : '')
        }));
      }

      /* mantém a escolha se ela continuar na lista */
      if (escolhido && seletorCliente.querySelector('option[value="' + escolhido + '"]')) {
        seletorCliente.value = escolhido;
      }
    }

    preencherClientes();

    /* ---------------- tags ---------------- */

    /* inclui as arquivadas: exportar histórico é caso real, e demanda antiga
       pode estar classificada com tag que saiu de uso depois */
    const todasAsTags = Estado.dados.tags.concat(Estado.dados.tagsArquivadas);
    const marcadas = new Set(todasAsTags.map(function (t) { return t.id; }));

    const listaTags = el('div', { class: 'ec-tags' });

    function desenharTags() {
      UI.limpar(listaTags);

      for (const tag of todasAsTags) {
        const caixa = el('input', { type: 'checkbox' });
        caixa.checked = marcadas.has(tag.id);

        caixa.addEventListener('change', function () {
          if (caixa.checked) marcadas.add(tag.id);
          else marcadas.delete(tag.id);
          revalidar();
        });

        const arquivada = Boolean(tag.arquivada);

        listaTags.appendChild(el('label', {
          class: 'ec-tag' + (arquivada ? ' ec-tag-arquivada' : '')
        }, [
          caixa,
          el('span', { texto: tag.nome + (arquivada ? ' (arquivada)' : '') })
        ]));
      }
    }

    desenharTags();

    const atalhosTags = el('div', { class: 'ec-atalhos' }, [
      el('button', {
        class: 'botao botao-pequeno', type: 'button',
        onclick: function () {
          for (const t of todasAsTags) marcadas.add(t.id);
          desenharTags();
          revalidar();
        }
      }, ['Marcar todas']),
      el('button', {
        class: 'botao botao-pequeno', type: 'button',
        onclick: function () {
          marcadas.clear();
          desenharTags();
          revalidar();
        }
      }, ['Desmarcar todas'])
    ]);

    /* ---------------- período ---------------- */

    /* sem valor padrão de propósito: o período é escolha de quem exporta, e um
       mês pré-preenchido vira o mês que todo mundo exporta sem pensar */
    const entradaInicio = el('input', { class: 'entrada', type: 'date' });
    const entradaFim = el('input', { class: 'entrada', type: 'date' });

    /* ---------------- rodapé e validação ---------------- */

    const aviso = el('div', { class: 'ec-aviso' });
    const contagem = el('div', { class: 'ec-contagem texto-fraco' });
    const gerar = el('button', {
      class: 'botao botao-principal', type: 'button', disabled: true
    }, ['Gerar PDF']);

    let encontradas = [];
    let buscando = 0;

    function problema() {
      if (seletorCliente.value === '') return 'Escolha um cliente.';
      if (marcadas.size === 0) return 'Marque ao menos uma tag.';
      if (!entradaInicio.value || !entradaFim.value) return 'Preencha as duas datas.';
      if (entradaFim.value < entradaInicio.value) return 'A data final é anterior à inicial.';
      return null;
    }

    async function revalidar() {
      const falta = problema();

      aviso.textContent = falta && falta !== 'Escolha um cliente.' &&
                          falta !== 'Preencha as duas datas.' ? falta : '';
      aviso.classList.toggle('ec-aviso-visivel', Boolean(aviso.textContent));

      if (falta) {
        gerar.disabled = true;
        contagem.textContent = falta;
        encontradas = [];
        return;
      }

      /*
       * Contar antes de gerar.
       *
       * O número aparece no rodapé para ninguém descobrir um PDF vazio depois
       * de abrir o diálogo de impressão. `buscando` descarta resposta de uma
       * busca antiga que chegue depois de uma nova — trocar o cliente duas
       * vezes rápido não pode deixar a contagem do primeiro na tela.
       */
      const meu = ++buscando;
      gerar.disabled = true;
      contagem.textContent = 'Contando…';

      try {
        const lista = await window.api.demandas.listarPeriodo(
          entradaInicio.value, entradaFim.value,
          { clienteId: Number(seletorCliente.value), incluirArquivados: true }
        );

        if (meu !== buscando) return;

        encontradas = lista.filter(function (d) { return marcadas.has(d.tag_id); });

        if (encontradas.length === 0) {
          contagem.textContent = 'Nenhuma peça nesse período com essas tags.';
          gerar.disabled = true;
          return;
        }

        contagem.textContent = encontradas.length === 1
          ? '1 peça no período'
          : encontradas.length + ' peças no período';
        gerar.disabled = false;
      } catch (erro) {
        if (meu !== buscando) return;
        contagem.textContent = erro.message;
        gerar.disabled = true;
      }
    }

    seletorCliente.addEventListener('change', revalidar);
    entradaInicio.addEventListener('change', revalidar);
    entradaFim.addEventListener('change', revalidar);

    marcaArquivados.addEventListener('change', function () {
      preencherClientes();
      revalidar();
    });

    const formulario = el('form', { class: 'formulario ec-formulario', autocomplete: 'off' }, [
      el('div', { class: 'ec-bloco' }, [
        UI.campo('Cliente', seletorCliente),
        el('label', { class: 'ec-marca-discreta' }, [
          marcaArquivados,
          el('span', { class: 'texto-fraco', texto: 'incluir clientes arquivados' })
        ])
      ]),

      el('div', { class: 'ec-bloco' }, [
        el('div', { class: 'ec-bloco-topo' }, [
          el('span', { class: 'campo-rotulo', texto: 'Tags' }),
          atalhosTags
        ]),
        listaTags
      ]),

      el('div', { class: 'ec-bloco' }, [
        el('div', { class: 'ec-bloco-topo' }, [
          el('span', { class: 'campo-rotulo', texto: 'Período' }),
          atalhosDePeriodo(entradaInicio, entradaFim, revalidar)
        ]),
        el('div', { class: 'formulario-par' }, [
          UI.campo('De', entradaInicio),
          UI.campo('Até', entradaFim)
        ]),
        aviso
      ])
    ]);

    const modal = UI.abrirModal({
      titulo: 'Exportar conteúdos',
      largura: '600px',
      corpo: formulario,
      rodape: [
        contagem,
        el('button', {
          class: 'botao', type: 'button', onclick: function () { modal.fechar(); }
        }, ['Cancelar']),
        gerar
      ]
    });

    gerar.addEventListener('click', function () {
      if (encontradas.length === 0) return;

      const cliente = Estado.cliente(Number(seletorCliente.value));
      const periodo = { inicio: entradaInicio.value, fim: entradaFim.value };

      const nome = 'conteudos-' + slug(cliente.nome) + '-' +
                   periodo.inicio + '-a-' + periodo.fim;

      modal.fechar();
      imprimir(montarFolha(cliente, encontradas, periodo), nome);
    });

    revalidar();
    return modal;
  }

  /* ------------------------------------------------------------------ *
   * Botão                                                               *
   * ------------------------------------------------------------------ */

  /**
   * Sem guarda de papel: exportar é leitura, e cargo somente leitura também
   * precisa do roteiro para trabalhar. Quando o botão de importar não existe
   * — porque quem entrou não é admin — este assume a posição sozinho, e o
   * flex do container fecha o espaço sem deixar buraco.
   */
  function montarBotao() {
    const caixa = document.getElementById('acoes-topo');
    if (!caixa) return;

    caixa.appendChild(el('button', {
      class: 'botao botao-exportar-conteudos',
      type: 'button',
      title: 'Documento de produção com o roteiro completo das peças',
      onclick: abrir
    }, ['Exportar conteúdos']));
  }

  window.ExportarConteudos = { montarBotao: montarBotao, abrir: abrir };
})();
