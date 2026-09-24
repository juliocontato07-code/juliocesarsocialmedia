'use strict';

/**
 * Importação de calendários: escolha do arquivo, prévia e confirmação.
 * Nada vai para o banco sem passar por aqui.
 */
(function () {
  const el = UI.el;

  function plural(n, singular, plural2) {
    return n + ' ' + (n === 1 ? singular : plural2);
  }

  function bloco(titulo, corpo, classe) {
    return el('div', { class: 'imp-bloco ' + (classe || '') }, [
      el('div', { class: 'imp-bloco-titulo', texto: titulo }),
      corpo
    ]);
  }

  function listaDeNomes(nomes) {
    return el('div', { class: 'imp-nomes' }, nomes.map(function (nome) {
      return el('span', { class: 'imp-nome-item', texto: nome });
    }));
  }

  /* ------------------------------------------------------------------ *
   * Prévia                                                              *
   * ------------------------------------------------------------------ */

  function montarPrevia(previa) {
    const corpo = el('div', { class: 'imp-corpo' });

    const arquivo = previa.caminho.split(/[\\/]/).pop();
    corpo.appendChild(el('div', { class: 'imp-arquivo' }, [
      el('div', { class: 'campo-rotulo', texto: 'Arquivo' }),
      el('div', { class: 'imp-nome', texto: arquivo }),
      el('div', { class: 'texto-fraco', texto:
        'schema versão ' + previa.versao_schema +
        (previa.versao_schema === 1 ? ' — sem prioridade, data da solicitação e extra' : '') }),
      previa.gerado_em
        ? el('div', { class: 'texto-fraco', texto: 'gerado em ' + previa.gerado_em })
        : null
    ]));

    /* ---- o que entra ---- */
    const entra = el('div', { class: 'imp-resumo' });

    entra.appendChild(el('div', { class: 'imp-numero' }, [
      el('strong', { texto: String(previa.totalDemandas) }),
      el('span', { texto: previa.totalDemandas === 1 ? 'demanda nova' : 'demandas novas' }),
      previa.periodo.inicio
        ? el('span', {
            class: 'texto-fraco imp-periodo',
            texto: 'de ' + Datas.curta(previa.periodo.inicio) + ' a ' + Datas.curta(previa.periodo.fim)
          })
        : null
    ]));

    entra.appendChild(el('div', { class: 'imp-numero' }, [
      el('strong', { texto: String(previa.clientesNovos.length) }),
      el('span', { texto: previa.clientesNovos.length === 1 ? 'cliente novo' : 'clientes novos' })
    ]));
    if (previa.clientesNovos.length > 0) entra.appendChild(listaDeNomes(previa.clientesNovos));

    entra.appendChild(el('div', { class: 'imp-numero' }, [
      el('strong', { texto: String(previa.tagsNovas.length) }),
      el('span', { texto: previa.tagsNovas.length === 1 ? 'tag nova' : 'tags novas' })
    ]));
    if (previa.tagsNovas.length > 0) entra.appendChild(listaDeNomes(previa.tagsNovas));

    /*
     * Extras e prioridade alta ficam à vista antes de confirmar porque são os
     * dois campos que mexem em relatório: extra alimenta o quadro de
     * solicitações fora do escopo por cliente, e prioridade alta muda a ordem
     * em que o time pega o trabalho. Errar em qualquer um só apareceria
     * semanas depois, num número que ninguém consegue explicar.
     *
     * Só aparecem quando há o que mostrar: um "0 extras" em todo arquivo
     * versão 1 seria ruído.
     */
    if (previa.extras > 0) {
      entra.appendChild(el('div', { class: 'imp-numero imp-numero-atencao' }, [
        el('strong', { texto: String(previa.extras) }),
        el('span', { texto: previa.extras === 1 ? 'solicitação extra' : 'solicitações extras' }),
        el('span', { class: 'texto-fraco imp-periodo', texto: 'fora do escopo contratado' })
      ]));
    }

    if (previa.prioridadeAlta > 0) {
      entra.appendChild(el('div', { class: 'imp-numero imp-numero-atencao' }, [
        el('strong', { texto: String(previa.prioridadeAlta) }),
        el('span', { texto: 'de prioridade alta' })
      ]));
    }

    corpo.appendChild(bloco('O que vai entrar', entra, 'imp-bloco-entra'));

    /* ---- quem vai receber ---- */

    /*
     * O arquivo não traz responsável e continua na versão 1 do schema: quem
     * decide é o sistema, pela cadeia tag -> cargo -> pessoas. Mostrar isso
     * aqui é o que evita descobrir depois que 300 demandas foram para a pessoa
     * errada, ou para ninguém.
     */
    if ((previa.demandas || []).length > 0) {
      const atrib = el('div', {});

      if ((previa.tagsSemCargo || []).length > 0) {
        atrib.appendChild(el('div', { class: 'imp-alerta' }, [
          el('strong', { texto: 'Sem responsável: ' }),
          el('span', {
            texto: previa.tagsSemCargo.join(', ') +
              (previa.tagsSemCargo.length === 1 ? ' não tem cargo' : ' não têm cargo') +
              ' configurado, ou o cargo não tem ninguém ativo. As demandas dessas tags ' +
              'entram sem responsável, e você pode atribuir depois na tela de Usuários.'
          })
        ]));
      }

      /* Agrupado por tag, e não uma linha por demanda: 355 linhas dizendo a
         mesma coisa não se lê, e a atribuição é sempre igual dentro da tag. */
      const porTag = new Map();
      for (const d of previa.demandas) {
        if (!porTag.has(d.tag)) porTag.set(d.tag, { quantas: 0, pessoas: d.responsaveis || [] });
        porTag.get(d.tag).quantas += 1;
      }

      const grade = el('div', { class: 'imp-atribuicao' });

      for (const [nomeTag, info] of porTag) {
        grade.appendChild(el('div', { class: 'imp-atribuicao-linha' }, [
          el('span', { class: 'imp-atribuicao-tag', texto: nomeTag }),
          el('span', { class: 'texto-fraco', texto: info.quantas + '×' }),
          info.pessoas.length === 0
            ? el('span', { class: 'imp-sem-dono', texto: 'sem responsável' })
            : el('span', { class: 'imp-atribuicao-pessoas' }, [
                el('span', {
                  class: 'pilha-avatares' + (info.pessoas.length > 2 ? ' pilha-junta' : '')
                }, info.pessoas.map(function (p) { return Cartao.avatar(p, { pequeno: true }); })),
                el('span', { texto: info.pessoas.map(Cartao.nomeDe).join(', ') })
              ])
        ]));
      }

      atrib.appendChild(grade);
      corpo.appendChild(bloco('Quem vai receber', atrib, 'imp-bloco-atribuicao'));
    }

    /* ---- erros ---- */
    if (previa.erros.length > 0) {
      const lista = el('div', { class: 'imp-lista' }, previa.erros.map(function (erro) {
        return el('div', { class: 'imp-linha-erro' }, [
          el('span', { class: 'imp-onde', texto: erro.onde }),
          el('span', { texto: erro.mensagem })
        ]);
      }));
      corpo.appendChild(bloco(
        plural(previa.erros.length, 'linha com erro', 'linhas com erro') + ' — não serão importadas',
        lista, 'imp-bloco-erro'));
    }

    /* ---- duplicados ---- */
    const totalDup = previa.duplicados.clientes.length + previa.duplicados.demandas.length;

    if (totalDup > 0) {
      const lista = el('div', { class: 'imp-lista imp-lista-dup' });

      for (const cliente of previa.duplicados.clientes) {
        lista.appendChild(el('div', { class: 'imp-linha-dup' }, [
          el('span', { class: 'imp-tipo', texto: 'cliente' }),
          el('span', { class: 'imp-dup-nome', texto: cliente.nome }),
          el('span', { class: 'texto-fraco imp-motivo', texto: cliente.motivo })
        ]));
      }

      for (const demanda of previa.duplicados.demandas) {
        lista.appendChild(el('div', { class: 'imp-linha-dup' }, [
          el('span', { class: 'imp-tipo', texto: 'demanda' }),
          el('span', { class: 'imp-dup-data', texto: Datas.curta(demanda.data) }),
          el('span', { class: 'imp-dup-cliente', texto: demanda.cliente }),
          el('span', { class: 'imp-dup-tag', texto: demanda.tag }),
          el('span', { class: 'imp-dup-titulo', texto: demanda.titulo || 'sem título' })
        ]));
      }

      corpo.appendChild(bloco(
        plural(totalDup, 'item já existe no app', 'itens já existem no app'),
        el('div', {}, [
          el('p', {
            class: 'imp-explica',
            texto: 'Importar é sempre aditivo: nada do que já está no app é alterado. ' +
                   'Os itens abaixo serão ignorados.'
          }),
          lista
        ]),
        'imp-bloco-dup'));
    }

    return { corpo: corpo, totalDup: totalDup };
  }

  /* ------------------------------------------------------------------ *
   * Fluxo                                                               *
   * ------------------------------------------------------------------ */

  /** Abre o seletor do navegador e devolve { nome, conteudo }. */
  function escolherArquivo() {
    return new Promise(function (resolver) {
      const campo = el('input', { type: 'file', accept: '.json,application/json' });
      campo.style.display = 'none';

      campo.addEventListener('change', function () {
        const arquivo = campo.files && campo.files[0];
        campo.remove();
        if (!arquivo) return resolver(null);

        const leitor = new FileReader();
        leitor.onload = function () { resolver({ nome: arquivo.name, conteudo: String(leitor.result) }); };
        leitor.onerror = function () { resolver(null); };
        leitor.readAsText(arquivo, 'utf-8');
      });

      document.body.appendChild(campo);
      campo.click();
    });
  }

  async function importar() {
    const escolhido = await escolherArquivo();
    if (!escolhido) return;

    const caminho = escolhido.nome;

    let previa;
    try {
      previa = await window.api.importar.previa(escolhido.conteudo, escolhido.nome);
    } catch (erro) {
      /* erro de estrutura: nada é importado e o motivo aparece por extenso */
      UI.abrirModal({
        titulo: 'Arquivo inválido',
        largura: '520px',
        corpo: el('div', { class: 'imp-corpo' }, [
          el('div', { class: 'imp-alerta' }, [
            el('strong', { texto: 'Nada foi importado.' }),
            ' O arquivo não passou na validação:'
          ]),
          el('div', { class: 'imp-mensagem-erro', texto: erro.message })
        ])
      });
      return;
    }

    previa.caminho = escolhido.nome;
    const montada = montarPrevia(previa);
    const nadaAImportar = previa.totalDemandas === 0 && previa.clientesNovos.length === 0;

    let gravando = false;
    const botaoConfirmar = el('button', {
      class: 'botao botao-principal', type: 'button', disabled: nadaAImportar
    }, [montada.totalDup > 0 ? 'DESCARTAR DUPLICADOS' : 'Importar']);

    const modal = UI.abrirModal({
      titulo: 'Importar calendário',
      largura: '680px',
      corpo: montada.corpo,
      rodape: [
        el('button', {
          class: 'botao', type: 'button',
          onclick: function () { modal.fechar(); }
        }, ['Cancelar']),
        botaoConfirmar
      ]
    });

    if (nadaAImportar) {
      botaoConfirmar.title = 'Não há nada novo neste arquivo.';
    }

    botaoConfirmar.addEventListener('click', async function () {
      if (gravando) return;
      gravando = true;
      botaoConfirmar.disabled = true;
      botaoConfirmar.textContent = 'Importando…';

      try {
        const resumo = await window.api.importar.aplicar(escolhido.conteudo, escolhido.nome);
        modal.fechar();

        await Estado.recarregar();
        Estado.demandasMudaram();

        if (resumo.periodo && resumo.periodo.inicio) {
          TelaSemanal.irParaData(resumo.periodo.inicio);
          TelaMensal.irParaData(resumo.periodo.inicio);
          await App.ir('semanal');
        }

        mostrarResumo(resumo);
      } catch (erro) {
        UI.aviso(erro.message, 'erro');
        gravando = false;
        botaoConfirmar.disabled = false;
        botaoConfirmar.textContent = montada.totalDup > 0 ? 'DESCARTAR DUPLICADOS' : 'Importar';
      }
    });
  }

  function mostrarResumo(resumo) {
    const linhas = el('div', { class: 'imp-resumo-final' }, [
      el('div', { class: 'imp-numero' }, [
        el('strong', { texto: String(resumo.demandas) }),
        el('span', { texto: resumo.demandas === 1 ? 'demanda importada' : 'demandas importadas' })
      ]),
      el('div', { class: 'imp-numero' }, [
        el('strong', { texto: String(resumo.clientes) }),
        el('span', { texto: resumo.clientes === 1 ? 'cliente criado' : 'clientes criados' })
      ]),
      el('div', { class: 'imp-numero' }, [
        el('strong', { texto: String(resumo.tags) }),
        el('span', { texto: resumo.tags === 1 ? 'tag criada' : 'tags criadas' })
      ]),
      resumo.ignorados > 0
        ? el('div', { class: 'imp-numero imp-numero-fraco' }, [
            el('strong', { texto: String(resumo.ignorados) }),
            el('span', { texto: 'já existiam e foram ignorados' })
          ])
        : null,
      resumo.erros > 0
        ? el('div', { class: 'imp-numero imp-numero-fraco' }, [
            el('strong', { texto: String(resumo.erros) }),
            el('span', { texto: 'com erro, fora da importação' })
          ])
        : null,
      resumo.periodo && resumo.periodo.inicio
        ? el('p', {
            class: 'texto-fraco',
            texto: 'A visão foi para ' + Datas.curta(resumo.periodo.inicio) +
                   ', início do período importado.'
          })
        : null
    ]);

    const modal = UI.abrirModal({
      titulo: 'Importação concluída',
      largura: '440px',
      corpo: linhas,
      rodape: [
        el('button', {
          class: 'botao botao-principal', type: 'button',
          onclick: function () { modal.fechar(); }
        }, ['Fechar'])
      ]
    });
  }

  function montarBotao() {
    const caixa = document.getElementById('acoes-topo');
    if (!caixa) return;

    if (!Estado.ehAdmin()) return;

    caixa.appendChild(el('button', {
      class: 'botao botao-principal botao-importar',
      type: 'button',
      title: 'Importar um calendário .json',
      onclick: importar
    }, ['Importar calendário']));
  }

  /* o painel "Mais" do celular chama importar() direto: lá o botão do topo
     não existe, porque a barra do topo some no mobile */
  window.Importar = { montarBotao: montarBotao, importar: importar };
})();
