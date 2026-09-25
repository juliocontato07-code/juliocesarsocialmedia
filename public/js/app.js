'use strict';

(function () {
  const el = UI.el;

  const TELAS = {
    dia: { rotulo: 'Dia', modulo: function () { return window.TelaDia; } },
    semanal: { rotulo: 'Semanal', modulo: function () { return window.TelaSemanal; } },
    mensal: { rotulo: 'Mensal', modulo: function () { return window.TelaMensal; } },
    lista: { rotulo: 'Lista', modulo: function () { return window.TelaLista; } },
    dashboard: { rotulo: 'Dashboard', modulo: function () { return window.TelaDashboard; } },
    rotinas: { rotulo: 'Rotinas', modulo: function () { return window.TelaRotinas; } },
    clientes: { rotulo: 'Clientes', modulo: function () { return window.TelaClientes; } },
    /* Tags deixou de ter aba: o cadastro mora dentro da tela de Usuários,
       junto de cargos e profissionais, que é onde a cadeia
       tag -> cargo -> pessoas se configura inteira. A tela antiga continua
       alcançável pela rota, para link salvo não quebrar. */
    tags: {
      rotulo: 'Tags',
      abaPai: 'usuarios',
      soAdmin: true,
      modulo: function () { return window.TelaTags; }
    },
    usuarios: {
      rotulo: 'Usuários',
      soAdmin: true,
      modulo: function () { return window.TelaUsuarios; }
    },
    /* sem aba própria: abrem de dentro de outra tela */
    demanda: {
      rotulo: 'Demanda',
      modulo: function () { return window.TelaDemanda; }
    },
    planejador: {
      rotulo: 'Planejador',
      abaPai: 'clientes',
      soAdmin: true,
      modulo: function () { return window.TelaPlanejador; }
    }
  };

  let telaAtual = null;
  let conteudo = null;

  /**
   * Troca de tela. A tela anterior pode recusar a saída (rascunho não salvo)
   * devolvendo false em podeSair().
   */
  async function trocarTela(nome, argumentos) {
    if (!TELAS[nome] || nome === telaAtual) return false;

    /* guarda de papel: quem não é admin não entra nem digitando */
    if (TELAS[nome].soAdmin && !Estado.ehAdmin()) {
      UI.aviso('Esta área é restrita ao administrador.', 'erro');
      return false;
    }

    if (telaAtual && TELAS[telaAtual]) {
      const anterior = TELAS[telaAtual].modulo();
      if (anterior && anterior.podeSair) {
        const liberado = await anterior.podeSair();
        if (!liberado) return false;
      }
      if (anterior && anterior.desmontar) anterior.desmontar();
    }

    telaAtual = nome;
    UI.limpar(conteudo);
    TELAS[nome].modulo().montar(conteudo, argumentos || {});

    const destaque = nome === 'demanda'
      ? ((argumentos && argumentos.origem) || 'semanal')
      : (TELAS[nome].abaPai || nome);
    for (const aba of document.querySelectorAll('.aba')) {
      aba.classList.toggle('ativa', aba.dataset.tela === destaque);
    }

    /* a barra de baixo do celular acompanha a mesma troca */
    if (window.NavegacaoMobile) NavegacaoMobile.marcarAtiva(destaque);

    /* Tela nova começa no topo. Sem isso, sair de uma lista rolada e entrar
       noutra tela deixaria a segunda começando no meio. */
    const rolavel = conteudo.querySelector('.painel-rolagem, .dia-rolagem, .tela-simples');
    if (rolavel) rolavel.scrollTop = 0;

    /* guarda a última aba de trabalho, para reabrir onde parou */
    if (['dia', 'semanal', 'mensal', 'lista', 'dashboard', 'rotinas',
         'clientes', 'usuarios'].indexOf(nome) > -1) {
      Estado.definirPref('ui.ultimaAba', nome);
    }

    return true;
  }

  /**
   * O banco é compartilhado: recarrega a visão de tempos em tempos para
   * reduzir a janela em que alguém olha dado velho.
   */
  function iniciarRecargaPeriodica() {
    window.setInterval(async function () {
      if (document.hidden) return;
      if (document.querySelector('.modal')) return;   /* não puxa o tapete de quem edita */
      if (telaAtual === 'demanda' || telaAtual === 'planejador') return;
      /* a lista tem filtro e ordenação na mão de quem está olhando, e a
         rotina tem caixas sendo marcadas: redesenhar por baixo seria pior
         que mostrar dado de um minuto atrás */
      if (telaAtual === 'lista' || telaAtual === 'rotinas') return;

      try {
        await Estado.recarregar();
        Estado.demandasMudaram();
      } catch (erro) { /* rede caiu: a próxima volta tenta de novo */ }
    }, 60000);
  }

  async function iniciar() {
    conteudo = document.getElementById('conteudo');

    for (const aba of document.querySelectorAll('.aba')) {
      aba.addEventListener('click', function () {
        if (this.disabled) return;
        trocarTela(this.dataset.tela);
      });
    }

    try {
      await Estado.recarregar();
    } catch (erro) {
      UI.limpar(conteudo);
      conteudo.appendChild(el('div', { class: 'painel' }, [
        el('h2', { class: 'painel-titulo erro', texto: 'Falha ao abrir o banco' }),
        el('p', { class: 'painel-sub', texto: erro.message })
      ]));
      return;
    }

    Menu.montar();
    Importar.montarBotao();
    ExportarConteudos.montarBotao();

    /* abas restritas somem para quem não é admin */
    if (!Estado.ehAdmin()) {
      for (const aba of document.querySelectorAll('.aba-admin')) aba.remove();
    }

    if (window.NavegacaoMobile) NavegacaoMobile.montar();

    /*
     * No celular a aba inicial é sempre Dia, e não a última usada.
     *
     * A última aba é uma preferência compartilhada com o desktop, onde a
     * pessoa pode ter parado no Dashboard ou na tela de Usuários — telas que
     * no telefone não são o ponto de partida de ninguém. Quem abre o app no
     * celular quer ver o dia.
     */
    const salva = Estado.pref('ui.ultimaAba', 'dia');
    const valida = TELAS[salva] && !(TELAS[salva].soAdmin && !Estado.ehAdmin());
    const alvo = Dispositivo.ehMobile() ? 'dia' : (valida ? salva : 'dia');
    trocarTela(alvo);

    iniciarRecargaPeriodica();

    /*
     * Girar o aparelho, ou redimensionar a janela por cima do limite, troca a
     * estrutura de algumas telas — a Semanal em grade não é a Semanal em
     * coluna única. Remontar a tela atual é mais simples e mais confiável que
     * fazer cada tela se adaptar ao vivo.
     */
    Dispositivo.aoMudarFaixa(function () {
      const atual = telaAtual;
      if (!atual) return;

      if (window.NavegacaoMobile) {
        NavegacaoMobile.fecharPainel();
        NavegacaoMobile.marcarAtiva(atual);
      }

      /* a tela da demanda pode ter rascunho não salvo: remontar perderia */
      if (atual === 'demanda') return;

      telaAtual = null;
      trocarTela(atual);
    });
  }

  window.App = { ir: trocarTela, atual: function () { return telaAtual; } };

  window.addEventListener('DOMContentLoaded', iniciar);
})();
